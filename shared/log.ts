/**
 * Namespaced logging for add-on scripts.
 *
 * Output goes to the game's content log, not to chat. Use `broadcast()` from
 * `@shared/chat` when a message is meant for players.
 */

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

/** Creates a logger that prefixes every line with `[namespace]`. */
export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;
  return {
    debug: (message) => console.debug(`${prefix} ${message}`),
    info: (message) => console.info(`${prefix} ${message}`),
    warn: (message) => console.warn(`${prefix} ${message}`),
    error: (message, error) => {
      const detail = error instanceof Error ? `: ${error.message}` : error !== undefined ? `: ${String(error)}` : '';
      console.error(`${prefix} ${message}${detail}`);
    },
  };
}
