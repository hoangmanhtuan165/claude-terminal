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
  // Bam nut dong cua so thi thu nho vao khay he thong thay vi thoat han - PTY
  // dang chay (vi du ssh deploy dai) khong bi giet giua chung. Mac dinh tat:
  // hanh vi nay khac thong le Windows thong thuong nen phai nguoi dung tu bat.
  minimizeToTray: false,
  // Phim tat toan cuc bat/tat cua so tu bat ky dau trong he thong, kieu
  // terminal "Quake". Rong = tat, vi day la phim tat TOAN HE THONG - bat mac
  // dinh de kha nang dung trung phim voi ung dung khac ma nguoi dung khong ro
  // ly do.
  toggleHotkey: '',
  // Cac lenh nhanh rieng cho tung du an (bien {{cwd}}/{{branch}}/{{date}}).
  promptLibrary: [],
  // Co chu terminal (xterm), doc lap voi zoom toan bo giao dien.
  terminalFontSize: 13,
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
    sshHostId: tab.sshHostId || null,
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
          sshHostId: pane.sshHostId || null,
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
  // O dia Windows khong phan biet hoa/thuong - so sanh phai ha chu ca hai ben,
  // neu khong ghim "F:\..." roi ghim lai "f:\..." se bi coi la hai du an khac
  // nhau (cung loi vua sua o history-index.js).
  const key = normalized.toLowerCase();

  if (projects.some((p) => path.resolve(p.cwd).toLowerCase() === key)) return projects;

  projects.unshift({ cwd: normalized, name: path.basename(normalized) || normalized });
  writeJson(pinnedProjectsPath(), { projects });
  return projects;
}

function removePinnedProject(cwd) {
  const key = path.resolve(cwd).toLowerCase();
  const projects = listPinnedProjects().filter((p) => path.resolve(p.cwd).toLowerCase() !== key);
  writeJson(pinnedProjectsPath(), { projects });
  return projects;
}

/**
 * Sap lai thu tu du an ghim theo mang cwd da cho (keo-tha tren sidebar).
 * Bo qua cwd la hoac khong khop du an nao dang ghim - giu nguyen du lieu goc,
 * chi doi thu tu.
 */
function reorderPinnedProjects(orderedCwds) {
  const projects = listPinnedProjects();
  const byKey = new Map(projects.map((p) => [path.resolve(p.cwd).toLowerCase(), p]));
  const seen = new Set();
  const next = [];

  for (const cwd of orderedCwds || []) {
    const key = path.resolve(cwd).toLowerCase();
    const project = byKey.get(key);
    if (project && !seen.has(key)) {
      next.push(project);
      seen.add(key);
    }
  }
  // Bat ky du an nao khong nam trong danh sach truyen vao (du lieu khong dong
  // bo) van duoc giu lai o cuoi, khong bi mat.
  for (const project of projects) {
    const key = path.resolve(project.cwd).toLowerCase();
    if (!seen.has(key)) next.push(project);
  }

  writeJson(pinnedProjectsPath(), { projects: next });
  return next;
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
  reorderPinnedProjects,
  getSettings,
  updateSettings,
  isSkipPermissionsProject,
  toggleSkipPermissions,
};
