/**
 * Ambient declarations for globals that Minecraft's script runtime provides on
 * top of the standard ES library.
 *
 * The runtime is not Node and not a browser: there is no `setTimeout`, no
 * `fetch`, and no filesystem. Scheduling goes through `system.run*` from
 * `@minecraft/server`. `console` output lands in the game's content log
 * (enable "Content Log GUI" / "Content Log File" in Minecraft's creator
 * settings to see it).
 */
declare const console: {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
  debug(...data: unknown[]): void;
};
