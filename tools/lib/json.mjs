import fs from 'node:fs';

/**
 * Removes `//` and comments from a JSON document. Bedrock content
 * files are frequently authored with comments, and the game tolerates them, so
 * our tooling has to as well.
 */
export function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }

  return out;
}

/** Reads a JSON file, tolerating comments and a UTF-8 BOM. */
export function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${err.message}`);
  }
}

/** Writes a JSON file with two-space indentation and a trailing newline. */
export function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
