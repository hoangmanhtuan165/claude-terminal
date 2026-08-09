'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Cau noi duy nhat giua renderer va main.
 *
 * Chi phoi bay dung nhung ham can thiet, khong bao gio lo `ipcRenderer` tho ra
 * window - neu khong, bat ky doan chu nao hien trong terminal cung co the tro
 * thanh duong tan cong neu renderer bi chen script.
 */

/** Dang ky listener va tra ve ham go bo, tranh ro ri khi tab bi dong. */
function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  pty: {
    create: (options) => ipcRenderer.invoke('pty:create', options),
    write: (tabId, data) => ipcRenderer.send('pty:write', { tabId, data }),
    resize: (tabId, cols, rows) => ipcRenderer.send('pty:resize', { tabId, cols, rows }),
    kill: (tabId) => ipcRenderer.invoke('pty:kill', { tabId }),
    isAlive: (tabId) => ipcRenderer.invoke('pty:isAlive', { tabId }),
    onData: (callback) => subscribe('pty:data', callback),
    onExit: (callback) => subscribe('pty:exit', callback),
  },

  scrollback: {
    restore: (tabId) => ipcRenderer.invoke('scrollback:restore', { tabId }),
    full: (tabId) => ipcRenderer.invoke('scrollback:full', { tabId }),
    remove: (tabId) => ipcRenderer.invoke('scrollback:remove', { tabId }),
    export: (tabId, suggestedName) =>
      ipcRenderer.invoke('scrollback:export', { tabId, suggestedName }),
  },

  tabs: {
    load: () => ipcRenderer.invoke('tabs:load'),
    save: (state) => ipcRenderer.invoke('tabs:save', state),
    pruneScrollback: (liveTabIds) => ipcRenderer.invoke('tabs:pruneScrollback', { liveTabIds }),
  },

  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    pin: (cwd) => ipcRenderer.invoke('projects:pin', { cwd }),
    unpin: (cwd) => ipcRenderer.invoke('projects:unpin', { cwd }),
    reorderPinned: (orderedCwds) => ipcRenderer.invoke('projects:reorderPinned', { orderedCwds }),
    pruneMissing: () => ipcRenderer.invoke('projects:pruneMissing'),
    hide: (cwd) => ipcRenderer.invoke('projects:hide', { cwd }),
    browse: () => ipcRenderer.invoke('projects:browse'),
    toggleSkipPermissions: (cwd) => ipcRenderer.invoke('projects:toggleSkipPermissions', { cwd }),
    showContextMenu: (payload) => ipcRenderer.invoke('projects:showContextMenu', payload),
    onChanged: (callback) => subscribe('projects:changed', callback),
  },

  history: {
    refresh: () => ipcRenderer.invoke('history:refresh'),
    listSessions: (cwdFilter) => ipcRenderer.invoke('history:listSessions', { cwdFilter }),
    readTranscript: (filePath) => ipcRenderer.invoke('history:readTranscript', { filePath }),
    findSession: (sessionId) => ipcRenderer.invoke('history:findSession', { sessionId }),
    revealFile: (filePath) => ipcRenderer.invoke('history:revealFile', { filePath }),
    search: (params) => ipcRenderer.invoke('history:search', params),
    cancelSearch: (requestId) => ipcRenderer.invoke('history:cancelSearch', { requestId }),
    storageStats: () => ipcRenderer.invoke('history:storageStats'),
    usageStats: () => ipcRenderer.invoke('history:usageStats'),
    previewCleanup: (targetFreeBytes) => ipcRenderer.invoke('history:previewCleanup', { targetFreeBytes }),
    cleanupOldest: (targetFreeBytes) => ipcRenderer.invoke('history:cleanupOldest', { targetFreeBytes }),
    onIndexProgress: (callback) => subscribe('history:indexProgress', callback),
    onSearchHits: (callback) => subscribe('history:searchHits', callback),
    onSearchProgress: (callback) => subscribe('history:searchProgress', callback),
    onSearchDone: (callback) => subscribe('history:searchDone', callback),
    onSearchError: (callback) => subscribe('history:searchError', callback),
  },

  terminal: {
    showContextMenu: (payload) => ipcRenderer.invoke('terminal:showContextMenu', payload),
  },

  ssh: {
    list: () => ipcRenderer.invoke('ssh:list'),
    add: (input) => ipcRenderer.invoke('ssh:add', input),
    update: (id, input) => ipcRenderer.invoke('ssh:update', { id, ...input }),
    remove: (id) => ipcRenderer.invoke('ssh:remove', { id }),
    browseKey: () => ipcRenderer.invoke('ssh:browseKey'),
    uploadFile: (hostId, localPath) => ipcRenderer.invoke('ssh:uploadFile', { hostId, localPath }),
  },

  sftp: {
    connect: (hostId) => ipcRenderer.invoke('sftp:connect', { hostId }),
    list: (connId, path) => ipcRenderer.invoke('sftp:list', { connId, path }),
    mkdir: (connId, path) => ipcRenderer.invoke('sftp:mkdir', { connId, path }),
    delete: (connId, path) => ipcRenderer.invoke('sftp:delete', { connId, path }),
    rmdir: (connId, path) => ipcRenderer.invoke('sftp:rmdir', { connId, path }),
    disconnect: (connId) => ipcRenderer.invoke('sftp:disconnect', { connId }),
    download: (connId, remotePath, fileName) =>
      ipcRenderer.invoke('sftp:download', { connId, remotePath, fileName }),
    upload: (connId, remoteDir, localPaths) =>
      ipcRenderer.invoke('sftp:upload', { connId, remoteDir, localPaths }),
  },

  workspace: {
    listPresets: () => ipcRenderer.invoke('workspace:listPresets'),
    savePreset: (name, tabs) => ipcRenderer.invoke('workspace:savePreset', { name, tabs }),
    removePreset: (id) => ipcRenderer.invoke('workspace:removePreset', { id }),
  },

  git: {
    branch: (cwd) => ipcRenderer.invoke('git:branch', { cwd }),
  },

  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
  },

  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback) => subscribe('update:status', callback),
  },

  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (preference) => ipcRenderer.invoke('theme:set', { preference }),
    onChanged: (callback) => subscribe('theme:changed', callback),
  },

  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch),
  },

  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    set: (sessionId, patch) => ipcRenderer.invoke('notes:set', { sessionId, ...patch }),
  },

  /**
   * Trang thai dang nhap Claude Code. Chi doc, va phia main da loc bo token -
   * khong co ham nao o day ghi vao .credentials.json.
   */
  /**
   * Muc su dung: han muc goi (goi API o main) va so lieu doc tu file local.
   * Chi nhan phan tram va so token da tong hop - token dang nhap khong xuong day.
   */
  usage: {
    limits: (force = false) => ipcRenderer.invoke('usage:limits', { force }),
    local: (force = false) => ipcRenderer.invoke('usage:local', { force }),
  },

  account: {
    status: () => ipcRenderer.invoke('account:status'),
    listProfiles: () => ipcRenderer.invoke('account:listProfiles'),
    addProfile: (name) => ipcRenderer.invoke('account:addProfile', { name }),
    removeProfile: (id) => ipcRenderer.invoke('account:removeProfile', { id }),
    switchProfile: (configDir) => ipcRenderer.invoke('account:switchProfile', { configDir }),
  },

  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', { url }),
    focusWindow: () => ipcRenderer.invoke('app:focusWindow'),
    getStartupPrefs: () => ipcRenderer.invoke('app:getStartupPrefs'),
    setOpenAtLogin: (enabled) => ipcRenderer.invoke('app:setOpenAtLogin', { enabled }),
    setMinimizeToTray: (enabled) => ipcRenderer.invoke('app:setMinimizeToTray', { enabled }),
    setToggleHotkey: (accelerator) => ipcRenderer.invoke('app:setToggleHotkey', { accelerator }),
  },

  clipboard: {
    pasteImage: () => ipcRenderer.invoke('clipboard:pasteImage'),
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', { text }),
    captureScreenshot: () => ipcRenderer.invoke('clipboard:captureScreenshot'),
  },

  /**
   * Duong dan that tren dia cua mot File duoc keo-tha vao.
   *
   * Tu Electron 32, `File.path` da bi bo; `webUtils.getPathForFile` la duong
   * chinh thuc thay the va bat buoc phai goi tu preload (renderer khong co
   * `webUtils`).
   */
  files: {
    pathFor: (file) => {
      try {
        return webUtils.getPathForFile(file) || null;
      } catch {
        return null;
      }
    },
  },

  menu: {
    onNewClaudeTab: (callback) => subscribe('menu:newClaudeTab', callback),
    onNewShellTab: (callback) => subscribe('menu:newShellTab', callback),
    onCloseTab: (callback) => subscribe('menu:closeTab', callback),
    onReopenClosedTab: (callback) => subscribe('menu:reopenClosedTab', callback),
    onSplitPane: (callback) => subscribe('menu:splitPane', callback),
    onFocusOtherPane: (callback) => subscribe('menu:focusOtherPane', callback),
    onClosePane: (callback) => subscribe('menu:closePane', callback),
    onOpenHistory: (callback) => subscribe('menu:openHistory', callback),
    onFocusSearch: (callback) => subscribe('menu:focusSearch', callback),
    onRefreshHistory: (callback) => subscribe('menu:refreshHistory', callback),
    onOpenProjectTab: (callback) => subscribe('menu:openProjectTab', callback),
    onPasteToTerminal: (callback) => subscribe('menu:pasteToTerminal', callback),
    onTerminalFontIncrease: (callback) => subscribe('menu:terminalFontIncrease', callback),
    onTerminalFontDecrease: (callback) => subscribe('menu:terminalFontDecrease', callback),
    onTerminalFontReset: (callback) => subscribe('menu:terminalFontReset', callback),
  },
});
