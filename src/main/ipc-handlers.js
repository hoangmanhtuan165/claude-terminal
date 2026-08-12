'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { execFile } = require('node:child_process');
const { ipcMain, dialog, shell, app, clipboard, Menu } = require('electron');

const { claudeProjectsDir } = require('./app-paths');
const ptyManager = require('./terminal/pty-manager');
const scrollbackStore = require('./storage/scrollback-store');
const workspaceStore = require('./storage/workspace-store');
const sshStore = require('./storage/ssh-store');
const backupStore = require('./storage/backup-store');
const gitInfo = require('./git-info');
const workspacePresetsStore = require('./storage/workspace-presets-store');
const sftpClient = require('./ssh/sftp-client');
const packageScripts = require('./package-scripts');
const clipboardImageStore = require('./storage/clipboard-image-store');
const sessionNotesStore = require('./storage/session-notes-store');
const accountStatus = require('./storage/account-status');
const accountProfiles = require('./storage/account-profiles');
const usageLimits = require('./usage/usage-limits');
const usageLocal = require('./usage/usage-local');
const historyIndex = require('./history/history-index');
const historySearch = require('./history/history-search');
const { readTranscript } = require('./history/transcript-reader');
const { resolveShell, resolveScp } = require('./terminal/shell-resolver');
const { resolveTheme, titleBarOverlayFor } = require('./theme');
const updater = require('./updater');
const trayController = require('./tray-controller');

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
  updater.setRendererSink(send);

  // --- Terminal ------------------------------------------------------------

  ipcMain.handle('pty:create', (_event, options) => ptyManager.create(options));

  // write/resize dung `send` thay vi `invoke`: chung xay ra lien tuc theo tung
  // phim go, khong can gia tri tra ve, va tranh chi phi tao Promise moi lan.
  ipcMain.on('pty:write', (_event, { tabId, data }) => ptyManager.write(tabId, data));
  ipcMain.on('pty:resize', (_event, { tabId, cols, rows }) => ptyManager.resize(tabId, cols, rows));

  ipcMain.handle('pty:kill', (_event, { tabId }) => ptyManager.kill(tabId));
  ipcMain.handle('pty:isAlive', (_event, { tabId }) => ptyManager.isAlive(tabId));

  /**
   * Menu chuot phai tren vung terminal: sao chep/dan tuong minh, khong dua
   * vao lenh "Copy" mac dinh cua Electron - vung chon cua xterm ve tren
   * canvas nen khong phai luc nao cung duoc lenh do nhan dung.
   */
  ipcMain.handle('terminal:showContextMenu', (_event, { paneId, selectedText }) => {
    const win = getWindow();
    if (!win) return;

    Menu.buildFromTemplate([
      {
        label: 'Sao chép',
        enabled: Boolean(selectedText),
        click: () => clipboard.writeText(selectedText),
      },
      {
        label: 'Dán',
        click: () => send('menu:pasteToTerminal', { paneId }),
      },
    ]).popup({ window: win });
  });

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

    const allProjects = historyIndex.listProjects();
    const recent = allProjects.filter((p) => !hidden.has(p.cwd.toLowerCase())).map(withSkipFlag);

    // Danh sach ghim la nguoi dung tu them, khong di kem san `exists`/
    // `lastSessionId`/`totalTokens`/`costUsd`/`sessionCount`/`lastUsedAt` nhu
    // recent (suy tu transcript) - bo sung o day cho dong bo giao dien va cho
    // nut "no tiep" tren sidebar hoat dong voi ca du an ghim. Thieu
    // `sessionCount`/`lastUsedAt` truoc day khien sidebar (projects-sidebar.js)
    // luon roi ve nhanh "chi hien duong dan" cho MOI du an ghim, du da co
    // phien va ton token that.
    const statsByCwd = new Map(
      allProjects.map((p) => [
        p.cwd.toLowerCase(),
        {
          lastSessionId: p.lastSessionId,
          totalTokens: p.totalTokens,
          costUsd: p.costUsd,
          sessionCount: p.sessionCount,
          lastUsedAt: p.lastUsedAt,
        },
      ]),
    );
    const pinned = workspaceStore.listPinnedProjects().map((p) => {
      const stats = statsByCwd.get(p.cwd.toLowerCase());
      return withSkipFlag({
        ...p,
        exists: fsSync.existsSync(p.cwd),
        lastSessionId: stats?.lastSessionId || null,
        totalTokens: stats?.totalTokens || 0,
        costUsd: stats?.costUsd || 0,
        sessionCount: stats?.sessionCount || 0,
        lastUsedAt: stats?.lastUsedAt || null,
      });
    });

    return { pinned, recent };
  });
  ipcMain.handle('projects:pin', (_event, { cwd }) => workspaceStore.addPinnedProject(cwd));
  ipcMain.handle('projects:unpin', (_event, { cwd }) => workspaceStore.removePinnedProject(cwd));
  ipcMain.handle('projects:reorderPinned', (_event, { orderedCwds }) =>
    workspaceStore.reorderPinnedProjects(orderedCwds),
  );
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

    // Cung logic voi nut play tren sidebar: co phien cu thi noi tiep thang,
    // du an moi hoan toan (chua co phien nao) thi moi mo trang.
    const lastSessionId = historyIndex
      .listProjects()
      .find((p) => p.cwd.toLowerCase() === String(cwd).toLowerCase())?.lastSessionId;

    const template = [
      {
        label: 'Mở tab Claude ở đây',
        click: () =>
          send(
            'menu:openProjectTab',
            lastSessionId
              ? { cwd, sessionType: 'claude-resume', resumeSessionId: lastSessionId }
              : { cwd, sessionType: 'claude' },
          ),
      },
      {
        label: 'Mở tab dòng lệnh ở đây',
        click: () => send('menu:openProjectTab', { cwd, sessionType: 'shell' }),
      },
      ...(() => {
        const scripts = packageScripts.listScripts(cwd);
        if (!scripts.length) return [];
        return [
          {
            label: 'Chạy script',
            submenu: scripts.map((script) => ({
              label: script.name,
              click: () => send('menu:openProjectTab', { cwd, sessionType: 'shell', runCommand: script.command }),
            })),
          },
        ];
      })(),
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
        label:
          process.platform === 'darwin'
            ? 'Mở trong Finder'
            : process.platform === 'linux'
              ? 'Mở trong trình quản lý file'
              : 'Mở trong File Explorer',
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

  /** Chon file de chen duong dan (@...) vao terminal - nut "chen file" canh o nhap. */
  ipcMain.handle('files:pickAttachments', async () => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Chọn file để chèn vào terminal',
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled) return [];
    return filePaths;
  });

  // --- May chu SSH -----------------------------------------------------------

  ipcMain.handle('ssh:list', () => sshStore.listHosts());
  ipcMain.handle('ssh:add', (_event, input) => sshStore.addHost(input));
  ipcMain.handle('ssh:update', (_event, { id, ...input }) => sshStore.updateHost(id, input));
  ipcMain.handle('ssh:remove', (_event, { id }) => sshStore.removeHost(id));

  ipcMain.handle('ssh:browseKey', async () => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Chọn tệp khoá riêng (private key)',
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  /**
   * Upload nhanh khi keo-tha file vao tab SSH. Chay `scp` mot lan, ngoai PTY -
   * phien ssh tuong tac trong tab van dang do nguoi dung go, khong dinh gi toi
   * tien trinh scp rieng nay.
   */
  ipcMain.handle('ssh:uploadFile', (_event, { hostId, localPath }) => {
    return new Promise((resolve) => {
      const host = sshStore.getHost(hostId);
      if (!host) return resolve({ ok: false, error: 'Không tìm thấy hồ sơ SSH này.' });

      const scp = resolveScp();
      if (!scp) return resolve({ ok: false, error: 'Không tìm thấy scp (cần OpenSSH client).' });

      const args = [];
      if (host.port && host.port !== 22) args.push('-P', String(host.port));
      if (host.keyPath) args.push('-i', host.keyPath);
      const target = host.username ? `${host.username}@${host.host}` : host.host;
      args.push(localPath, `${target}:~/`);

      execFile(scp, args, { timeout: 5 * 60 * 1000 }, (error, _stdout, stderr) => {
        if (error) return resolve({ ok: false, error: stderr?.trim() || error.message });
        resolve({ ok: true, remotePath: `~/${path.basename(localPath)}` });
      });
    });
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

  ipcMain.handle('history:storageStats', () => historyIndex.getStorageStats());
  ipcMain.handle('history:usageStats', () => historyIndex.getUsageStats());

  ipcMain.handle('history:previewCleanup', (_event, { targetFreeBytes }) => {
    const { sessions, freedBytes } = historyIndex.previewOldestSessions(targetFreeBytes);
    return { sessionCount: sessions.length, freedBytes };
  });

  /**
   * Xoa vinh vien cac phien cu nhat. Rat pha huy (khong hoan tac duoc) nen bat
   * buoc phai xac nhan bang hop thoai native cua he dieu hanh o day, KHONG dua
   * vao renderer da hoi truoc do - renderer co the bi bo qua/gia mao du lieu.
   */
  ipcMain.handle('history:cleanupOldest', async (_event, { targetFreeBytes }) => {
    const win = getWindow();
    const preview = historyIndex.previewOldestSessions(targetFreeBytes);
    if (preview.sessions.length === 0) return { deletedCount: 0, freedBytes: 0, cancelled: false };

    const freedMb = (preview.freedBytes / (1024 * 1024)).toFixed(1);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Huỷ', 'Xoá vĩnh viễn'],
      defaultId: 0,
      cancelId: 0,
      message: `Xoá ${preview.sessions.length} phiên cũ nhất để giải phóng ${freedMb} MB?`,
      detail:
        'Đây là hành động KHÔNG THỂ HOÀN TÁC. Các phiên bị xoá sẽ biến mất hoàn toàn khỏi lịch sử, kể cả nội dung hội thoại gốc trên đĩa.',
    });
    if (choice !== 1) return { deletedCount: 0, freedBytes: 0, cancelled: true };

    const result = historyIndex.deleteOldestSessions(targetFreeBytes);
    return { ...result, cancelled: false };
  });

  // --- Clipboard -------------------------------------------------------------

  ipcMain.handle('clipboard:pasteImage', () => clipboardImageStore.pasteImageToFile());
  ipcMain.handle('clipboard:readText', () => clipboard.readText());
  ipcMain.handle('clipboard:writeText', (_event, { text }) => clipboard.writeText(String(text || '')));
  ipcMain.handle('clipboard:captureScreenshot', () => clipboardImageStore.captureScreenshot());

  // --- Tien ich ------------------------------------------------------------

  ipcMain.handle('app:info', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    shell: resolveShell().path,
    claudeProjectsDir,
    platform: process.platform,
  }));

  // --- Trinh duyet file SFTP --------------------------------------------------

  ipcMain.handle('sftp:connect', async (_event, { hostId }) => {
    const host = sshStore.getHost(hostId);
    if (!host) throw new Error('Không tìm thấy hồ sơ SSH này.');
    const connId = await sftpClient.connect(host);
    const homePath = await sftpClient.realpath(connId, '.');
    return { connId, homePath };
  });

  ipcMain.handle('sftp:list', (_event, { connId, path: remotePath }) => sftpClient.list(connId, remotePath));
  ipcMain.handle('sftp:mkdir', (_event, { connId, path: remotePath }) => sftpClient.mkdir(connId, remotePath));
  ipcMain.handle('sftp:delete', (_event, { connId, path: remotePath }) => sftpClient.unlink(connId, remotePath));
  ipcMain.handle('sftp:rmdir', (_event, { connId, path: remotePath }) => sftpClient.rmdir(connId, remotePath));
  ipcMain.handle('sftp:disconnect', (_event, { connId }) => sftpClient.disconnect(connId));

  ipcMain.handle('sftp:download', async (_event, { connId, remotePath, fileName }) => {
    const win = getWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: fileName });
    if (canceled || !filePath) return { ok: false };
    await sftpClient.download(connId, remotePath, filePath);
    return { ok: true, filePath };
  });

  /** localPaths co san (vd keo-tha) thi dung luon; khong thi mo hop thoai chon file. */
  ipcMain.handle('sftp:upload', async (_event, { connId, remoteDir, localPaths }) => {
    let paths = localPaths;
    if (!paths || !paths.length) {
      const win = getWindow();
      const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
      if (result.canceled || !result.filePaths.length) return { ok: false, uploaded: [] };
      paths = result.filePaths;
    }

    const uploaded = [];
    for (const localPath of paths) {
      const name = path.basename(localPath);
      const remotePath = remoteDir.endsWith('/') ? `${remoteDir}${name}` : `${remoteDir}/${name}`;
      await sftpClient.upload(connId, localPath, remotePath);
      uploaded.push(name);
    }
    return { ok: true, uploaded };
  });

  // --- Khong gian lam viec (bo tab da luu ten) --------------------------------

  ipcMain.handle('workspace:listPresets', () => workspacePresetsStore.listPresets());
  ipcMain.handle('workspace:savePreset', (_event, { name, tabs }) =>
    workspacePresetsStore.savePreset(name, tabs),
  );
  ipcMain.handle('workspace:removePreset', (_event, { id }) => workspacePresetsStore.removePreset(id));

  // --- Thong tin git ---------------------------------------------------------

  ipcMain.handle('git:branch', (_event, { cwd }) => gitInfo.getBranch(cwd));

  // --- Sao luu / khoi phuc cau hinh -------------------------------------------

  ipcMain.handle('backup:export', () => backupStore.exportBackup(getWindow()));

  /**
   * Nhap xong phai khoi dong lai: cac module da doc settings/pinned-projects/
   * ssh-hosts vao bo nho luc mo app (vd DEFAULT_SETTINGS merge trong
   * workspace-store) se khong tu biet file duoi dia vua bi ghi de.
   */
  ipcMain.handle('backup:import', async () => {
    const result = await backupStore.importBackup(getWindow());
    if (result.imported) {
      app.relaunch();
      app.exit(0);
    }
    return result;
  });

  // --- Tu dong cap nhat ------------------------------------------------------

  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', () => updater.quitAndInstall());

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

    promptLibrary: (value) =>
      Array.isArray(value)
        ? value
            .filter((item) => item && typeof item.id === 'string' && typeof item.text === 'string')
            .map((item) => ({
              id: item.id.slice(0, 64),
              group: typeof item.group === 'string' ? item.group.slice(0, 40) : '',
              text: item.text.slice(0, 2000),
            }))
            .slice(0, 200)
        : [],

    terminalFontSize: (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(24, Math.max(9, Math.round(n))) : 13;
    },

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

  /** Dua cua so len truoc, dung khi nguoi dung bam vao thong bao he thong. */
  ipcMain.handle('app:focusWindow', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  // --- Khoi dong cung he thong / khay --------------------------------------
  // Chi ho tro that su tren Windows/macOS (API cua Electron); Linux tuy
  // desktop environment nen bo qua, tra ve false de UI tu an muc chon.

  ipcMain.handle('app:getStartupPrefs', () => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    minimizeToTray: workspaceStore.getSettings().minimizeToTray,
    toggleHotkey: workspaceStore.getSettings().toggleHotkey,
    supported: process.platform === 'win32' || process.platform === 'darwin',
  }));

  /**
   * Chi luu vao settings khi dang ky phim tat thanh cong - tranh luu mot to
   * hop da bi ung dung khac chiem, khien lan mo app sau cu tuong da bat ma
   * thuc ra khong hoat dong.
   */
  ipcMain.handle('app:setToggleHotkey', (_event, { accelerator }) => {
    const result = trayController.registerToggleHotkey(accelerator);
    if (result.ok) workspaceStore.updateSettings({ toggleHotkey: result.hotkey });
    return result;
  });

  ipcMain.handle('app:setOpenAtLogin', (_event, { enabled }) => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('app:setMinimizeToTray', (_event, { enabled }) => {
    workspaceStore.updateSettings({ minimizeToTray: Boolean(enabled) });
    return Boolean(enabled);
  });
}

module.exports = { register };
