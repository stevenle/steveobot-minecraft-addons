const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const color = {
  dim: (t) => paint('2', t),
  bold: (t) => paint('1', t),
  red: (t) => paint('31', t),
  green: (t) => paint('32', t),
  yellow: (t) => paint('33', t),
  cyan: (t) => paint('36', t),
};

export const log = {
  info: (msg) => console.log(msg),
  step: (msg) => console.log(`${color.cyan('>')} ${msg}`),
  done: (msg) => console.log(`${color.green('OK')} ${msg}`),
  warn: (msg) => console.warn(`${color.yellow('!')} ${msg}`),
  error: (msg) => console.error(`${color.red('x')} ${msg}`),
};

/** Prints the message and exits with a non-zero status. */
export function fail(msg) {
  log.error(msg);
  process.exit(1);
}
