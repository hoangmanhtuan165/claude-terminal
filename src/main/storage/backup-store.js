'use strict';

const fs = require('node:fs/promises');
const { dialog } = require('electron');
const {
  settingsPath,
  pinnedProjectsPath,
  sshHostsPath,
  workspacePresetsPath,
  sessionNotesPath,
} = require('../app-paths');
const { readJson, writeJson } = require('./json-store');

/**
 * Xuat/nhap toan bo cau hinh nguoi dung sang mot file JSON duy nhat - khong
 * phai zip that (khong can them thu vien nen), vi tat ca deu la JSON san.
 *
 * KHONG bao gom tabs.json (trang thai PTY khong the phuc hoi qua may khac) va
 * history-index/content-cache (cache suy tu transcript, tu quet lai duoc).
 */

const BACKUP_VERSION = 1;

const FILES = {
  settings: settingsPath,
  pinnedProjects: pinnedProjectsPath,
  sshHosts: sshHostsPath,
  workspacePresets: workspacePresetsPath,
  sessionNotes: sessionNotesPath,
};

async function exportBackup(win) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Xuất cấu hình KLTERMINAL',
    defaultPath: `klterminal-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'KLTERMINAL backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { saved: false };

  const bundle = { version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data: {} };
  for (const [key, pathFn] of Object.entries(FILES)) {
    bundle.data[key] = readJson(pathFn(), null);
  }

  await fs.writeFile(filePath, JSON.stringify(bundle, null, 2), 'utf8');
  return { saved: true, filePath };
}

async function importBackup(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Nhập cấu hình KLTERMINAL',
    properties: ['openFile'],
    filters: [{ name: 'KLTERMINAL backup', extensions: ['json'] }],
  });
  if (canceled || !filePaths[0]) return { imported: false };

  let bundle;
  try {
    bundle = JSON.parse(await fs.readFile(filePaths[0], 'utf8'));
  } catch {
    return { imported: false, error: 'File không đọc được - có thể hỏng hoặc không phải JSON.' };
  }
  if (!bundle || typeof bundle.data !== 'object') {
    return { imported: false, error: 'File không đúng định dạng backup của KLTERMINAL.' };
  }

  for (const [key, pathFn] of Object.entries(FILES)) {
    const value = bundle.data[key];
    if (value !== undefined && value !== null) writeJson(pathFn(), value);
  }

  return { imported: true };
}

module.exports = { exportBackup, importBackup };
