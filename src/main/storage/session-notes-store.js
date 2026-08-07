'use strict';

const { sessionNotesPath } = require('../app-paths');
const { readJson, writeJson } = require('./json-store');

/**
 * Danh dau sao va ghi chu cho tung phien lam viec.
 *
 * Vi sao can: tren may nay da co 151 phien va van dang tang. Tim lai mot phien
 * cu hoan toan dua vao viec nho du tu khoa de go vao o tim; nhung phien dang
 * nho lai thi khong co cach nao danh dau.
 *
 * Cau truc: { "<sessionId>": { starred: bool, note: string, updatedAt: iso } }
 * Khoa la sessionId chu khong phai duong dan file - doi ten thu muc du an van
 * giu duoc ghi chu.
 */

const MAX_NOTE_LENGTH = 500;

function readAll() {
  const data = readJson(sessionNotesPath(), null);
  return data && typeof data === 'object' && data.notes ? data.notes : {};
}

function writeAll(notes) {
  writeJson(sessionNotesPath(), { notes });
}

/** Toan bo ghi chu, de renderer gan vao danh sach phien trong mot lan doc. */
function list() {
  return readAll();
}

function get(sessionId) {
  return readAll()[sessionId] || null;
}

/**
 * Cap nhat sao va/hoac ghi chu. Truyen thieu truong nao thi giu nguyen truong do.
 * Ban ghi rong (khong sao, khong ghi chu) bi xoa han de file khong phinh to
 * bang cac muc vo nghia.
 */
function set(sessionId, { starred, note } = {}) {
  if (!sessionId) return null;

  const notes = readAll();
  const current = notes[sessionId] || { starred: false, note: '' };

  const next = {
    starred: starred === undefined ? Boolean(current.starred) : Boolean(starred),
    note:
      note === undefined ? String(current.note || '') : String(note).slice(0, MAX_NOTE_LENGTH).trim(),
    updatedAt: new Date().toISOString(),
  };

  if (!next.starred && !next.note) {
    delete notes[sessionId];
    writeAll(notes);
    return null;
  }

  notes[sessionId] = next;
  writeAll(notes);
  return next;
}

module.exports = { list, get, set, MAX_NOTE_LENGTH };
