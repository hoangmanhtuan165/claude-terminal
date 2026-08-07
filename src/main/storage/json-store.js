'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Doc/ghi file JSON mot cach an toan.
 *
 * Ghi qua file tam roi rename: rename tren cung o dia la thao tac nguyen tu, nen
 * app bi tat dot ngot giua chung se khong de lai file JSON cut do dang.
 */

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    // File chua ton tai hoac hong -> quay ve gia tri mac dinh thay vi lam sap app.
    return fallback;
  }
}

function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

module.exports = { readJson, writeJson };
