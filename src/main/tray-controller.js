'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Tray, Menu, globalShortcut } = require('electron');

/**
 * Bieu tuong khay he thong + phim tat toan cuc bat/tat cua so (kieu terminal
 * "Quake"). Tach khoi main.js vi ipc-handlers.js cung can goi lai
 * registerToggleHotkey() khi nguoi dung doi phim tat trong cai dat, ma
 * main.js lai la diem vao khong export gi ra ngoai.
 */

const devIconPath = path.join(__dirname, '..', '..', 'build', 'icon.ico');

function trayIconPath() {
  return fs.existsSync(devIconPath)
    ? devIconPath
    : path.join(process.resourcesPath || '', 'build', 'icon.ico');
}

let getWindow = () => null;
let requestQuit = () => {};
let tray = null;
let registeredHotkey = null;

function configure({ getWindow: gw, requestQuit: rq }) {
  getWindow = gw;
  requestQuit = rq;
}

/**
 * Chi tao khi nguoi dung bat minimizeToTray hoac dat phim tat - da so nguoi
 * dung mong doi dong cua so la thoat han (hanh vi Windows thong thuong),
 * khong nen luon co mot icon nam san trong khay ma khong ai yeu cau.
 */
function ensureTray() {
  if (tray) return tray;
  const iconPath = trayIconPath();
  if (!fs.existsSync(iconPath)) return null;

  tray = new Tray(iconPath);
  tray.setToolTip('KLTERMINAL');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mở KLTERMINAL', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Thoát', click: () => requestQuit() },
    ]),
  );
  tray.on('click', () => showWindow());
  return tray;
}

function destroyTray() {
  tray?.destroy();
  tray = null;
}

function showWindow() {
  const win = getWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function hideWindow() {
  const win = getWindow();
  if (!win) return;
  win.hide();
  ensureTray();
}

function toggleVisibility() {
  const win = getWindow();
  if (!win) return;
  if (win.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

/** Dang ky lai phim tat toan cuc, huy dang ky cai cu truoc neu co. Chuoi rong = tat. */
function registerToggleHotkey(accelerator) {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }
  if (!accelerator) return { ok: true, hotkey: '' };

  try {
    const success = globalShortcut.register(accelerator, toggleVisibility);
    if (!success) return { ok: false, hotkey: '', error: 'Tổ hợp phím này đã được ứng dụng khác dùng.' };
    registeredHotkey = accelerator;
    return { ok: true, hotkey: accelerator };
  } catch {
    return { ok: false, hotkey: '', error: 'Tổ hợp phím không hợp lệ.' };
  }
}

function unregisterAll() {
  globalShortcut.unregisterAll();
  registeredHotkey = null;
}

module.exports = {
  trayIconPath,
  configure,
  ensureTray,
  destroyTray,
  showWindow,
  hideWindow,
  toggleVisibility,
  registerToggleHotkey,
  unregisterAll,
};
