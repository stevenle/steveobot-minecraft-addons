/**
 * A chest-styled action form.
 *
 * The resource pack's `ui/server_form.json` (from Chest-UI, CC-BY-4.0,
 * https://github.com/Herobrine643928/Chest-UI) restyles any action form whose
 * title starts with a size flag such as `§c§h§e§s§t§2§7§r` into a chest grid,
 * and draws every button after the grid as the player's inventory: the first
 * nine in a hotbar row, the next 27 in the main grid. The button text carries
 * the stack size and durability in a `stack#NNdur#NN§r` prefix that the UI
 * parses, and the button icon is a numeric item id (times 65536, plus 32768
 * for an enchant glint) or a plain texture path.
 *
 * This is a typed re-implementation of Chest-UI's `ChestFormData` that lets
 * the caller append the inventory itself, so empty inventory slots are drawn
 * as empty and slot positions mirror the real inventory screen.
 */
import { BlockTypes, ItemTypes, type ItemStack, type Player, type RawMessage } from '@minecraft/server';
import { ActionFormData, type ActionFormResponse } from '@minecraft/server-ui';

import { typeIdToDataId, typeIdToID } from './typeIds.js';

/** Title prefix that switches the form UI to the 27-slot chest layout. */
const CHEST_27_FLAG = '§c§h§e§s§t§2§7§r';
export const CHEST_27_SLOTS = 27;

/** Vanilla ids at or above this are shifted by the number of custom items
 * registered in the world (custom items take ids in that range first). */
const CUSTOM_SHIFT_FROM = 850;

/** Icon texture paths for items the vanilla id table cannot know about. Any
 * other custom item falls back to `textures/items/<name>`. */
const CUSTOM_ICONS: Readonly<Record<string, string>> = {
  'steveo:backpack': 'textures/items/backpack',
  'steveo:dog_crown': 'textures/items/dog_crown',
  'steveo:explosive_enchantment': 'textures/items/explosive_enchantment',
  'steveo:freezeray_gun': 'textures/items/freezeray_gun',
  'steveo:golden_snitch': 'textures/items/golden_snitch',
  'steveo:portal_gun': 'textures/items/portal_gun_blue',
  'steveo:portal_gun_orange': 'textures/items/portal_gun_orange',
  'steveo:potato_crossbow': 'textures/items/potato_crossbow',
  'steveo:potato_crossbow_explosive': 'textures/items/potato_crossbow_explosive',
  'steveo:potato_launcher': 'textures/items/potato_launcher',
  'steveo:potato_launcher_explosive': 'textures/items/potato_launcher_explosive',
  'steveo:xray_helmet': 'textures/items/xray_helmet',
};

let customItemCount: number | undefined;

/** How many non-vanilla, non-block items the world has registered. Computed
 * once; the set of item types cannot change while the world is running. */
function countCustomItems(): number {
  if (customItemCount === undefined) {
    customItemCount = ItemTypes.getAll().filter(
      (type) => !type.id.startsWith('minecraft:') && BlockTypes.get(type.id) === undefined,
    ).length;
  }
  return customItemCount;
}

/** The icon argument for `ActionFormData.button` that draws `typeId`. */
export function iconFor(typeId: string, enchanted = false): string {
  const id = typeIdToDataId.get(typeId) ?? typeIdToID.get(typeId);
  if (id !== undefined) {
    const shifted = id + (id < CUSTOM_SHIFT_FROM ? 0 : countCustomItems());
    return String(shifted * 65536 + (enchanted ? 32768 : 0));
  }
  return CUSTOM_ICONS[typeId] ?? `textures/items/${typeId.replace(/^[^:]*:/, '')}`;
}

export interface SlotButton {
  name: RawMessage;
  lore: string[];
  icon: string;
  /** 1–99; drawn in the corner of the slot. */
  stack: number;
  /** 0 hides the bar; 1–99 is the fraction of durability left. */
  durability: number;
}

/** Describes an item stack the way the chest UI wants it drawn. */
export function describeItem(item: ItemStack): SlotButton {
  const durability = item.getComponent('minecraft:durability');
  const enchanted = (item.getComponent('minecraft:enchantable')?.getEnchantments().length ?? 0) > 0;
  const name: RawMessage = item.nameTag !== undefined ? { text: item.nameTag } : { translate: item.localizationKey };
  return {
    name,
    lore: item.getLore(),
    icon: iconFor(item.typeId, enchanted),
    stack: Math.min(99, Math.max(1, item.amount)),
    durability:
      durability && durability.damage > 0
        ? Math.max(1, Math.round(((durability.maxDurability - durability.damage) / durability.maxDurability) * 99))
        : 0,
  };
}

/** A 27-slot chest form followed by a 36-slot inventory mirror. */
export class ChestForm {
  readonly #form: ActionFormData;

  constructor(title: RawMessage) {
    this.#form = new ActionFormData().title({ rawtext: [{ text: CHEST_27_FLAG }, title] });
  }

  /** Adds the next slot. Pass `undefined` for an empty slot. */
  slot(button: SlotButton | undefined): this {
    if (!button) {
      this.#form.button('');
      return this;
    }
    const prefix = `stack#${String(button.stack).padStart(2, '0')}dur#${String(button.durability).padStart(2, '0')}§r`;
    const text: RawMessage = {
      rawtext: [{ text: prefix }, button.name, { text: '§r' }, ...button.lore.map((line) => ({ text: `\n${line}` }))],
    };
    this.#form.button(text, button.icon);
    return this;
  }

  show(player: Player): Promise<ActionFormResponse> {
    return this.#form.show(player);
  }
}
