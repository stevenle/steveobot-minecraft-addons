/**
 * Warp Whistle — blow it and a whirlwind carries you off, Super Mario Bros. 3 style.
 *
 * Using the whistle opens a menu of places to warp to. The first entry is
 * always Home: the player's own bed (their spawn point). Below it are the
 * other players online, then the world's shared waypoints, newest first,
 * which anyone can set, rename, move, or delete from the same menu.
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
  MolangVariableMap,
  Player,
  system,
  world,
  type Dimension,
  type RawMessage,
  type Vector3,
} from '@minecraft/server';
import {
  CustomForm,
  DataDrivenScreenClosedReason,
  FormCancelationReason,
  ModalFormData,
  ObservableBoolean,
  ObservableString,
  ObservableUIRawMessage,
  type FormResponse,
} from '@minecraft/server-ui';
import { createLogger } from '@shared/log';
import { Format } from '@shared/chat';
import { onItemUse } from '@shared/use';

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
  /** Key of the arrival message, given the label; defaults to the generic one. */
  arrivedKey?: string;
  /** A player to warp to: `location` and `dimension` are re-read from them on arrival. */
  follow?: Player;
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

/**
 * Shows a data-driven form, retrying while the player is busy in another
 * screen. `build` runs per attempt so each try gets a fresh form. False when
 * the player never became free.
 */
async function showCustom(build: () => CustomForm): Promise<boolean> {
  for (let attempt = 0; attempt < FORM_RETRY_LIMIT; attempt++) {
    if ((await build().show()) !== DataDrivenScreenClosedReason.UserBusy) return true;
    await sleep(FORM_RETRY_TICKS);
  }
  return false;
}

/** Whether each player last left the menu in edit mode, so it reopens the same way. */
const editing = new Map<string, boolean>();

/**
 * The one menu: a quick-warp section with Home and the other players, then
 * the waypoints, newest first. The Edit toggle switches to a view with a
 * name field and Move / Delete buttons under each waypoint. Move and Delete
 * apply at once (Delete leaves an undo button behind); renames are saved
 * when the menu closes. Anything that leaves the menu — a warp, setting a
 * waypoint — is queued and run after the form has closed.
 *
 * Only the current view is built. Every control and observable is sent to
 * the client even when hidden, and building the edit controls for a long
 * list up front froze the game for seconds on every open, so the toggle
 * reopens the menu in the other view instead of revealing hidden controls.
 */
async function openMenu(player: Player): Promise<void> {
  const home = homeOf(player);
  const others = world.getAllPlayers().filter((p) => p.id !== player.id);
  const inEditView = editing.get(player.id) ?? false;
  const editMode = new ObservableBoolean(inEditView, { clientWritable: true });
  // Stored oldest first, in the order they were set; shown newest first.
  const waypoints = loadWaypoints();
  const rows = inEditView ? waypoints.map((w, index) => new WaypointRow(player, w, index)).reverse() : [];
  let next: (() => void | Promise<void>) | undefined;
  let form: CustomForm | undefined;
  const then = (action: () => void | Promise<void>): void => {
    next = action;
    form?.close();
  };
  editMode.subscribe(() => then(() => openMenu(player)));

  const shown = await showCustom(() => {
    // CustomForm text shows § color codes literally, so nothing in this form uses them.
    form = new CustomForm(player, t('warp_whistle.menu.title'));

    form.header(t('warp_whistle.menu.quick'));
    form.button(home ? t('warp_whistle.menu.home') : t('warp_whistle.menu.home.none'), () =>
      then(() => (home ? beginWarp(player, home) : tell(player, t('warp_whistle.home.none')))),
    );
    for (const other of others) {
      form.button({ text: other.name }, () => then(() => warpToPlayer(player, other)));
    }

    form.spacer();
    form.header(t('warp_whistle.menu.waypoints'));
    form.button(t('warp_whistle.menu.set'), () => then(() => openSetWaypoint(player)));
    if (waypoints.length > 0) {
      form.toggle(t('warp_whistle.menu.edit'), editMode, { description: t('warp_whistle.menu.edit.hint') });
    }
    if (inEditView) {
      for (const row of rows) row.addTo(form, then);
    } else {
      for (const w of [...waypoints].reverse()) {
        form.button(waypointLabel(w), () => then(() => warpToWaypoint(player, w.name)));
      }
    }
    return form;
  });

  editing.set(player.id, editMode.getData());
  if (!shown) return;
  for (const row of rows) row.commitRename();
  await next?.();
}

function waypointLabel(w: Waypoint): RawMessage {
  return { rawtext: [{ text: `${w.name}  ·  ` }, describe(w, w.dimension)] };
}

/** Warps to a waypoint by name, re-reading it so a move or delete since the menu opened counts. */
function warpToWaypoint(player: Player, name: string): void {
  const current = findWaypoint(name);
  const destination = current && destinationOf(current);
  if (destination) beginWarp(player, destination);
  else tell(player, current ? t('warp_whistle.failed') : t('warp_whistle.gone'));
}

function warpToPlayer(player: Player, target: Player): void {
  if (!target.isValid) {
    tell(player, t('warp_whistle.player.gone'));
    return;
  }
  beginWarp(player, {
    label: { text: target.name },
    location: target.location,
    dimension: target.dimension,
    follow: target,
    arrivedKey: 'warp_whistle.arrived.player',
  });
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

/**
 * One waypoint in the menu's edit view: its warp button and edit controls.
 * The waypoint is found in storage by the name it had when the menu opened,
 * and every change reloads the list first, so edits by other players in the
 * meantime are not overwritten.
 */
class WaypointRow {
  private readonly player: Player;
  private readonly waypoint: Waypoint;
  /** Position in storage when the menu opened, so an undone delete goes back in place. */
  private readonly index: number;
  private readonly name: ObservableString;
  private readonly label: ObservableUIRawMessage;
  /** Undo button: shown once deleted. */
  private readonly deleted = new ObservableBoolean(false);
  /** Everything else: hidden once deleted. */
  private readonly kept = new ObservableBoolean(true);

  constructor(player: Player, waypoint: Waypoint, index: number) {
    this.player = player;
    this.waypoint = waypoint;
    this.index = index;
    this.name = new ObservableString(waypoint.name, { clientWritable: true });
    this.label = new ObservableUIRawMessage(waypointLabel(waypoint));
    this.deleted.subscribe((deleted) => this.kept.setData(!deleted));
  }

  addTo(form: CustomForm, then: (action: () => void) => void): void {
    const name = this.waypoint.name;
    form.button(this.label, () => then(() => warpToWaypoint(this.player, name)), { visible: this.kept });
    form.textField(t('warp_whistle.edit.name'), this.name, {
      description: t('warp_whistle.edit.by', this.waypoint.by),
      visible: this.kept,
    });
    form.button(t('warp_whistle.edit.move', name), () => this.moveHere(), { visible: this.kept });
    form.button(t('warp_whistle.edit.delete', name), () => this.delete(), { visible: this.kept });
    form.button(t('warp_whistle.edit.restore', name), () => this.restore(), { visible: this.deleted });
    form.divider({ visible: this.kept });
  }

  private moveHere(): void {
    const waypoints = loadWaypoints();
    const target = waypoints.find((w) => w.name === this.waypoint.name);
    if (!target) {
      tell(this.player, t('warp_whistle.gone'));
      return;
    }
    Object.assign(target, whereIs(this.player), { by: this.player.name });
    saveWaypoints(waypoints);
    this.label.setData(waypointLabel(target));
    this.player.playSound('random.orb', { pitch: 1.4, volume: 0.6 });
    tell(this.player, t('warp_whistle.move.done', target.name, describe(target, target.dimension)));
  }

  private delete(): void {
    const waypoints = loadWaypoints();
    const remaining = waypoints.filter((w) => w.name !== this.waypoint.name);
    if (remaining.length === waypoints.length) {
      tell(this.player, t('warp_whistle.gone'));
      return;
    }
    saveWaypoints(remaining);
    this.deleted.setData(true);
    tell(this.player, t('warp_whistle.delete.done', this.waypoint.name));
  }

  private restore(): void {
    const waypoints = loadWaypoints();
    if (waypoints.some((w) => w.name === this.waypoint.name)) {
      tell(this.player, t('warp_whistle.set.duplicate', this.waypoint.name));
      return;
    }
    waypoints.splice(Math.min(this.index, waypoints.length), 0, this.waypoint);
    if (!saveWaypoints(waypoints)) {
      tell(this.player, t('warp_whistle.set.full'));
      return;
    }
    this.deleted.setData(false);
    tell(this.player, t('warp_whistle.restore.done', this.waypoint.name));
  }

  /** Saves an edited name field once the menu has closed. */
  commitRename(): void {
    if (this.deleted.getData()) return;
    const oldName = this.waypoint.name;
    if (this.name.getData().trim() === oldName) return;
    const newName = validName(this.player, this.name.getData(), oldName);
    if (newName === undefined) return;

    const waypoints = loadWaypoints();
    const target = waypoints.find((w) => w.name === oldName);
    if (!target) {
      tell(this.player, t('warp_whistle.gone'));
      return;
    }
    target.name = newName;
    if (!saveWaypoints(waypoints)) {
      tell(this.player, t('warp_whistle.set.full'));
      return;
    }
    tell(this.player, t('warp_whistle.rename.done', oldName, newName));
  }
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

/** Custom particle tinted by `variable.color`, defined in the resource pack. */
const SPARKLE_ID = 'steveo:warp_sparkle';

/** Fully saturated color at `hue` turns around the wheel (0 red, 1/3 green, 2/3 blue). */
function rainbow(hue: number): { red: number; green: number; blue: number; alpha: number } {
  const h = (((hue % 1) + 1) % 1) * 6;
  const channel = (offset: number): number => Math.max(0, Math.min(1, Math.abs(((h + offset) % 6) - 3) - 1));
  return { red: channel(0), green: channel(4), blue: channel(2), alpha: 1 };
}

function sparkle(dimension: Dimension, at: Vector3, hue: number): void {
  const vars = new MolangVariableMap();
  vars.setColorRGBA('variable.color', rainbow(hue));
  dimension.spawnParticle(SPARKLE_ID, at, vars);
}

/**
 * Two arms of sparkles climbing around the player, tightening as they rise.
 * The colors cycle through the rainbow, the arms half a wheel apart, with a
 * white end rod twinkle every few ticks.
 */
function spiral(player: Player, tick: number): void {
  const progress = tick / WINDUP_TICKS;
  const base = player.location;
  const angle = tick * 0.45;
  const radius = 1.2 - progress * 0.5;
  const height = progress * 2.4;
  for (const arm of [0, Math.PI]) {
    const at = {
      x: base.x + Math.cos(angle + arm) * radius,
      y: base.y + height,
      z: base.z + Math.sin(angle + arm) * radius,
    };
    sparkle(player.dimension, at, tick / 20 + arm / (Math.PI * 2));
    if (tick % 3 === 0) player.dimension.spawnParticle('minecraft:endrod', at);
  }
}

/** A rainbow ring around `at`, with white end rod sparkles between the colors. */
function burst(dimension: Dimension, at: Vector3): void {
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const point = { x: at.x + Math.cos(a) * 0.8, y: at.y + 1, z: at.z + Math.sin(a) * 0.8 };
    sparkle(dimension, point, i / 24);
    if (i % 3 === 0) dimension.spawnParticle('minecraft:endrod', point);
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
    const { follow } = destination;
    if (follow && !follow.isValid) {
      if (player.isValid) tell(player, t('warp_whistle.player.gone'));
      return;
    }
    const to = follow ? { location: follow.location, dimension: follow.dimension } : destination;
    try {
      const from = player.dimension;
      const fromLocation = player.location;
      player.teleport(to.location, {
        dimension: to.dimension,
        ...(destination.yaw !== undefined ? { rotation: { x: 0, y: destination.yaw } } : {}),
      });
      from.playSound('mob.endermen.portal', fromLocation, { volume: 0.7 });
      try {
        burst(from, fromLocation);
        burst(to.dimension, to.location);
      } catch {
        // Particles are decoration; a missing chunk must not fail the warp.
      }
      player.playSound('mob.endermen.portal', { volume: 0.7, pitch: 1.2 });
      tell(player, t(destination.arrivedKey ?? 'warp_whistle.arrived', destination.label));
      if (follow) tell(follow, t('warp_whistle.player.incoming', player.name));
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

// Opens in the air or at a block, but not when the click opens a chest, a bed, a door...
onItemUse((typeId) => typeId === WHISTLE_ID, (player) => handleUse(player));

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
  editing.delete(event.playerId);
});

// ---------- debug: /scriptevent steveo:warp <give|list|clear|demo> ----------

function listMessage(player: Player): RawMessage {
  const waypoints = loadWaypoints();
  const home = homeOf(player);
  const rawtext: RawMessage[] = [PREFIX, t('warp_whistle.debug.list', `${waypoints.length}`)];
  rawtext.push({ text: '\n' }, home ? t('warp_whistle.debug.list.home', describe(home.location, home.dimension.id)) : t('warp_whistle.debug.list.home.none'));
  // Newest first, numbered as in the menu.
  [...waypoints].reverse().forEach((w, i) => {
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
