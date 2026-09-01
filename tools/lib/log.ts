const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code: string, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;

type Painter = (text: string) => string;

export const color: Record<'dim' | 'bold' | 'red' | 'green' | 'yellow' | 'cyan', Painter> = {
  dim: (t) => paint('2', t),
  bold: (t) => paint('1', t),
  red: (t) => paint('31', t),
  green: (t) => paint('32', t),
  yellow: (t) => paint('33', t),
  cyan: (t) => paint('36', t),
};

export const log = {
  info: (msg: string): void => console.log(msg),
  step: (msg: string): void => console.log(`${color.cyan('>')} ${msg}`),
  done: (msg: string): void => console.log(`${color.green('OK')} ${msg}`),
  warn: (msg: string): void => console.warn(`${color.yellow('!')} ${msg}`),
  error: (msg: string): void => console.error(`${color.red('x')} ${msg}`),
};

/**
 * Prints the message and exits with a non-zero status. Returns `never`, so
 * callers keep narrowing after a failed guard.
 */
export function fail(msg: string): never {
  log.error(msg);
  process.exit(1);
}
