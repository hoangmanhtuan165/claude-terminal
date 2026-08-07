'use strict';

const path = require('node:path');
const { tabsStatePath, pinnedProjectsPath, settingsPath } = require('../app-paths');
const { readJson, writeJson } = require('./json-store');

const DEFAULT_SETTINGS = {
  // 'system' bam theo cai dat sang/toi cua Windows; 'dark' | 'light' la co dinh.
  theme: 'system',
  // An cac phien qua ngan trong danh sach lich su (xem SMALL_SESSION_BYTES o
  // history-panel.js). Mac dinh bat vi tren du lieu that nhom nay chiem hon
  // mot phan ba danh sach.
  hideSmallSessions: true,
  // Duong dan thu muc du an nguoi dung da chu dong an khoi sidebar - thuong
  // vi thu muc do da bi xoa/doi ten nhung transcript cu van con. Khong dung
  // toi du lieu goc (transcript van doc lai duoc), chi la khong hien o day nua.
  hiddenProjects: [],
  // Du an nguoi dung chon mo claude voi --dangerously-skip-permissions - moi
  // tab claude moi mo trong thu muc nay se tu dong bo qua toan bo xin quyen.
  // Chi anh huong tab MOI, khong doi duoc tien trinh dang chay san.
  skipPermissionsProjects: [],
};

/**
 * Trang thai khong gian lam viec: danh sach tab dang mo va cac du an duoc ghim.
 *
 * Tab duoc luu de lan mo app sau khoi phuc lai dung thu muc va scrollback cu.
 * Tien trinh PTY thi khong the khoi phuc - no chet cung app - nen tab khoi phuc
 * se co mot phien shell moi nam duoi phan lich su da ve lai.
 */

function loadTabs() {
  const state = readJson(tabsStatePath(), null);
  if (!state || !Array.isArray(state.tabs)) return { tabs: [], activeTabId: null };
  return { tabs: state.tabs, activeTabId: state.activeTabId || null };
}

function saveTabs(state) {
  const tabs = (state?.tabs || []).map((tab) => ({
    id: tab.id,
    title: tab.title,
    cwd: tab.cwd,
    sessionType: tab.sessionType,
    resumeSessionId: tab.resumeSessionId || null,
    createdAt: tab.createdAt || null,
    // Tab co the chia doi thanh hai pane, moi pane la mot PTY rieng. Cac truong
    // o tren van giu nguyen y nghia cu (lay tu pane dau) de file nay doc duoc
    // ca o ban app truoc khi co tinh nang chia doi.
    splitRatio: typeof tab.splitRatio === 'number' ? tab.splitRatio : 0.5,
    panes: Array.isArray(tab.panes)
      ? tab.panes.map((pane) => ({
          id: pane.id,
          cwd: pane.cwd || null,
          sessionType: pane.sessionType || 'shell',
        }))
      : [],
  }));
  writeJson(tabsStatePath(), { tabs, activeTabId: state?.activeTabId || null });
}

function listPinnedProjects() {
  const data = readJson(pinnedProjectsPath(), null);
  return Array.isArray(data?.projects) ? data.projects : [];
}

function addPinnedProject(cwd) {
  const projects = listPinnedProjects();
  const normalized = path.resolve(cwd);

  if (projects.some((p) => path.resolve(p.cwd) === normalized)) return projects;

  projects.unshift({ cwd: normalized, name: path.basename(normalized) || normalized });
  writeJson(pinnedProjectsPath(), { projects });
  return projects;
}

function removePinnedProject(cwd) {
  const normalized = path.resolve(cwd);
  const projects = listPinnedProjects().filter((p) => path.resolve(p.cwd) !== normalized);
  writeJson(pinnedProjectsPath(), { projects });
  return projects;
}

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(readJson(settingsPath(), null) || {}) };
}

function updateSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(settingsPath(), next);
  return next;
}

function isSkipPermissionsProject(cwd, settings = getSettings()) {
  const normalized = path.resolve(cwd).toLowerCase();
  return (settings.skipPermissionsProjects || []).some(
    (p) => path.resolve(p).toLowerCase() === normalized,
  );
}

/** Bat/tat --dangerously-skip-permissions cho mot du an. Tra ve trang thai moi. */
function toggleSkipPermissions(cwd) {
  const settings = getSettings();
  const normalized = path.resolve(cwd);
  const list = settings.skipPermissionsProjects || [];
  const isOn = isSkipPermissionsProject(normalized, settings);
  const next = isOn
    ? list.filter((p) => path.resolve(p).toLowerCase() !== normalized.toLowerCase())
    : [...list, normalized];
  updateSettings({ skipPermissionsProjects: next });
  return !isOn;
}

module.exports = {
  loadTabs,
  saveTabs,
  listPinnedProjects,
  addPinnedProject,
  removePinnedProject,
  getSettings,
  updateSettings,
  isSkipPermissionsProject,
  toggleSkipPermissions,
};
