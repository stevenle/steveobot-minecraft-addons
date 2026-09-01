/**
 * Minimal argv parser: supports `--flag`, `--key=value`, `--key value`, and
 * positional arguments. Everything else is left alone.
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
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

/** Returns the add-on slugs requested on the command line, or [] for "all". */
export function selectedSlugs({ flags, positional }) {
  const fromFlag = typeof flags.addon === 'string' ? flags.addon.split(',') : [];
  return [...fromFlag, ...positional].map((s) => s.trim()).filter(Boolean);
}
