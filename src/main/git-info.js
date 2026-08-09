'use strict';

const { execFile } = require('node:child_process');

/**
 * Nhanh git hien tai cua mot thu muc - dung cho thanh trang thai va bien
 * {{branch}} trong thu vien prompt.
 *
 * Cache ngan: status bar hoi lai moi lan doi tab/focus, khong nen spawn git
 * lien tuc cho cung mot thu muc trong vai giay lien nhau.
 */

const CACHE_TTL_MS = 5000;
/** cwd (chu thuong) -> { branch, ts } */
const cache = new Map();

function getBranch(cwd) {
  return new Promise((resolve) => {
    if (!cwd) return resolve(null);
    const key = String(cwd).toLowerCase();

    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return resolve(cached.branch);

    execFile('git', ['branch', '--show-current'], { cwd, timeout: 3000 }, (error, stdout) => {
      const branch = !error && stdout.trim() ? stdout.trim() : null;
      cache.set(key, { branch, ts: Date.now() });
      resolve(branch);
    });
  });
}

module.exports = { getBranch };
