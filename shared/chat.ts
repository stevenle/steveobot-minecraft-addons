/** Helpers for talking to players in chat. */
import { world, type Player, type RawMessage } from '@minecraft/server';

/** Minecraft chat formatting codes, so call sites do not sprinkle raw escapes. */
export const Format = {
  reset: '§r',
  bold: '§l',
  gray: '§7',
  red: '§c',
  green: '§a',
  yellow: '§e',
  aqua: '§b',
} as const;

/** Sends a message to every player currently in the world. */
export function broadcast(message: string | RawMessage): void {
  world.sendMessage(message);
}

/** Sends a message prefixed with a dimmed add-on tag, e.g. `[Hello World] hi`. */
export function tell(player: Player, tag: string, message: string): void {
  player.sendMessage(`${Format.gray}[${tag}]${Format.reset} ${message}`);
}
