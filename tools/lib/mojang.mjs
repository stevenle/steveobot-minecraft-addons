import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Known install locations of the `com.mojang` data folder, keyed by deploy
 * target. Everything is expressed as a list of candidates because the same
 * target lives in different places depending on platform (native Windows,
 * WSL, or a Linux/macOS launcher).
 */
const WINDOWS_PACKAGES = {
  stable: 'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
  preview: 'Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe',
};

export const DEPLOY_TARGETS = ['stable', 'preview', 'education'];

function windowsCandidates(target) {
  const localAppData = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  const out = [];

  if (target === 'education' && appData) {
    out.push(path.join(appData, 'Minecraft Education Edition', 'games', 'com.mojang'));
    return out;
  }
  const pkg = WINDOWS_PACKAGES[target];
  if (pkg && localAppData) {
    out.push(path.join(localAppData, 'Packages', pkg, 'LocalState', 'games', 'com.mojang'));
  }
  return out;
}

/** Windows installs reachable from inside WSL through the /mnt/c mount. */
function wslCandidates(target) {
  const out = [];
  const usersDir = '/mnt/c/Users';
  if (!fs.existsSync(usersDir)) return out;

  let users = [];
  try {
    users = fs
      .readdirSync(usersDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !['Public', 'Default', 'All Users'].includes(e.name))
      .map((e) => e.name);
  } catch {
    return out;
  }

  for (const user of users) {
    if (target === 'education') {
      out.push(path.join(usersDir, user, 'AppData/Roaming/Minecraft Education Edition/games/com.mojang'));
      continue;
    }
    const pkg = WINDOWS_PACKAGES[target];
    if (!pkg) continue;
    out.push(path.join(usersDir, user, 'AppData/Local/Packages', pkg, 'LocalState/games/com.mojang'));
  }
  return out;
}

/** Community Linux launcher (mcpelauncher) and Bedrock Dedicated Server. */
function unixCandidates() {
  const home = os.homedir();
  return [
    path.join(home, '.local/share/mcpelauncher/games/com.mojang'),
    path.join(home, 'Library/Application Support/mcpelauncher/games/com.mojang'),
  ];
}

/**
 * Resolves the `com.mojang` folder to deploy into.
 *
 * Resolution order: explicit `dir` argument, then the MINECRAFT_COM_MOJANG
 * environment variable, then the known per-platform locations for `target`.
 * Returns `{ dir, source }`, or `{ dir: null, candidates }` when nothing was
 * found so the caller can print an actionable error.
 */
export function resolveMojangDir({ target = 'stable', dir = null } = {}) {
  if (dir) {
    return { dir: path.resolve(dir), source: 'the --dir flag', checked: [] };
  }
  const fromEnv = process.env.MINECRAFT_COM_MOJANG;
  if (fromEnv) {
    return { dir: path.resolve(fromEnv), source: 'MINECRAFT_COM_MOJANG', checked: [] };
  }

  const candidates = [
    ...windowsCandidates(target),
    ...wslCandidates(target),
    ...unixCandidates(),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { dir: candidate, source: `the detected ${target} install`, checked: candidates };
    }
  }
  return { dir: null, source: null, checked: candidates };
}
