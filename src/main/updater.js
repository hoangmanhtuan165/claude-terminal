'use strict';

const { autoUpdater } = require('electron-updater');

/**
 * Tu dong cap nhat qua GitHub Releases (repo cong khai, khong can token luc
 * chay - xem package.json build.publish). Tai xuong CHI khi nguoi dung bam
 * dong y tren banner, khong tu tai ngam de khong ton bang thong nguoi dung
 * khong hay biet.
 */

let sendToRenderer = () => {};
let bound = false;

function setRendererSink(fn) {
  sendToRenderer = fn;
}

function init() {
  if (bound) return;
  bound = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => sendToRenderer('update:status', { phase: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    sendToRenderer('update:status', { phase: 'available', version: info.version }),
  );
  autoUpdater.on('update-not-available', () => sendToRenderer('update:status', { phase: 'idle' }));
  autoUpdater.on('download-progress', (progress) =>
    sendToRenderer('update:status', { phase: 'downloading', percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    sendToRenderer('update:status', { phase: 'ready', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    sendToRenderer('update:status', { phase: 'error', message: err?.message || String(err) }),
  );
}

async function check() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendToRenderer('update:status', { phase: 'error', message: err?.message || String(err) });
  }
}

/** Nguoi dung bam "Tải xuống" sau khi banner bao co ban moi. */
async function download() {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    sendToRenderer('update:status', { phase: 'error', message: err?.message || String(err) });
  }
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { init, setRendererSink, check, download, quitAndInstall };
