'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const { userDataDir, claudeConfigDir } = require('../app-paths');
const { readJson, writeJson } = require('./json-store');
const accountStatus = require('./account-status');

/**
 * Ho so tai khoan: moi ho so la mot thu muc cau hinh Claude Code rieng.
 *
 * Claude Code doc bien moi truong `CLAUDE_CONFIG_DIR` de biet lay cau hinh o
 * dau - ke ca thong tin dang nhap lan lich su phien. Tro bien do sang thu muc
 * khac tuc la dung mot tai khoan khac, hoan toan tach biet.
 *
 * VI SAO PHAI KHOI DONG LAI APP KHI DOI HO SO:
 * `claudeConfigDir` va `claudeProjectsDir` duoc tinh MOT LAN luc nap module,
 * roi nhieu cho giu tham chieu truc tiep (history-index, ipc-handlers...).
 * Doi giua chung thi phan lich su da nap se lech voi phan moi - vua sai vua co
 * nguy co ghi cache cua tai khoan nay de len tai khoan kia. Khoi dong lai la
 * cach duy nhat dam bao moi module cung nhin thay mot thu muc.
 *
 * App khong bao gio dong vao `.credentials.json` cua bat ky ho so nao; dang
 * nhap van do `claude /login` chay trong terminal cua ho so do lo.
 */

function profilesPath() {
  return path.join(userDataDir(), 'account-profiles.json');
}

/** Thu muc cau hinh mac dinh, dung khi nguoi dung chua tao ho so nao. */
function defaultConfigDir() {
  return path.join(os.homedir(), '.claude');
}

function readStore() {
  const data = readJson(profilesPath(), null);
  const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
  return { profiles, activeId: data?.activeId || null };
}

/**
 * Danh sach ho so kem trang thai dang nhap cua tung ho so.
 * Luon co it nhat mot muc "Mac dinh" tro toi ~/.claude.
 */
function list() {
  const store = readStore();
  const current = path.resolve(claudeConfigDir);

  const entries = [
    { id: 'default', name: 'Mặc định', configDir: defaultConfigDir(), builtIn: true },
    ...store.profiles,
  ];

  return entries.map((profile) => {
    const dir = path.resolve(profile.configDir);
    return {
      ...profile,
      configDir: dir,
      // Ho so nao dang duoc dung: so voi thu muc app that su khoi dong cung.
      isActive: dir === current,
      // Doc rieng trang thai cua tung ho so de biet cai nao con dang nhap.
      account: accountStatus.read(dir),
    };
  });
}

/** Them mot ho so moi. Thu muc se do chinh `claude /login` tao khi dang nhap. */
function add({ name, configDir }) {
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanDir = path.resolve(String(configDir || '').trim());
  if (!cleanName || !cleanDir) return list();

  const store = readStore();
  // Trung thu muc thi coi nhu da co, khong them ban sao.
  if (store.profiles.some((p) => path.resolve(p.configDir) === cleanDir)) return list();

  store.profiles.push({ id: `p${Date.now()}`, name: cleanName, configDir: cleanDir });
  writeJson(profilesPath(), store);
  return list();
}

function remove(id) {
  const store = readStore();
  store.profiles = store.profiles.filter((p) => p.id !== id);
  writeJson(profilesPath(), store);
  return list();
}

/**
 * Doi sang mot ho so: khoi dong lai app voi CLAUDE_CONFIG_DIR moi.
 *
 * Tra ve false neu thu muc khong dung duoc, de giao dien bao loi thay vi khoi
 * dong lai roi hong.
 */
function switchTo(configDir) {
  const dir = path.resolve(String(configDir || '').trim());
  if (!dir) return false;

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    return false;
  }

  // `app.relaunch` chi nhan `args`/`execPath`, KHONG co tuy chon `env` (da tra
  // tai lieu Electron de xac nhan). Vi vay truyen thu muc qua tham so dong
  // lenh, roi doc lai o app-paths luc khoi dong.
  //
  // Phai giu lai cac tham so cu (tru --claude-config-dir de khong bi lap) va
  // bo argv[0] la duong dan thuc thi. Ban dong goi co argv = [exe, ...co],
  // ban dev co argv = [electron, '.', ...co] nen phai giu ca duong dan app.
  const keep = process.argv.slice(1).filter((arg) => !arg.startsWith('--claude-config-dir='));
  app.relaunch({ args: [...keep, `--claude-config-dir=${dir}`] });
  app.exit(0);
  return true;
}

module.exports = { list, add, remove, switchTo, defaultConfigDir };
