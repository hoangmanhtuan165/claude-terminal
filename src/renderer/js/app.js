'use strict';

/**
 * Khởi tạo ứng dụng và nối các thành phần lại với nhau.
 *
 * App có hai màn hình dùng chung một vùng nội dung: terminal và lịch sử.
 * Terminal không bao giờ bị tháo khỏi DOM khi chuyển sang lịch sử, chỉ ẩn đi,
 * để phiên đang chạy không bị mất.
 */

const el = (id) => document.getElementById(id);

const dom = {
  terminalPane: el('terminal-pane'),
  tabStrip: el('tab-strip'),
  historyScreen: el('history-screen'),
  terminalScreen: el('terminal-screen'),
  statsScreen: el('stats-screen'),
  statsContent: el('stats-content'),
  sidebar: el('projects-sidebar'),
  sshSidebar: el('ssh-sidebar'),
  sidebarTabProjects: el('sidebar-tab-projects'),
  sidebarTabSsh: el('sidebar-tab-ssh'),
  statusCwd: el('status-cwd'),
  statusShell: el('status-shell'),
  statusHistory: el('status-history'),
  navHistory: el('nav-history'),
  navStats: el('nav-stats'),
  btnTabList: el('btn-tab-list'),
  btnWorkspaces: el('btn-workspaces'),
  btnBroadcast: el('btn-broadcast'),
  btnNewClaude: el('btn-new-claude'),
  btnPalette: el('btn-palette'),
  btnTheme: el('btn-theme'),
  paletteRoot: el('palette-root'),
  quickBar: el('quick-bar'),
  quickBarSsh: el('quick-bar-ssh'),
  modelPicker: el('model-picker'),
  statusModel: el('status-model'),
  accountButton: el('account-button'),
  statusAccount: el('status-account'),
  usageButton: el('usage-button'),
  statusUsage: el('status-usage'),
  updateButton: el('update-button'),
  statusUpdate: el('status-update'),
  statusBranch: el('status-branch'),
};

const historyElements = {
  list: el('history-list'),
  searchInput: el('history-search'),
  modeButtons: [...document.querySelectorAll('[data-mode]')],
  scopeSelect: el('history-scope'),
  refreshButton: el('btn-refresh-history'),
  status: el('history-status'),
  includeToolsCheckbox: el('search-include-tools'),
  includeSidechainCheckbox: el('search-include-sidechain'),
  hideSmallCheckbox: el('hide-small-sessions'),
  onlyErrorCheckbox: el('only-error-sessions'),
  storageWarning: el('storage-warning'),
};

const findElements = {
  root: el('term-find'),
  input: el('term-find-input'),
  count: el('term-find-count'),
  next: el('term-find-next'),
  prev: el('term-find-prev'),
  close: el('term-find-close'),
  allToggle: el('term-find-all-toggle'),
  allResults: el('term-find-all-results'),
};

let terminalTabs;
let historyPanel;
let transcriptView;
let projectsSidebar;
let sshSidebar;
let workspacePresetsPanel;
let statsPanel;
let themeManager;
let terminalFind;
let commandPalette;
let quickSend;
let accountPanel;
let currentScreen = 'terminal';

// --- Chuyển màn hình -------------------------------------------------------

function showScreen(screen) {
  currentScreen = screen;
  const isTerminal = screen === 'terminal';
  const isHistory = screen === 'history';
  const isStats = screen === 'stats';

  dom.terminalScreen.classList.toggle('is-hidden', !isTerminal);
  dom.historyScreen.classList.toggle('is-hidden', !isHistory);
  dom.statsScreen.classList.toggle('is-hidden', !isStats);
  dom.navHistory.classList.toggle('is-active', isHistory);
  dom.navStats.classList.toggle('is-active', isStats);

  // xterm đo kích thước theo DOM, nên phải fit lại sau khi pane hiện trở lại.
  if (isTerminal) terminalTabs.handleShown();
  else if (isHistory) historyPanel.focusSearch();
  else if (isStats) statsPanel.show();
}

// --- Tác vụ tab ------------------------------------------------------------

async function openTerminal({ cwd, sessionType, resumeSessionId, title, runCommand }) {
  showScreen('terminal');
  await terminalTabs.createTab({ cwd, sessionType, resumeSessionId, title });
  // Vd bam "Chạy script" tren menu chuot phai sidebar - go thang lenh xuong
  // PTY vua mo, giong het co che cua quick-send.js.
  if (runCommand) {
    const pane = terminalTabs.activePane;
    if (pane) window.api.pty.write(pane.id, `${runCommand}\r`);
  }
}

async function openSshTerminal(host) {
  showScreen('terminal');
  await terminalTabs.createTab({ sessionType: 'ssh', sshHostId: host.id, title: `ssh · ${host.name}` });
}

/** Mo lai tuan tu tung tab da luu trong mot khong gian lam viec. */
async function restoreWorkspacePreset(preset) {
  showScreen('terminal');
  for (const tab of preset.tabs) {
    await terminalTabs.createTab({ cwd: tab.cwd, sessionType: tab.sessionType, sshHostId: tab.sshHostId });
  }
}

/** Tang moi lan doi tab - dam bao ket qua git branch tra ve tra cham cua tab cu khong ghi de tab moi. */
let branchRequestSeq = 0;

function updateStatusBar() {
  const tab = terminalTabs.activeTab;
  dom.statusCwd.textContent = tab?.cwd || '—';
  // Ô tìm bám theo tab đang mở, nên đổi tab là phải tìm lại.
  terminalFind?.handleTabChange();
  // Model được nhớ theo từng dự án nên đổi tab là nhãn phải đổi theo.
  quickSend?.refreshModelLabel();
  quickSend?.refreshSshBar();
  // Chấm "đang mở" trên sidebar phải theo kịp khi tab mới mở/đóng.
  projectsSidebar?.render();
  sshSidebar?.render();

  const seq = ++branchRequestSeq;
  dom.statusBranch.textContent = '';
  if (tab?.cwd) {
    window.api.git.branch(tab.cwd).then((branch) => {
      if (seq !== branchRequestSeq) return;
      dom.statusBranch.textContent = branch || '';
      dom.statusBranch.closest('.status-item').classList.toggle('is-hidden', !branch);
    });
  } else {
    dom.statusBranch.closest('.status-item').classList.add('is-hidden');
  }
}

/** Tap cwd (chữ thường) đang có ít nhất một tab mở - dùng cho chấm sidebar. */
function openProjectCwds() {
  const cwds = new Set();
  for (const tab of terminalTabs.tabs.values()) {
    for (const pane of tab.panes) {
      if (pane.cwd) cwds.add(String(pane.cwd).toLowerCase());
    }
  }
  return cwds;
}

/** Tap sshHostId đang có tab kết nối còn sống - dùng cho chấm sidebar Máy chủ. */
function openSshHostIds() {
  const ids = new Set();
  for (const tab of terminalTabs.tabs.values()) {
    for (const pane of tab.panes) {
      if (pane.sessionType === 'ssh' && pane.sshHostId && pane.alive) ids.add(pane.sshHostId);
    }
  }
  return ids;
}

/** Mở lại một phiên cũ: `claude --resume` chạy ngay tại thư mục gốc của phiên. */
async function resumeSession(session) {
  const shellOnly = Boolean(session.openShellOnly);
  await openTerminal({
    cwd: session.cwd,
    sessionType: shellOnly ? 'shell' : 'claude-resume',
    resumeSessionId: shellOnly ? null : session.sessionId,
    title: shellOnly
      ? `shell · ${window.formatUtils.baseName(session.cwd)}`
      : `resume · ${window.formatUtils.baseName(session.cwd)}`,
  });
}

// --- Bảng lệnh -------------------------------------------------------------

function paletteActions() {
  return {
    commands: () => [
      {
        icon: 'plus',
        title: 'Tab Claude mới',
        hint: 'Ctrl+T',
        run: () => openTerminal({ cwd: terminalTabs.activeTab?.cwd, sessionType: 'claude' }),
      },
      {
        icon: 'terminal-prompt',
        title: 'Tab shell mới',
        hint: 'Ctrl+Shift+T',
        run: () => openTerminal({ cwd: terminalTabs.activeTab?.cwd, sessionType: 'shell' }),
      },
      {
        icon: 'split',
        title: 'Chia đôi màn hình terminal',
        hint: 'Ctrl+\\',
        run: () => {
          showScreen('terminal');
          terminalTabs.splitActiveTab({ sessionType: 'shell' });
        },
      },
      {
        icon: 'clock',
        title: 'Mở lịch sử',
        hint: 'Ctrl+H',
        run: () => showScreen('history'),
      },
      {
        icon: 'search',
        title: 'Tìm toàn văn trong lịch sử',
        hint: 'Ctrl+Shift+F',
        run: () => {
          showScreen('history');
          historyPanel.focusSearch();
        },
      },
      {
        icon: 'refresh',
        title: 'Quét lại lịch sử',
        hint: 'Ctrl+R',
        run: () => refreshHistory(),
      },
      {
        icon: 'user',
        title: 'Tài khoản Claude — đăng nhập, đổi hồ sơ',
        run: () => accountPanel.button.click(),
      },
      {
        icon: 'contrast',
        title: 'Đổi giao diện sáng/tối',
        run: () => themeManager.cycle(),
      },
      {
        icon: 'download',
        title: 'Xuất log terminal của tab đang mở',
        run: () => exportActiveLog(),
      },
    ],
    projects: () => projectsSidebar.allProjects(),
    // Danh sách phiên đã sắp mới nhất trước; lấy 60 phiên gần nhất là đủ.
    sessions: () => historyPanel.sessions.slice(0, 60),
    openProject: (cwd) => openTerminal({ cwd, sessionType: 'claude' }),
    openSession: (session) => {
      showScreen('history');
      historyPanel.openSession(session);
    },
  };
}

async function refreshHistory() {
  await historyPanel.refreshIndex();
  await projectsSidebar.reload();
  dom.statusHistory.textContent = `${historyPanel.sessions.length} phiên đã lưu`;
}

async function exportActiveLog() {
  const tab = terminalTabs.activeTab;
  if (!tab) return;
  const result = await window.api.scrollback.export(tab.id, tab.title.replace(/[^\w.-]+/g, '-'));
  if (result.saved) dom.statusHistory.textContent = `Đã xuất: ${result.filePath}`;
}

// --- Khởi động -------------------------------------------------------------

async function bootstrap() {
  themeManager = new window.ThemeManager({ toggleButton: dom.btnTheme });
  await themeManager.init();

  transcriptView = new window.TranscriptView({
    container: el('transcript-view'),
    outlineElement: el('transcript-outline'),
    wrapElement: el('transcript-wrap'),
    onResume: resumeSession,
    // historyPanel tạo sau transcriptView nên phải tra cứu lúc gọi, không phải
    // lúc khai báo.
    onNoteChange: (sessionId, note) => historyPanel?.applyNoteChange(sessionId, note),
    onNavigate: (session, direction) => historyPanel?.adjacentSession(session, direction) || null,
  });
  transcriptView.showEmpty();
  transcriptView.onSessionNavigated = (session) => historyPanel?.syncSelection(session);

  historyPanel = new window.HistoryPanel({
    elements: historyElements,
    transcriptView,
    onOpenSession: resumeSession,
  });
  await historyPanel.loadPrefs();

  terminalTabs = new window.TerminalTabs({
    paneElement: dom.terminalPane,
    stripElement: dom.tabStrip,
    tabListButton: dom.btnTabList,
    broadcastButton: dom.btnBroadcast,
    themeManager,
    onChange: updateStatusBar,
  });

  await terminalTabs.loadFontSize();

  terminalFind = new window.TerminalFind({
    elements: findElements,
    getActiveTab: () => terminalTabs.activeTab,
    getAllTabs: () => terminalTabs.tabs,
    activateTab: (tabId) => terminalTabs.activate(tabId),
  });

  projectsSidebar = new window.ProjectsSidebar({
    element: dom.sidebar,
    onOpenTerminal: openTerminal,
    onSelectProject: (cwd) => {
      historyPanel.setProjectFilter(cwd);
      showScreen('history');
    },
    getOpenCwds: openProjectCwds,
  });

  sshSidebar = new window.SshSidebar({
    element: dom.sshSidebar,
    onConnect: openSshTerminal,
    getOpenHostIds: openSshHostIds,
  });
  await sshSidebar.reload();

  workspacePresetsPanel = new window.WorkspacePresetsPanel({
    button: dom.btnWorkspaces,
    getTabsSnapshot: () => terminalTabs.snapshotForPreset(),
    onRestore: restoreWorkspacePreset,
  });

  statsPanel = new window.StatsPanel({ element: dom.statsContent });

  commandPalette = new window.CommandPalette({
    root: dom.paletteRoot,
    actions: paletteActions(),
  });

  quickSend = new window.QuickSend({
    quickBarElement: dom.quickBar,
    sshQuickBarElement: dom.quickBarSsh,
    modelButton: dom.modelPicker,
    modelLabel: dom.statusModel,
    getActivePane: () => terminalTabs.activePane,
    onNeedTerminal: () => showScreen('terminal'),
  });
  await quickSend.loadPrefs();

  accountPanel = new window.AccountPanel({
    button: dom.accountButton,
    label: dom.statusAccount,
    usageButton: dom.usageButton,
    usageLabel: dom.statusUsage,
    updateButton: dom.updateButton,
    updateLabel: dom.statusUpdate,
    quickSend,
    onNeedTerminal: () => showScreen('terminal'),
  });
  await accountPanel.refresh();

  // Tự cập nhật mức dùng. 90 giây là nhịp `check use` dùng để tránh 429; phía
  // main còn chặn thêm một lớp nữa nên gọi dày hơn cũng không ra mạng.
  setInterval(() => accountPanel.refreshUsage(), 90 * 1000);

  bindChrome();

  const info = await window.api.app.info();
  dom.statusShell.textContent = window.formatUtils.baseName(info.shell);
  // macOS dat den giao thong ben trai thanh tieu de (Windows/Linux dat nut o
  // ben phai) - CSS doc co nay de doi le tab-strip cho dung ben.
  document.body.dataset.platform = info.platform;

  const restoredCount = await terminalTabs.restore();
  if (restoredCount === 0) {
    await terminalTabs.createTab({ sessionType: 'shell' });
  }
  showScreen('terminal');

  // Lập chỉ mục sau khi giao diện đã hiện: lần quét đầu trên vài trăm
  // transcript mất vài giây, không nên chặn màn hình khởi động.
  await historyPanel.reload();
  await refreshHistory();
}

/** Chuyển giữa panel "Dự án" và "Máy chủ" trong cùng một sidebar. */
function showSidebarPanel(panel) {
  const isSsh = panel === 'ssh';
  dom.sidebar.classList.toggle('is-hidden', isSsh);
  dom.sshSidebar.classList.toggle('is-hidden', !isSsh);
  dom.sidebarTabProjects.classList.toggle('is-active', !isSsh);
  dom.sidebarTabSsh.classList.toggle('is-active', isSsh);
}

function bindChrome() {
  dom.sidebarTabProjects.addEventListener('click', () => showSidebarPanel('projects'));
  dom.sidebarTabSsh.addEventListener('click', () => showSidebarPanel('ssh'));

  dom.navHistory.addEventListener('click', () =>
    showScreen(currentScreen === 'history' ? 'terminal' : 'history'),
  );
  dom.navStats.addEventListener('click', () =>
    showScreen(currentScreen === 'stats' ? 'terminal' : 'stats'),
  );
  dom.btnNewClaude.addEventListener('click', () =>
    openTerminal({ cwd: terminalTabs.activeTab?.cwd, sessionType: 'claude' }),
  );
  dom.btnPalette.addEventListener('click', () => commandPalette.toggle());

  window.api.menu.onNewClaudeTab(() =>
    openTerminal({ cwd: terminalTabs.activeTab?.cwd, sessionType: 'claude' }),
  );
  window.api.menu.onNewShellTab(() =>
    openTerminal({ cwd: terminalTabs.activeTab?.cwd, sessionType: 'shell' }),
  );
  window.api.menu.onCloseTab(() => {
    if (terminalTabs.activeTabId) terminalTabs.closeTab(terminalTabs.activeTabId);
  });
  window.api.menu.onReopenClosedTab(() => {
    showScreen('terminal');
    terminalTabs.reopenClosedTab();
  });
  window.api.menu.onSplitPane(() => {
    showScreen('terminal');
    terminalTabs.splitActiveTab({ sessionType: 'shell' });
  });
  window.api.menu.onFocusOtherPane(() => {
    showScreen('terminal');
    terminalTabs.focusOtherPane();
  });
  window.api.menu.onClosePane(() => {
    const pane = terminalTabs.activePane;
    if (pane) terminalTabs.closePane(pane.id);
  });
  window.api.menu.onOpenHistory(() =>
    showScreen(currentScreen === 'history' ? 'terminal' : 'history'),
  );
  window.api.menu.onFocusSearch(() => {
    showScreen('history');
    historyPanel.focusSearch();
  });
  window.api.menu.onRefreshHistory(() => refreshHistory());
  window.api.menu.onTerminalFontIncrease(() => terminalTabs.adjustFontSize(1));
  window.api.menu.onTerminalFontDecrease(() => terminalTabs.adjustFontSize(-1));
  window.api.menu.onTerminalFontReset(() => terminalTabs.resetFontSize());
  window.api.menu.onOpenProjectTab(({ cwd, sessionType, resumeSessionId, runCommand }) =>
    openTerminal({ cwd, sessionType, resumeSessionId, runCommand }),
  );
  window.api.menu.onPasteToTerminal(({ paneId }) => terminalTabs.pasteToPane(paneId));
  window.api.projects.onChanged(() => projectsSidebar.reload());

  window.addEventListener('keydown', handleGlobalKey);

  // Tha file ra ngoai vung terminal thi khong duoc lam gi ca. Mac dinh trinh
  // duyet se mo file do thay cho noi dung trang - nghia la mat trang app va
  // moi phien dang chay. Cac pane terminal tu chan rieng va xu ly truoc.
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (event) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
    });
  }
}

function handleGlobalKey(event) {
  if (!event.ctrlKey || event.altKey) return;

  // Ctrl+Shift+K (hoàn tác đóng tab) do menu giữ accelerator (xem main.js) -
  // không bắt lại ở đây kẻo chạy hai lần, giống Ctrl+\ và Ctrl+] bên dưới.
  // Nhưng vẫn phải chặn sớm để không rơi xuống nhánh Ctrl+K bên dưới.
  if (event.shiftKey && (event.key === 'k' || event.key === 'K')) return;

  // Ctrl+K: bảng lệnh. Đặt ở renderer chứ không phải menu để còn đóng lại được
  // bằng chính phím đó khi bảng đang mở và đang giữ focus.
  if (event.key === 'k' || event.key === 'K') {
    event.preventDefault();
    commandPalette.toggle();
    return;
  }

  // Ctrl+F: tìm trong terminal, chỉ có nghĩa khi đang ở màn hình terminal.
  if ((event.key === 'f' || event.key === 'F') && !event.shiftKey) {
    if (currentScreen !== 'terminal') return;
    event.preventDefault();
    terminalFind.toggle();
    return;
  }

  // Ctrl+\ và Ctrl+] (chia đôi / đổi ô) do menu giữ accelerator, xem
  // menu:splitPane bên dưới — không bắt lại ở đây kẻo chạy hai lần.

  // Ctrl+1..9: nhảy nhanh sang tab thứ n.
  if (event.shiftKey) return;
  const index = Number(event.key);
  if (!Number.isInteger(index) || index < 1 || index > 9) return;

  const ids = [...terminalTabs.tabs.keys()];
  if (ids[index - 1]) {
    event.preventDefault();
    showScreen('terminal');
    terminalTabs.activate(ids[index - 1]);
  }
}

window.addEventListener('DOMContentLoaded', bootstrap);
