'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scrollbackDir } = require('../app-paths');

/**
 * Ghi lai toan bo output tho (ke ca ma mau ANSI) cua tung tab terminal ra dia,
 * de sau nay mo lai xem duoc dung nhu luc chay.
 *
 * PTY ban du lieu ra rat day (moi lan go phim la mot lan echo). Ghi thang xuong
 * dia moi chunk se lam nghen I/O, nen gom vao buffer va xa dinh ky.
 */

const FLUSH_INTERVAL_MS = 400;
const FLUSH_THRESHOLD_BYTES = 64 * 1024;

// Cat bot khi file vuot MAX, giu lai phan duoi KEEP. Log terminal cu khong con
// gia tri may, trong khi phien chay claude dai co the sinh hang tram MB.
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const KEEP_TAIL_BYTES = 4 * 1024 * 1024;

/** So byte doc lai khi khoi phuc tab; du de thay ngu canh gan nhat. */
const RESTORE_TAIL_BYTES = 256 * 1024;

/** Buffer cho tung tab: { chunks: string[], bytes: number, timer } */
const pending = new Map();

function logPathFor(tabId) {
  // tabId do app tu sinh (uuid) nhung van lam sach de khong the thoat khoi thu muc.
  const safeId = String(tabId).replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(scrollbackDir(), `${safeId}.log`);
}

function append(tabId, data) {
  let entry = pending.get(tabId);
  if (!entry) {
    entry = { chunks: [], bytes: 0, timer: null };
    pending.set(tabId, entry);
  }

  entry.chunks.push(data);
  entry.bytes += Buffer.byteLength(data, 'utf8');

  if (entry.bytes >= FLUSH_THRESHOLD_BYTES) {
    flush(tabId);
    return;
  }
  if (!entry.timer) {
    entry.timer = setTimeout(() => flush(tabId), FLUSH_INTERVAL_MS);
  }
}

function flush(tabId) {
  const entry = pending.get(tabId);
  if (!entry || entry.chunks.length === 0) return;

  if (entry.timer) clearTimeout(entry.timer);
  pending.delete(tabId);

  const payload = entry.chunks.join('');
  const filePath = logPathFor(tabId);

  try {
    fs.appendFileSync(filePath, payload, 'utf8');
    trimIfOversized(filePath);
  } catch {
    // Mat log scrollback khong dang de lam hong phien terminal dang chay.
  }
}

function flushAll() {
  for (const tabId of [...pending.keys()]) flush(tabId);
}

function trimIfOversized(filePath) {
  const { size } = fs.statSync(filePath);
  if (size <= MAX_FILE_BYTES) return;

  const tail = readTailBytes(filePath, KEEP_TAIL_BYTES);
  fs.writeFileSync(filePath, tail, 'utf8');
}

/**
 * Doc `maxBytes` cuoi file va giai ma utf8.
 * Cat theo byte co the roi vao giua mot ky tu nhieu byte, nen bo qua cac byte
 * tiep noi (10xxxxxx) o dau doan truoc khi decode.
 */
function readTailBytes(filePath, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const { size } = fs.fstatSync(fd);
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return '';

    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);

    let offset = 0;
    if (start > 0) {
      while (offset < buffer.length && (buffer[offset] & 0xc0) === 0x80) offset += 1;
    }
    return buffer.subarray(offset).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Noi dung dung de ve lai man hinh khi tab duoc khoi phuc. */
function readForRestore(tabId) {
  flush(tabId);
  return readTailBytes(logPathFor(tabId), RESTORE_TAIL_BYTES);
}

/** Toan bo log con luu duoc, dung cho man hinh xem lai va xuat file. */
function readFull(tabId) {
  flush(tabId);
  try {
    return fs.readFileSync(logPathFor(tabId), 'utf8');
  } catch {
    return '';
  }
}

function remove(tabId) {
  const entry = pending.get(tabId);
  if (entry?.timer) clearTimeout(entry.timer);
  pending.delete(tabId);
  try {
    fs.unlinkSync(logPathFor(tabId));
  } catch {
    // Khong co file thi khong can xoa.
  }
}

/** Don log mo coi cua nhung tab khong con trong danh sach khoi phuc. */
function pruneOrphans(liveTabIds) {
  const keep = new Set(liveTabIds);
  let files;
  try {
    files = fs.readdirSync(scrollbackDir());
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith('.log')) continue;
    if (keep.has(path.basename(file, '.log'))) continue;
    try {
      fs.unlinkSync(path.join(scrollbackDir(), file));
    } catch {
      // Bo qua file dang bi khoa.
    }
  }
}

module.exports = {
  append,
  flush,
  flushAll,
  readForRestore,
  readFull,
  remove,
  pruneOrphans,
  logPathFor,
};
