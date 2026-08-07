'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron');

const ipcHandlers = require('./ipc-handlers');
const ptyManager = require('./terminal/pty-manager');
const scrollbackStore = require('./storage/scrollback-store');
const historySearch = require('./history/history-search');
const workspaceStore = require('./storage/workspace-store');
const { crashLogPath } = require('./app-paths');
const { titleBarOverlayFor, resolveTheme } = require('./theme');

/**
 * Diem vao cua tien trinh main: tao cua so, gan IPC, va dam bao moi tien trinh
 * con cung log dang cho deu duoc don sach khi thoat.
 */

// App tung tu tat giua chung voi loi native cua Chromium (Windows Event Viewer:
// exception 0xc0000409 / BEX64), giong crash cua tien trinh GPU tren driver
// NVIDIA. Tat tang toc phan cung de loai kha nang nay - xterm ve bang canvas
// 2D, khong can GPU de muot.
app.disableHardwareAcceleration();

const isDev = process.argv.includes('--dev');

/** Ghi lai crash/exception cap tien trinh vao dia, vi loi native khien app
 * dong ngay khong kip hien gi len man hinh - phai co dau vet de xem lai sau. */
function logCrash(label, detail) {
  const line = `[${new Date().toISOString()}] ${label}: ${detail}\n`;
  try {
    fs.appendFileSync(crashLogPath(), line, 'utf8');
  } catch {
    // Khong the ghi log thi cung khong con gi lam them duoc.
  }
  if (isDev) console.error(line);
}

process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err?.stack || String(err));
});

process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason?.stack || String(reason));
});

app.on('render-process-gone', (_event, _webContents, details) => {
  logCrash('render-process-gone', `reason=${details.reason} exitCode=${details.exitCode}`);
});

app.on('child-process-gone', (_event, details) => {
  logCrash(
    'child-process-gone',
    `type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
  );
});

let mainWindow = null;

// Chi dung khi chay tu ma nguon (npm start): electron.exe tu mang icon mac
// dinh cua no o taskbar luc do. Ban dong goi khong can dong nay - .exe da
// mang san icon rieng qua build.win.icon trong package.json.
const devIconPath = path.join(__dirname, '..', '..', 'build', 'icon.ico');

function createWindow() {
  const theme = resolveTheme(workspaceStore.getSettings().theme);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: theme === 'light' ? '#fbf9f6' : '#1a1812',
    title: 'KLTERMINAL',
    icon: fs.existsSync(devIconPath) ? devIconPath : undefined,
    autoHideMenuBar: true,
    // Thanh tieu de he thong bi an de tab len nam thang tren do, nhung nut
    // thu/phong/dong van la nut that cua Windows. Giu chung lai thay vi tu ve
    // de khong mat Snap Layouts (ro chuot vao nut phong to).
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor(theme),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      // Renderer khong duoc cham vao Node. Moi thao tac he thong di qua IPC.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // Link trong hoi thoai phai mo bang trinh duyet he thong, khong duoc thay the
  // noi dung cua so app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      // Menu nay khong hien (menu bar tu an), nhung PHAI co: Electron chi noi
      // phim tat Ctrl+C/V/X/A/Z toi lenh edit that su qua accelerator cua menu
      // - thieu muc Edit thi nhung phim nay khong hoat dong o bat ky o nhap
      // lieu nao trong app (kem ca textarea an cua xterm.js), du trinh duyet
      // binh thuong se tu lam dieu nay khong can khai bao gi ca.
      label: 'Sửa',
      submenu: [
        { role: 'undo', label: 'Hoàn tác' },
        { role: 'redo', label: 'Làm lại' },
        { type: 'separator' },
        { role: 'cut', label: 'Cắt' },
        { role: 'copy', label: 'Sao chép' },
        { role: 'paste', label: 'Dán' },
        { role: 'selectAll', label: 'Chọn tất cả' },
      ],
    },
    {
      label: 'Phiên',
      submenu: [
        {
          label: 'Tab Claude mới',
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow?.webContents.send('menu:newClaudeTab'),
        },
        {
          label: 'Tab shell mới',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => mainWindow?.webContents.send('menu:newShellTab'),
        },
        { type: 'separator' },
        {
          label: 'Chia đôi màn hình',
          accelerator: 'CmdOrCtrl+\\',
          click: () => mainWindow?.webContents.send('menu:splitPane'),
        },
        {
          label: 'Chuyển sang ô bên kia',
          accelerator: 'CmdOrCtrl+]',
          click: () => mainWindow?.webContents.send('menu:focusOtherPane'),
        },
        {
          label: 'Đóng ô đang chọn',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => mainWindow?.webContents.send('menu:closePane'),
        },
        { type: 'separator' },
        {
          label: 'Đóng tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow?.webContents.send('menu:closeTab'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Thoát' },
      ],
    },
    {
      label: 'Lịch sử',
      submenu: [
        {
          label: 'Mở lịch sử',
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow?.webContents.send('menu:openHistory'),
        },
        {
          label: 'Tìm trong lịch sử',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow?.webContents.send('menu:focusSearch'),
        },
        {
          label: 'Quét lại lịch sử',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu:refreshHistory'),
        },
      ],
    },
    {
      label: 'Xem',
      submenu: [
        // Co y khong dua role 'reload' vao day. Tai lai renderer se huy toan bo
        // instance xterm trong khi tien trinh PTY van song, bo roi cac phien
        // dang chay. Ctrl+R vi vay duoc danh cho viec quet lai lich su.
        { role: 'resetZoom', label: 'Cỡ chữ mặc định' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toàn màn hình' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools', label: 'Công cụ phát triển' }] : []),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Chi cho phep mot the hien: nhieu cua so cung ghi vao tabs.json/scrollback se
// ghi de len nhau.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    ipcHandlers.register(() => mainWindow);
    buildMenu();
    createWindow();

    // Nguoi dung doi sang/toi trong cai dat Windows: chi doi theo khi ho de
    // che do 'system'. Neu da chon co dinh sang hay toi thi ton trong lua chon.
    nativeTheme.on('updated', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (workspaceStore.getSettings().theme !== 'system') return;

      const theme = resolveTheme('system');
      mainWindow.setTitleBarOverlay(titleBarOverlayFor(theme));
      mainWindow.webContents.send('theme:changed', { theme });
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  // Giet PTY truoc, roi xa not phan log con nam trong buffer.
  ptyManager.killAll();
  scrollbackStore.flushAll();
  historySearch.shutdown();
});
