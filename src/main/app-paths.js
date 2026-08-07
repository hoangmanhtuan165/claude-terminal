'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { app } = require('electron');

/**
 * Tap trung moi duong dan file ma app doc/ghi.
 *
 * Claude Code luu transcript tai <config>/projects/<cwd-da-ma-hoa>/<session-id>.jsonl.
 * Bien moi truong CLAUDE_CONFIG_DIR co the doi vi tri nay nen phai ton trong no.
 */

function resolveClaudeConfigDir() {
  // Doi ho so tai khoan: app tu khoi dong lai kem tham so nay (xem
  // account-profiles.js). Uu tien hon bien moi truong vi day la lua chon nguoi
  // dung vua bam, con bien moi truong co the la thu thua ke tu shell cha.
  const fromArg = process.argv.find((arg) => arg.startsWith('--claude-config-dir='));
  if (fromArg) {
    const value = fromArg.slice('--claude-config-dir='.length).trim();
    if (value) return path.resolve(value);
  }

  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.claude');
}

const claudeConfigDir = resolveClaudeConfigDir();
const claudeProjectsDir = path.join(claudeConfigDir, 'projects');

// userData chi san sang sau khi app khoi tao xong phan nao, nhung Electron cho
// phep goi truoc 'ready'. Lazy-init de tranh phu thuoc thu tu require.
let cachedUserData = null;
function userDataDir() {
  if (!cachedUserData) cachedUserData = app.getPath('userData');
  return cachedUserData;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Thu muc chua log scrollback tho cua tung tab terminal. */
function scrollbackDir() {
  return ensureDir(path.join(userDataDir(), 'scrollback'));
}

/** Thu muc chua anh dan tu clipboard, cho ghep vao terminal duoi dang duong dan file. */
function pastedImagesDir() {
  return ensureDir(path.join(userDataDir(), 'pasted-images'));
}

/** File luu danh sach tab dang mo de khoi phuc o lan chay sau. */
function tabsStatePath() {
  return path.join(userDataDir(), 'tabs.json');
}

/** Cache metadata cua toan bo transcript, tranh quet lai tu dau moi lan mo app. */
function historyIndexPath() {
  return path.join(userDataDir(), 'history-index.json');
}

/**
 * Cache noi dung hoi thoai da rut gon cua tung phien.
 *
 * Do tren du lieu that: phan hoi thoai chi chiem 0,6% dung luong transcript,
 * phan con lai la ket qua cong cu. Tach rieng phan hoi thoai giup viec tim
 * kiem doc vai chuc MB thay vi gan 2GB.
 */
function contentCacheDir() {
  return ensureDir(path.join(userDataDir(), 'content-cache'));
}

/** Danh sach thu muc du an nguoi dung tu ghim them. */
function pinnedProjectsPath() {
  return path.join(userDataDir(), 'pinned-projects.json');
}

/**
 * Danh dau sao va ghi chu cho tung phien.
 *
 * De rieng file, khong nhet vao history-index.json: chi muc do la cache co the
 * dung lai bat cu luc nao (doi INDEX_VERSION la mat sach), con day la du lieu
 * nguoi dung tu nhap, mat la khong dung lai duoc.
 */
function sessionNotesPath() {
  return path.join(userDataDir(), 'session-notes.json');
}

/** Tuy chon nguoi dung (theme, ...). */
function settingsPath() {
  return path.join(userDataDir(), 'settings.json');
}

/** Log cac crash/exception cap tien trinh, doc lai khi app tu tat bat thuong. */
function crashLogPath() {
  return path.join(userDataDir(), 'crash.log');
}

module.exports = {
  claudeConfigDir,
  claudeProjectsDir,
  userDataDir,
  scrollbackDir,
  pastedImagesDir,
  tabsStatePath,
  historyIndexPath,
  contentCacheDir,
  pinnedProjectsPath,
  sessionNotesPath,
  settingsPath,
  crashLogPath,
  ensureDir,
};
