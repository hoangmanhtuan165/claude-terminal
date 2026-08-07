'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { ipcMain, dialog, shell, app, clipboard, Menu } = require('electron');

const { claudeProjectsDir } = require('./app-paths');
const ptyManager = require('./terminal/pty-manager');
const scrollbackStore = require('./storage/scrollback-store');
const workspaceStore = require('./storage/workspace-store');
const clipboardImageStore = require('./storage/clipboard-image-store');
const sessionNotesStore = require('./storage/session-notes-store');
const accountStatus = require('./storage/account-status');
const accountProfiles = require('./storage/account-profiles');
const usageLimits = require('./usage/usage-limits');
const usageLocal = require('./usage/usage-local');
const historyIndex = require('./history/history-index');
const historySearch = require('./history/history-search');
const { readTranscript } = require('./history/transcript-reader');
const { resolveShell } = require('./terminal/shell-resolver');
const { resolveTheme, titleBarOverlayFor } = require('./theme');

/**
 * Toan bo be mat IPC giua renderer va main.
 *
 * Renderer chay voi contextIsolation va khong co quyen Node, nen moi thao tac
 * cham vao he thong file hay tien trinh deu phai di qua day.
 */

/** Chan doc file ngoai thu muc transcript, ke ca khi renderer gui duong dan la. */
function assertInsideProjectsDir(filePath) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(claudeProjectsDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Đường dẫn nằm ngoài thư mục transcript');
  }
  return resolved;
}

function register(getWindow) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ptyManager.setRendererSink(send);

  // --- Terminal ------------------------------------------------------------

  ipcMain.handle('pty:create', (_event, options) => ptyManager.create(options));

  // write/resize dung `send` thay vi `invoke`: chung xay ra lien tuc theo tung
  // phim go, khong can gia tri tra ve, va tranh chi phi tao Promise moi lan.
  ipcMain.on('pty:write', (_event, { tabId, data }) => ptyManager.write(tabId, data));
  ipcMain.on('pty:resize', (_event, { tabId, cols, rows }) => ptyManager.resize(tabId, cols, rows));

  ipcMain.handle('pty:kill', (_event, { tabId }) => ptyManager.kill(tabId));
  ipcMain.handle('pty:isAlive', (_event, { tabId }) => ptyManager.isAlive(tabId));

  // --- Scrollback ----------------------------------------------------------

  ipcMain.handle('scrollback:restore', (_event, { tabId }) => scrollbackStore.readForRestore(tabId));
  ipcMain.handle('scrollback:full', (_event, { tabId }) => scrollbackStore.readFull(tabId));
  ipcMain.handle('scrollback:remove', (_event, { tabId }) => scrollbackStore.remove(tabId));

  ipcMain.handle('scrollback:export', async (_event, { tabId, suggestedName }) => {
    const win = getWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Xuất log terminal',
      defaultPath: `${suggestedName || 'terminal-log'}.txt`,
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    });
    if (canceled || !filePath) return { saved: false };

    // Bo ma dieu khien ANSI khi xuat de file mo bang trinh soan thao doc duoc.
    const raw = scrollbackStore.readFull(tabId);
    const plain = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][\s\S]*?(\x07|\x1b\\)/g, '');
    await fs.writeFile(filePath, plain, 'utf8');
    return { saved: true, filePath };
  });

  // --- Tab va du an --------------------------------------------------------

  ipcMain.handle('tabs:load', () => workspaceStore.loadTabs());
  ipcMain.handle('tabs:save', (_event, state) => workspaceStore.saveTabs(state));
  ipcMain.handle('tabs:pruneScrollback', (_event, { liveTabIds }) =>
    scrollbackStore.pruneOrphans(liveTabIds || []),
  );

  ipcMain.handle('projects:list', () => {
    const settings = workspaceStore.getSettings();
    const hidden = new Set(
      (settings.hiddenProjects || []).map((p) => String(p).toLowerCase()),
    );
    const withSkipFlag = (p) => ({
      ...p,
      skipPermissions: workspaceStore.isSkipPermissionsProject(p.cwd, settings),
    });

    const recent = historyIndex
      .listProjects()
      .filter((p) => !hidden.has(p.cwd.toLowerCase()))
      .map(withSkipFlag);

    // Danh sach ghim la nguoi dung tu them, khong di kem san `exists` nhu
    // recent (suy tu transcript) - bo sung o day cho dong bo giao dien.
    const pinned = workspaceStore
      .listPinnedProjects()
      .map((p) => withSkipFlag({ ...p, exists: fsSync.existsSync(p.cwd) }));

    return { pinned, recent };
  });
  ipcMain.handle('projects:pin', (_event, { cwd }) => workspaceStore.addPinnedProject(cwd));
  ipcMain.handle('projects:unpin', (_event, { cwd }) => workspaceStore.removePinnedProject(cwd));
  ipcMain.handle('projects:toggleSkipPermissions', (_event, { cwd }) =>
    workspaceStore.toggleSkipPermissions(cwd),
  );

  /**
   * Menu chuot phai tren hang du an. Dung Menu native cua Windows thay vi tu
   * ve trong renderer - cac hanh dong lien quan claude/shell can renderer xu
   * ly (tao tab, terminalTabs) nen di qua `menu:openProjectTab`; con
   * pin/skip-permissions thi lam thang o day roi bao renderer nap lai qua
   * `projects:changed`.
   */
  ipcMain.handle('projects:showContextMenu', (_event, { cwd, isPinned, skipPermissions }) => {
    const win = getWindow();
    if (!win) return;

    const notifyChanged = () => send('projects:changed');

    const template = [
      {
        label: 'Mở tab Claude ở đây',
        click: () => send('menu:openProjectTab', { cwd, sessionType: 'claude' }),
      },
      {
        label: 'Mở tab dòng lệnh ở đây',
        click: () => send('menu:openProjectTab', { cwd, sessionType: 'shell' }),
      },
      { type: 'separator' },
      {
        label: isPinned ? 'Bỏ ghim dự án' : 'Ghim dự án',
        click: () => {
          if (isPinned) workspaceStore.removePinnedProject(cwd);
          else workspaceStore.addPinnedProject(cwd);
          notifyChanged();
        },
      },
      {
        label: skipPermissions
          ? 'Tắt bỏ qua xin quyền (--dangerously-skip-permissions)'
          : 'Bật bỏ qua xin quyền (--dangerously-skip-permissions)',
        click: () => {
          if (!skipPermissions) {
            const choice = dialog.showMessageBoxSync(win, {
              type: 'warning',
              buttons: ['Huỷ', 'Bật'],
              defaultId: 0,
              cancelId: 0,
              message: 'Bật --dangerously-skip-permissions cho dự án này?',
              detail:
                'Claude sẽ tự động sửa file, chạy lệnh và thao tác khác mà KHÔNG hỏi xin quyền nữa, cho mọi tab Claude mở mới trong thư mục này. Chỉ bật nếu bạn thực sự tin tưởng dự án này.',
            });
            if (choice !== 1) return;
          }
          workspaceStore.toggleSkipPermissions(cwd);
          notifyChanged();
        },
      },
      { type: 'separator' },
      {
        label: 'Mở trong File Explorer',
        click: () => shell.openPath(cwd),
      },
      {
        label: 'Sao chép đường dẫn',
        click: () => clipboard.writeText(cwd),
      },
    ];

    Menu.buildFromTemplate(template).popup({ window: win });
  });

  /**
   * Du an da mat: thu muc goc khong con tren dia (bi xoa/doi ten) nhung van
   * con phien cu trong transcript. An het khoi sidebar trong mot lan, va bo
   * ghim neu dang ghim - chi an, KHONG dong gi toi transcript goc.
   */
  /** An mot du an don le - dung khi nguoi dung bam x tren tung hang da mat. */
  ipcMain.handle('projects:hide', (_event, { cwd }) => {
    if (!cwd) return;
    workspaceStore.removePinnedProject(cwd);

    const settings = workspaceStore.getSettings();
    const already = new Set((settings.hiddenProjects || []).map((p) => String(p).toLowerCase()));
    if (!already.has(String(cwd).toLowerCase())) {
      workspaceStore.updateSettings({ hiddenProjects: [...(settings.hiddenProjects || []), cwd] });
    }
  });

  ipcMain.handle('projects:pruneMissing', () => {
    // Gop ca hai nguon: "recent" suy tu transcript, va "pinned" nguoi dung tu
    // them tay (co the ghim mot thu muc chua tung chay claude).
    const missingFromRecent = historyIndex.listProjects().filter((p) => !p.exists);
    const missingFromPinned = workspaceStore
      .listPinnedProjects()
      .filter((p) => !fsSync.existsSync(p.cwd));

    const missingCwds = [
      ...new Set([...missingFromRecent, ...missingFromPinned].map((p) => p.cwd)),
    ];

    for (const cwd of missingCwds) workspaceStore.removePinnedProject(cwd);

    const settings = workspaceStore.getSettings();
    const already = new Set((settings.hiddenProjects || []).map((p) => String(p).toLowerCase()));
    const merged = [...settings.hiddenProjects || []];
    for (const cwd of missingCwds) {
      if (!already.has(cwd.toLowerCase())) merged.push(cwd);
    }
    workspaceStore.updateSettings({ hiddenProjects: merged });

    return { prunedCount: missingCwds.length };
  });

  ipcMain.handle('projects:browse', async () => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Chọn thư mục dự án',
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  // --- Lich su -------------------------------------------------------------

  ipcMain.handle('history:refresh', async () => {
    return historyIndex.refresh({
      onProgress: (progress) => send('history:indexProgress', progress),
    });
  });

  ipcMain.handle('history:listSessions', (_event, { cwdFilter } = {}) => {
    const sessions = historyIndex.listSessions();
    if (!cwdFilter) return sessions;
    const target = String(cwdFilter).toLowerCase();
    return sessions.filter((s) => String(s.cwd || '').toLowerCase() === target);
  });

  ipcMain.handle('history:readTranscript', async (_event, { filePath }) => {
    const safePath = assertInsideProjectsDir(filePath);
    return readTranscript(safePath);
  });

  ipcMain.handle('history:findSession', (_event, { sessionId }) =>
    historyIndex.findSession(sessionId),
  );

  ipcMain.handle('history:revealFile', (_event, { filePath }) => {
    const safePath = assertInsideProjectsDir(filePath);
    shell.showItemInFolder(safePath);
  });

  ipcMain.handle('history:search', (_event, params) => {
    // Renderer tu sinh `clientRequestId` va gan truoc khi goi. Neu de main sinh
    // id roi tra ve, ket qua dau tien co the ve truoc ca hoi dap IPC - voi cache
    // nong mot luot tim chi mat vai chuc mili giay - va renderer se loc nham
    // chinh ket qua cua no.
    const clientId = params.clientRequestId;

    return historySearch.search(params, {
      onHits: (hits) => send('history:searchHits', { requestId: clientId, hits }),
      onProgress: (progress) => send('history:searchProgress', { ...progress, requestId: clientId }),
      onDone: (summary) => send('history:searchDone', { ...summary, requestId: clientId }),
      onError: (message) => send('history:searchError', { requestId: clientId, message }),
    });
  });

  ipcMain.handle('history:cancelSearch', (_event, { requestId }) => historySearch.cancel(requestId));

  // --- Clipboard -------------------------------------------------------------

  ipcMain.handle('clipboard:pasteImage', () => clipboardImageStore.pasteImageToFile());
  ipcMain.handle('clipboard:readText', () => clipboard.readText());

  // --- Tien ich ------------------------------------------------------------

  ipcMain.handle('app:info', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    shell: resolveShell().path,
    claudeProjectsDir,
    platform: process.platform,
  }));

  // --- Theme ---------------------------------------------------------------

  ipcMain.handle('theme:get', () => {
    const preference = workspaceStore.getSettings().theme;
    return { preference, theme: resolveTheme(preference) };
  });

  ipcMain.handle('theme:set', (_event, { preference }) => {
    workspaceStore.updateSettings({ theme: preference });
    const theme = resolveTheme(preference);

    // Nut cua so do Windows ve, phai bao mau rieng cho chung.
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlayFor(theme));

    return { preference, theme };
  });

  // --- Tai khoan Claude ----------------------------------------------------
  // Chi doc, va chi tra ve truong khong bi mat (xem account-status.js).
  // App khong bao gio tu ghi vao .credentials.json.

  ipcMain.handle('account:status', () => accountStatus.read());

  // --- Muc su dung ---------------------------------------------------------
  // Han muc goi phai goi API bang accessToken, nhung token khong bao gio roi
  // khoi tien trinh nay - chi phan tram di xuong renderer.

  ipcMain.handle('usage:limits', (_event, { force } = {}) => usageLimits.get({ force }));

  ipcMain.handle('usage:local', (_event, { force } = {}) => usageLocal.get({ force }));

  ipcMain.handle('account:listProfiles', () => accountProfiles.list());

  ipcMain.handle('account:addProfile', async (_event, { name }) => {
    const result = await dialog.showOpenDialog({
      title: 'Chọn thư mục cấu hình cho hồ sơ này (thường là một thư mục .claude riêng)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return accountProfiles.list();
    return accountProfiles.add({ name, configDir: result.filePaths[0] });
  });

  ipcMain.handle('account:removeProfile', (_event, { id }) => accountProfiles.remove(id));

  // Doi ho so = khoi dong lai app voi thu muc cau hinh khac. Xem ghi chu trong
  // account-profiles.js ve ly do khong doi nong duoc.
  ipcMain.handle('account:switchProfile', (_event, { configDir }) =>
    accountProfiles.switchTo(configDir),
  );

  // --- Sao va ghi chu phien ------------------------------------------------

  ipcMain.handle('notes:list', () => sessionNotesStore.list());

  ipcMain.handle('notes:set', (_event, { sessionId, starred, note }) =>
    sessionNotesStore.set(sessionId, { starred, note }),
  );

  // --- Tuy chon khac -------------------------------------------------------
  // Theme co kenh rieng vi con phai ve lai nut cua so; nhung tuy chon thuan
  // giao dien khac dung chung hai kenh nay de khoi de ra mot cap IPC moi cho
  // moi cong tac nho.

  ipcMain.handle('prefs:get', () => workspaceStore.getSettings());

  // Chi nhan dung nhung khoa da biet: renderer xu ly noi dung transcript la du
  // lieu khong tin cay, khong nen cho no ghi khoa tuy y vao settings.json.
  /**
   * Moi khoa co mot ham lam sach rieng: gia tri den tu renderer, ma renderer
   * lai hien thi noi dung transcript la du lieu khong tin cay. Chan ca kieu du
   * lieu lan kich thuoc de settings.json khong bi bom phinh hay nhet kieu la.
   */
  const PREF_SANITIZERS = {
    hideSmallSessions: (value) => Boolean(value),

    quickItems: (value) =>
      Array.isArray(value)
        ? value
            .filter((item) => typeof item === 'string')
            .map((item) => item.slice(0, 200))
            .slice(0, 10)
        : [],

    modelByCwd: (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      const out = {};
      // Gioi han so du an duoc nho de file khong lon dan mai.
      for (const [cwd, label] of Object.entries(value).slice(0, 200)) {
        if (typeof label === 'string') out[String(cwd).slice(0, 400)] = label.slice(0, 60);
      }
      return out;
    },
  };

  ipcMain.handle('prefs:set', (_event, patch) => {
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) {
      const sanitize = PREF_SANITIZERS[key];
      if (sanitize) clean[key] = sanitize(value);
    }
    return workspaceStore.updateSettings(clean);
  });

  ipcMain.handle('app:openExternal', (_event, { url }) => {
    // Chi mo http/https de link trong terminal khong the kich hoat giao thuc la.
    if (!/^https?:\/\//i.test(url)) return false;
    shell.openExternal(url);
    return true;
  });
}

module.exports = { register };
