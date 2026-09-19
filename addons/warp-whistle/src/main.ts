/**
 * Warp Whistle — blow it and a whirlwind carries you off, Super Mario Bros. 3 style.
 *
 * Using the whistle opens a menu of places to warp to. The first entry is
 * always Home: the player's own bed (their spawn point). Below it are the
 * world's shared waypoints, which anyone can set, rename, move, or delete.
 * Crouch + use is a shortcut to set a waypoint where you stand.
 *
 * A warp is not instant. The whistle plays a rising tune while sparkles
 * spiral up around the player for two seconds, then the player is teleported,
 * cross-dimension if needed, and lands in a burst of sparkles. The item then
 * cools down for a few seconds so it cannot be spammed.
 *
 * Waypoints live in a world dynamic property as JSON, so they survive
 * restarts and are the same for every player. Home is never stored: it is
 * read from `Player.getSpawnPoint()` each time, so it follows the bed.
 */
import {
  EquipmentSlot,
  ItemStack,
  Player,
  system,
  world,
  type Dimension,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';
import {
  ActionFormData,
  FormCancelationReason,
  MessageFormData,
  ModalFormData,
  type FormResponse,
} from '@minecraft/server-ui';
import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';

const log = createLogger('warp-whistle');
const PREFIX: RawMessage = { text: `${Format.gray}[Warp Whistle]${Format.reset} ` };

const WHISTLE_ID = 'steveo:warp_whistle';
/** Cooldown category from the item's `minecraft:cooldown` component. */
const COOLDOWN_CATEGORY = 'steveo_warp_whistle';
/** World dynamic property holding the JSON array of waypoints. */
const WAYPOINTS_PROP = 'steveo:warp_waypoints';

/**
 * There is no count limit on waypoints. The only ceiling is the world dynamic
 * property that stores them, which the game caps at 32 KB per value; the
 * guard below keeps a margin under that.
 */
const MAX_STORAGE_CHARS = 30000;
const MAX_NAME_LENGTH = 24;
/** Plain string on purpose: form text fields reject RawMessage placeholders and defaults. */
const NAME_PLACEHOLDER = 'e.g. Mine, Village, Farm';
/** Ticks between blowing the whistle and actually leaving. */
const WINDUP_TICKS = 40;
/** Extra cooldown after a warp, on top of the wind-up. */
const COOLDOWN_TICKS = 100;
/** How long a form keeps retrying while the player is in another screen. */
const FORM_RETRY_TICKS = 5;
const FORM_RETRY_LIMIT = 20;
const HOLD_CHECK_TICKS = 20;

/** The whistle's tune, as note-block semitone offsets, one every 4 ticks. */
const MELODY = [7, 11, 14, 19, 14, 11, 19, 23];
const MELODY_STEP_TICKS = 4;

// ---------- data ----------

interface Waypoint {
  name: string;
  x: number;
  y: number;
  z: number;
  /** Facing yaw when the waypoint was set, so arriving feels natural. */
  yaw: number;
  /** Dimension id, e.g. `minecraft:overworld`. */
  dimension: string;
  /** Name of the player who set it. */
  by: string;
}

interface Destination {
  label: RawMessage;
  location: Vector3;
  dimension: Dimension;
  yaw?: number;
  /** Key of the arrival message; defaults to the generic one with the label. */
  arrivedKey?: string;
}

function isWaypoint(value: unknown): value is Waypoint {
  if (typeof value !== 'object' || value === null) return false;
  const w = value as Record<string, unknown>;
  return (
    typeof w.name === 'string' &&
    typeof w.x === 'number' &&
    typeof w.y === 'number' &&
    typeof w.z === 'number' &&
    typeof w.yaw === 'number' &&
    typeof w.dimension === 'string' &&
    typeof w.by === 'string'
  );
}

function loadWaypoints(): Waypoint[] {
  const raw = world.getDynamicProperty(WAYPOINTS_PROP);
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWaypoint);
  } catch (err) {
    log.error('waypoint data is corrupt; starting fresh', err);
    return [];
  }
}

/** Saves the list; false when it would no longer fit in the dynamic property. */
function saveWaypoints(waypoints: Waypoint[]): boolean {
  const json = JSON.stringify(waypoints);
  if (json.length > MAX_STORAGE_CHARS) return false;
  world.setDynamicProperty(WAYPOINTS_PROP, json);
  return true;
}

function findWaypoint(name: string): Waypoint | undefined {
  return loadWaypoints().find((w) => w.name === name);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function whereIs(player: Player): Pick<Waypoint, 'x' | 'y' | 'z' | 'yaw' | 'dimension'> {
  const { x, y, z } = player.location;
  return { x: round(x), y: round(y), z: round(z), yaw: round(player.getRotation().y), dimension: player.dimension.id };
}

/** "12, 64, -30" plus the dimension name when it is not the Overworld. */
function describe(location: Vector3, dimensionId: string): RawMessage {
  const coords = `${Math.round(location.x)}, ${Math.round(location.y)}, ${Math.round(location.z)}`;
  const dim = dimensionLabel(dimensionId);
  return dim ? { rawtext: [{ text: `${coords} ` }, dim] } : { text: coords };
}

function dimensionLabel(dimensionId: string): RawMessage | undefined {
  if (dimensionId === 'minecraft:nether') return { translate: 'warp_whistle.dim.nether' };
  if (dimensionId === 'minecraft:the_end') return { translate: 'warp_whistle.dim.the_end' };
  return undefined;
}

function tell(player: Player, message: RawMessage): void {
  player.sendMessage({ rawtext: [PREFIX, message] });
}

function t(key: string, ...args: (string | RawMessage)[]): RawMessage {
  return args.length ? { translate: key, with: { rawtext: args.map((a) => (typeof a === 'string' ? { text: a } : a)) } } : { translate: key };
}

/** Whether the player's spawn point is a bed or anchor they can warp back to. */
function homeOf(player: Player): Destination | undefined {
  const spawn = player.getSpawnPoint();
  if (!spawn) return undefined;
  return {
    label: t('warp_whistle.menu.home'),
    // Stand just above the bed block so nothing pushes the player out of it.
    location: { x: spawn.x + 0.5, y: spawn.y + 1, z: spawn.z + 0.5 },
    dimension: spawn.dimension,
    arrivedKey: 'warp_whistle.arrived.home',
  };
}

function destinationOf(waypoint: Waypoint): Destination | undefined {
  let dimension: Dimension;
  try {
    dimension = world.getDimension(waypoint.dimension);
  } catch {
    return undefined;
  }
  return {
    label: { text: waypoint.name },
    location: { x: waypoint.x, y: waypoint.y, z: waypoint.z },
    dimension,
    yaw: waypoint.yaw,
  };
}

// ---------- forms ----------

function sleep(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

/**
 * Shows a form, retrying while the player is busy in another screen (for
 * example the chat window that just sent a scriptevent). Resolves undefined
 * when the player closed the form or never became free.
 */
async function show<T extends FormResponse>(player: Player, form: { show(player: Player): Promise<T> }): Promise<T | undefined> {
  for (let attempt = 0; attempt < FORM_RETRY_LIMIT; attempt++) {
    const response = await form.show(player);
    if (response.cancelationReason !== FormCancelationReason.UserBusy) {
      return response.canceled ? undefined : response;
    }
    await sleep(FORM_RETRY_TICKS);
  }
  return undefined;
}

async function openMenu(player: Player): Promise<void> {
  const home = homeOf(player);
  const waypoints = loadWaypoints();

  const form = new ActionFormData().title(t('warp_whistle.menu.title')).body(t('warp_whistle.menu.body'));
  form.button(
    home
      ? { rawtext: [t('warp_whistle.menu.home'), { text: ` ${Format.gray}` }, describe(home.location, home.dimension.id)] }
      : t('warp_whistle.menu.home.none'),
    'textures/items/bed_red',
  );
  for (const w of waypoints) {
    form.button({ rawtext: [{ text: `${w.name} ${Format.gray}` }, describe(w, w.dimension)] }, 'textures/items/ender_pearl');
  }
  form.button(t('warp_whistle.menu.set'), 'textures/items/compass_item');
  if (waypoints.length > 0) form.button(t('warp_whistle.menu.manage'), 'textures/items/book_writable');

  const response = await show(player, form);
  const pick = response?.selection;
  if (pick === undefined) return;

  if (pick === 0) {
    if (home) beginWarp(player, home);
    else tell(player, t('warp_whistle.home.none'));
    return;
  }
  const waypoint = waypoints[pick - 1];
  if (waypoint) {
    const destination = destinationOf(waypoint);
    if (destination) beginWarp(player, destination);
    else tell(player, t('warp_whistle.failed'));
    return;
  }
  if (pick === waypoints.length + 1) return openSetWaypoint(player);
  if (pick === waypoints.length + 2) return openManage(player);
}

async function openSetWaypoint(player: Player): Promise<void> {
  const waypoints = loadWaypoints();
  // Capture the spot when the form opens, not when it is submitted.
  const here = whereIs(player);

  // The text field's placeholder and default must be plain strings: the
  // typings accept a RawMessage, but the client rejects the form with
  // "invalid form json ... /content/0/default: expected 'string' got 'object'".
  const form = new ModalFormData()
    .title(t('warp_whistle.set.title'))
    .textField(t('warp_whistle.set.name'), NAME_PLACEHOLDER, { defaultValue: `Waypoint ${waypoints.length + 1}` })
    .submitButton(t('warp_whistle.set.submit'));

  const response = await show(player, form);
  const name = validName(player, response?.formValues?.[0]);
  if (name === undefined) return;

  const fresh = loadWaypoints();
  fresh.push({ name, ...here, by: player.name });
  if (!saveWaypoints(fresh)) {
    tell(player, t('warp_whistle.set.full'));
    return;
  }
  player.playSound('random.orb', { pitch: 1.4, volume: 0.6 });
  tell(player, t('warp_whistle.set.done', name, describe(here, here.dimension)));
}

/** Trims and checks a submitted name, telling the player what is wrong. Undefined means rejected. */
function validName(player: Player, value: unknown, current?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (name === '') {
    tell(player, t('warp_whistle.set.empty'));
    return undefined;
  }
  if (name.length > MAX_NAME_LENGTH) {
    tell(player, t('warp_whistle.set.long', `${MAX_NAME_LENGTH}`));
    return undefined;
  }
  if (name !== current && findWaypoint(name)) {
    tell(player, t('warp_whistle.set.duplicate', name));
    return undefined;
  }
  return name;
}

async function openManage(player: Player): Promise<void> {
  const waypoints = loadWaypoints();
  if (waypoints.length === 0) {
    tell(player, t('warp_whistle.manage.none'));
    return;
  }
  const form = new ActionFormData().title(t('warp_whistle.manage.title')).body(t('warp_whistle.manage.body'));
  for (const w of waypoints) {
    form.button({ rawtext: [{ text: `${w.name} ${Format.gray}` }, describe(w, w.dimension)] }, 'textures/items/ender_pearl');
  }
  form.button(t('warp_whistle.manage.back'));

  const response = await show(player, form);
  const pick = response?.selection;
  if (pick === undefined) return;
  const waypoint = waypoints[pick];
  if (!waypoint) return openMenu(player);
  return openWaypoint(player, waypoint.name);
}

async function openWaypoint(player: Player, name: string): Promise<void> {
  const waypoint = findWaypoint(name);
  if (!waypoint) {
    tell(player, t('warp_whistle.gone'));
    return;
  }
  const form = new ActionFormData()
    .title({ text: waypoint.name })
    .body(t('warp_whistle.manage.detail', waypoint.name, describe(waypoint, waypoint.dimension), waypoint.by))
    .button(t('warp_whistle.manage.warp'), 'textures/items/ender_pearl')
    .button(t('warp_whistle.manage.rename'), 'textures/items/name_tag')
    .button(t('warp_whistle.manage.move'), 'textures/items/compass_item')
    .button(t('warp_whistle.manage.delete'), 'textures/items/barrier')
    .button(t('warp_whistle.manage.back'));

  const response = await show(player, form);
  switch (response?.selection) {
    case 0: {
      const destination = destinationOf(waypoint);
      if (destination) beginWarp(player, destination);
      else tell(player, t('warp_whistle.failed'));
      return;
    }
    case 1:
      return renameWaypoint(player, waypoint.name);
    case 2:
      return moveWaypoint(player, waypoint.name);
    case 3:
      return deleteWaypoint(player, waypoint.name);
    case 4:
      return openManage(player);
    default:
      return;
  }
}

async function renameWaypoint(player: Player, oldName: string): Promise<void> {
  const form = new ModalFormData()
    .title(t('warp_whistle.rename.title'))
    .textField(t('warp_whistle.set.name'), NAME_PLACEHOLDER, { defaultValue: oldName })
    .submitButton(t('warp_whistle.rename.submit'));
  const response = await show(player, form);
  const newName = validName(player, response?.formValues?.[0], oldName);
  if (newName === undefined || newName === oldName) return;

  const waypoints = loadWaypoints();
  const target = waypoints.find((w) => w.name === oldName);
  if (!target) {
    tell(player, t('warp_whistle.gone'));
    return;
  }
  target.name = newName;
  if (!saveWaypoints(waypoints)) {
    tell(player, t('warp_whistle.set.full'));
    return;
  }
  tell(player, t('warp_whistle.rename.done', oldName, newName));
}

function moveWaypoint(player: Player, name: string): void {
  const waypoints = loadWaypoints();
  const target = waypoints.find((w) => w.name === name);
  if (!target) {
    tell(player, t('warp_whistle.gone'));
    return;
  }
  Object.assign(target, whereIs(player), { by: player.name });
  saveWaypoints(waypoints);
  player.playSound('random.orb', { pitch: 1.4, volume: 0.6 });
  tell(player, t('warp_whistle.move.done', name, describe(target, target.dimension)));
}

async function deleteWaypoint(player: Player, name: string): Promise<void> {
  const form = new MessageFormData()
    .title(t('warp_whistle.delete.title'))
    .body(t('warp_whistle.delete.body', name))
    .button1(t('warp_whistle.delete.confirm'))
    .button2(t('warp_whistle.delete.cancel'));
  const response = await show(player, form);
  if (response?.selection !== 0) return;

  const waypoints = loadWaypoints();
  const remaining = waypoints.filter((w) => w.name !== name);
  if (remaining.length === waypoints.length) {
    tell(player, t('warp_whistle.gone'));
    return;
  }
  saveWaypoints(remaining);
  tell(player, t('warp_whistle.delete.done', name));
}

// ---------- warping ----------

/** Players mid-whirlwind, so a second blow does not stack. */
const warping = new Set<string>();
/** Tick until which each player's whistle is resting. The item cooldown only draws the overlay. */
const restingUntil = new Map<string, number>();

function noteToPitch(semitone: number): number {
  return Math.pow(2, (semitone - 12) / 12);
}

/** Plays the whistle tune and the spiralling sparkles at the player, for WINDUP_TICKS. */
function playWindup(player: Player, onDone?: () => void): void {
  let tick = 0;
  const handle = system.runInterval(() => {
    tick++;
    try {
      if (!player.isValid) throw new Error('player left');
      if (tick % MELODY_STEP_TICKS === 1) {
        const note = MELODY[Math.floor(tick / MELODY_STEP_TICKS) % MELODY.length] ?? 12;
        player.dimension.playSound('note.flute', player.location, { pitch: noteToPitch(note), volume: 0.8 });
      }
      spiral(player, tick);
    } catch (err) {
      system.clearRun(handle);
      warping.delete(player.id);
      log.warn(`wind-up aborted: ${String(err)}`);
      return;
    }
    if (tick >= WINDUP_TICKS) {
      system.clearRun(handle);
      onDone?.();
    }
  }, 1);
}

/** Two arms of sparkles climbing around the player, tightening as they rise. */
function spiral(player: Player, tick: number): void {
  const progress = tick / WINDUP_TICKS;
  const base = player.location;
  const angle = tick * 0.45;
  const radius = 1.2 - progress * 0.5;
  const height = progress * 2.4;
  for (const arm of [0, Math.PI]) {
    player.dimension.spawnParticle('minecraft:endrod', {
      x: base.x + Math.cos(angle + arm) * radius,
      y: base.y + height,
      z: base.z + Math.sin(angle + arm) * radius,
    });
  }
}

function burst(dimension: Dimension, at: Vector3): void {
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    dimension.spawnParticle('minecraft:endrod', { x: at.x + Math.cos(a) * 0.8, y: at.y + 1, z: at.z + Math.sin(a) * 0.8 });
  }
}

function beginWarp(player: Player, destination: Destination): void {
  if (warping.has(player.id)) return;
  if ((restingUntil.get(player.id) ?? 0) > system.currentTick) {
    player.onScreenDisplay.setActionBar(t('warp_whistle.cooldown'));
    return;
  }
  warping.add(player.id);
  restingUntil.set(player.id, system.currentTick + WINDUP_TICKS + COOLDOWN_TICKS);
  player.startItemCooldown(COOLDOWN_CATEGORY, WINDUP_TICKS + COOLDOWN_TICKS);
  player.onScreenDisplay.setActionBar(t('warp_whistle.warping'));

  playWindup(player, () => {
    warping.delete(player.id);
    try {
      const from = player.dimension;
      const fromLocation = player.location;
      player.teleport(destination.location, {
        dimension: destination.dimension,
        ...(destination.yaw !== undefined ? { rotation: { x: 0, y: destination.yaw } } : {}),
      });
      from.playSound('mob.endermen.portal', fromLocation, { volume: 0.7 });
      try {
        burst(from, fromLocation);
        burst(destination.dimension, destination.location);
      } catch {
        // Particles are decoration; a missing chunk must not fail the warp.
      }
      player.playSound('mob.endermen.portal', { volume: 0.7, pitch: 1.2 });
      tell(player, destination.arrivedKey ? t(destination.arrivedKey) : t('warp_whistle.arrived', destination.label));
    } catch (err) {
      log.error('teleport failed', err);
      if (player.isValid) tell(player, t('warp_whistle.failed'));
    }
  });
}

// ---------- item handling ----------

/** Tick of each player's last use, so itemUse + block interaction on one click count once. */
const lastUse = new Map<string, number>();
const hinted = new Set<string>();

function handleUse(player: Player): void {
  if (lastUse.get(player.id) === system.currentTick) return;
  lastUse.set(player.id, system.currentTick);
  if (warping.has(player.id)) return;

  const flow = player.isSneaking ? openSetWaypoint(player) : openMenu(player);
  flow.catch((err: unknown) => log.error('menu failed', err));
}

world.afterEvents.itemUse.subscribe((event) => {
  if (event.itemStack.typeId === WHISTLE_ID) handleUse(event.source);
});

// Using the whistle on a block fires this instead of (or as well as) itemUse.
world.afterEvents.playerInteractWithBlock.subscribe((event) => {
  if (!event.isFirstEvent) return;
  if (event.itemStack?.typeId === WHISTLE_ID) handleUse(event.player);
});

// One-time hint when a player first holds the whistle.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    if (hinted.has(player.id)) continue;
    const held = player.getComponent('minecraft:equippable')?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId !== WHISTLE_ID) continue;
    hinted.add(player.id);
    tell(player, t('warp_whistle.hint'));
  }
}, HOLD_CHECK_TICKS);

world.afterEvents.playerLeave.subscribe((event) => {
  hinted.delete(event.playerId);
  lastUse.delete(event.playerId);
  warping.delete(event.playerId);
  restingUntil.delete(event.playerId);
});

// ---------- debug: /scriptevent steveo:warp <give|list|clear|demo> ----------

function listMessage(player: Player): RawMessage {
  const waypoints = loadWaypoints();
  const home = homeOf(player);
  const rawtext: RawMessage[] = [PREFIX, t('warp_whistle.debug.list', `${waypoints.length}`)];
  rawtext.push({ text: '\n' }, home ? t('warp_whistle.debug.list.home', describe(home.location, home.dimension.id)) : t('warp_whistle.debug.list.home.none'));
  waypoints.forEach((w, i) => {
    rawtext.push({ text: '\n' }, t('warp_whistle.debug.list.one', `${i + 1}`, w.name, describe(w, w.dimension), w.by));
  });
  return { rawtext };
}

system.afterEvents.scriptEventReceive.subscribe(
  (event) => {
    const [, command] = event.id.split(':');
    if (command !== 'warp') return;
    const player = event.sourceEntity instanceof Player ? event.sourceEntity : undefined;
    if (!player) return;

    switch (event.message.trim()) {
      case 'give': {
        player.getComponent('minecraft:inventory')?.container.addItem(new ItemStack(WHISTLE_ID, 1));
        tell(player, t('warp_whistle.debug.given'));
        break;
      }
      case 'list': {
        player.sendMessage(listMessage(player));
        break;
      }
      case 'clear': {
        const count = loadWaypoints().length;
        saveWaypoints([]);
        tell(player, t('warp_whistle.debug.cleared', `${count}`));
        break;
      }
      case 'demo': {
        tell(player, t('warp_whistle.debug.demo'));
        if (!warping.has(player.id)) {
          warping.add(player.id);
          playWindup(player, () => {
            warping.delete(player.id);
            try {
              burst(player.dimension, player.location);
            } catch {
              // decoration only
            }
          });
        }
        break;
      }
      default:
        tell(player, t('warp_whistle.debug.help'));
    }
  },
  { namespaces: ['steveo'] },
);

log.info('loaded');
