#!/usr/bin/env node
/** Removes all build output. Usage: node tools/clean.ts */
import { rmrf } from './lib/fsx.ts';
import { log } from './lib/log.ts';
import { distDir, rel } from './lib/paths.ts';

rmrf(distDir);
log.done(`Removed ${rel(distDir)}`);
