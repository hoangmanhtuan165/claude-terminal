'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { contentCacheDir } = require('../app-paths');
const { readJson, writeJson } = require('../storage/json-store');
const workerClient = require('./history-worker-client');

/**
 * Cache noi dung hoi thoai da rut gon cua tung phien.
 *
 * Ly do ton tai (do tren du lieu that cua may nay): transcript chiem 1,74GB,
 * nhung phan hoi thoai that su chi la 0,6% cua so do - con lai la ket qua cong
 * cu nhu noi dung file va output lenh. Neu tim thang tren transcript goc thi
 * moi lan tim deu phai doc gan 2GB de lay ra vai chuc MB co nghia.
 *
 * Cache tu giu so ghi rieng ve tinh hop le, khong dua vao phien ban cua chi
 * muc metadata. Nho vay khi cau truc metadata doi (vi du sua cach dat tieu de)
 * thi chi can doc lai vai chuc KB dau moi file, khong phai rut gon lai ca
 * 1,74GB.
 */

const MANIFEST_VERSION = 1;

function cachePathFor(sessionId) {
  return path.join(contentCacheDir(), `${sessionId}.jsonl`);
}

function manifestPath() {
  return path.join(contentCacheDir(), 'manifest.json');
}

function loadManifest() {
  const data = readJson(manifestPath(), null);
  if (!data || data.version !== MANIFEST_VERSION || !data.entries) {
    return { version: MANIFEST_VERSION, entries: {} };
  }
  return data;
}

/**
 * Cache cua phien nay con dung khong?
 * Dung khi file cache ton tai va duoc dung tu dung phien ban file goc hien tai.
 */
function isFresh(session) {
  const entry = loadManifest().entries[session.sessionId];
  if (!entry) return false;
  if (entry.mtimeMs !== session.mtimeMs || entry.sizeBytes !== session.sizeBytes) return false;
  return fs.existsSync(cachePathFor(session.sessionId));
}

function toJob(session) {
  return {
    sessionId: session.sessionId,
    cachePath: cachePathFor(session.sessionId),
    sources: [
      { path: session.filePath, isSubagent: false },
      ...(session.subagentFiles || []).map((filePath) => ({ path: filePath, isSubagent: true })),
    ],
  };
}

/** Dung cache cho danh sach phien chi dinh, roi ghi lai so hop le. */
function build(sessions, { onProgress } = {}) {
  const jobs = sessions.map(toJob);
  if (jobs.length === 0) return Promise.resolve({ built: 0, messages: 0 });

  return new Promise((resolve) => {
    workerClient.post(
      'cache',
      { type: 'buildCache', jobs },
      {
        onProgress,
        onDone: (result) => {
          const manifest = loadManifest();
          for (const session of sessions) {
            manifest.entries[session.sessionId] = {
              mtimeMs: session.mtimeMs,
              sizeBytes: session.sizeBytes,
            };
          }
          writeJson(manifestPath(), manifest);
          resolve(result);
        },
        onError: () => resolve({ built: 0, messages: 0, failed: true }),
      },
    );
  });
}

/** Doc toi da 64KB dau file cache - du xa de gap prompt thuc chat dau tien. */
const TITLE_SCAN_BYTES = 64 * 1024;

/**
 * Lay tieu de tu cache noi dung.
 *
 * Chinh xac hon lay tu dau file goc: metadata chi doc 192KB dau transcript, ma
 * o nhung phien mo dau bang mot chuoi slash command dai thi cau thuc chat nam
 * xa hon the. Cache thi da loc san chi con hoi thoai nen prompt that nam ngay
 * nhung dong dau.
 */
function readTitle(sessionId, isMeaningful) {
  let fd;
  try {
    fd = fs.openSync(cachePathFor(sessionId), 'r');
    const buffer = Buffer.alloc(TITLE_SCAN_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, TITLE_SCAN_BYTES, 0);

    for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        // Dong cuoi doan doc co the bi cat ngang.
        continue;
      }
      if (entry.r !== 'user' || entry.s) continue;
      const text = String(entry.x || '').trim();
      if (isMeaningful(text)) return text;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Xoa cache cua nhung phien khong con ton tai tren dia. */
function pruneOrphans(liveSessionIds) {
  const keep = new Set(liveSessionIds);
  let files;
  try {
    files = fs.readdirSync(contentCacheDir());
  } catch {
    return 0;
  }

  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;
    const sessionId = path.basename(file, '.jsonl');
    if (keep.has(sessionId)) continue;
    try {
      fs.unlinkSync(path.join(contentCacheDir(), file));
      removed += 1;
    } catch {
      // File dang bi khoa; lan quet sau se don.
    }
  }

  if (removed > 0) {
    const manifest = loadManifest();
    for (const sessionId of Object.keys(manifest.entries)) {
      if (!keep.has(sessionId)) delete manifest.entries[sessionId];
    }
    writeJson(manifestPath(), manifest);
  }
  return removed;
}

module.exports = { build, isFresh, readTitle, pruneOrphans, cachePathFor };
