#!/usr/bin/env node
/** Removes all build output. Usage: node tools/clean.mjs */
import { rmrf } from './lib/fsx.mjs';
import { log } from './lib/log.mjs';
import { distDir, rel } from './lib/paths.mjs';

rmrf(distDir);
log.done(`Removed ${rel(distDir)}`);
