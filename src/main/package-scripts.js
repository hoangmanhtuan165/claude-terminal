'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Doc script trong package.json cua mot du an, cho muc "Chay script" tren
 * menu chuot phai sidebar - thay vi phai tu go `npm run dev`.
 *
 * Nhan dien trinh quan ly goi qua file khoa (lockfile) co san trong thu muc,
 * vi cau lenh chay script khac nhau giua npm/yarn/pnpm/bun.
 */

function detectPackageManager(cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'bun.lockb'))) return 'bun';
  return 'npm';
}

function commandFor(pm, scriptName) {
  if (pm === 'yarn') return `yarn ${scriptName}`;
  if (pm === 'pnpm') return `pnpm run ${scriptName}`;
  if (pm === 'bun') return `bun run ${scriptName}`;
  // `npm start` la quy uoc pho bien hon `npm run start` du hai cau tuong duong.
  return scriptName === 'start' ? 'npm start' : `npm run ${scriptName}`;
}

/** Danh sach { name, command } tu package.json cua thu muc, rong neu khong co/khong doc duoc. */
function listScripts(cwd) {
  try {
    const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return [];

    const pm = detectPackageManager(cwd);
    return Object.keys(pkg.scripts)
      .slice(0, 20)
      .map((name) => ({ name, command: commandFor(pm, name) }));
  } catch {
    return [];
  }
}

module.exports = { listScripts };
