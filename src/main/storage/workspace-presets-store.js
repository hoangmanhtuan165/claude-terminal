'use strict';

const crypto = require('node:crypto');
const { workspacePresetsPath } = require('../app-paths');
const { readJson, writeJson } = require('./json-store');

/**
 * Bo tab da luu ten de mo lai hang loat ("khong gian lam viec").
 *
 * Chi luu Y DINH (thu muc + loai phien), khong luu resumeSessionId cua
 * claude-resume: giong triet ly restore() luc mo app (xem terminal-tabs.js) -
 * tu dong noi tiep mot phien claude cu co the da rat cu vao thoi diem mo lai
 * preset, va se tu dong ton token ngoai y muon. Preset "claude" luon mo phien
 * MOI, nguoi dung tu bam "Noi tiep" tren banner neu can.
 */

function listPresets() {
  const data = readJson(workspacePresetsPath(), null);
  return Array.isArray(data?.presets) ? data.presets : [];
}

function sanitizeTab(tab) {
  let sessionType = tab?.sessionType === 'claude-resume' ? 'claude' : tab?.sessionType;
  if (!['shell', 'claude', 'ssh'].includes(sessionType)) sessionType = 'shell';
  return {
    cwd: sessionType === 'ssh' ? null : typeof tab?.cwd === 'string' ? tab.cwd.slice(0, 500) : null,
    sessionType,
    sshHostId: sessionType === 'ssh' && typeof tab?.sshHostId === 'string' ? tab.sshHostId.slice(0, 64) : null,
  };
}

function savePreset(name, tabs) {
  const presets = listPresets();
  const preset = {
    id: crypto.randomUUID(),
    name: String(name || '').trim().slice(0, 60) || 'Không gian làm việc',
    tabs: Array.isArray(tabs) ? tabs.map(sanitizeTab).slice(0, 20) : [],
    createdAt: new Date().toISOString(),
  };
  presets.unshift(preset);
  writeJson(workspacePresetsPath(), { presets });
  return preset;
}

function removePreset(id) {
  const presets = listPresets().filter((p) => p.id !== id);
  writeJson(workspacePresetsPath(), { presets });
  return presets;
}

module.exports = { listPresets, savePreset, removePreset };
