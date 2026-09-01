export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positional: string[];
}

/**
 * Minimal argv parser: supports `--flag`, `--key=value`, `--key value`, and
 * positional arguments. Everything else is left alone.
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    // Ignore a bare `--`. pnpm forwards one verbatim when a caller writes
    // `pnpm run build -- foo` out of npm habit; without this it would be read
    // as an empty flag and swallow the argument after it. Skipping rather than
    // treating it as an end-of-flags separator means both spellings behave
    // identically, which is what someone typing either one expects.
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }

  return { flags, positional };
}

/** Reads a flag that must be a string, or undefined when absent or boolean. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

/** Returns true only for an explicitly set `--name` flag. */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

/** Returns the add-on slugs requested on the command line, or [] for "all". */
export function selectedSlugs({ flags, positional }: ParsedArgs): string[] {
  const addon = flags['addon'];
  const fromFlag = typeof addon === 'string' ? addon.split(',') : [];
  return [...fromFlag, ...positional].map((s) => s.trim()).filter(Boolean);
}
