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
    onIndexProgress: (callback) => subscribe('history:indexProgress', callback),
    onSearchHits: (callback) => subscribe('history:searchHits', callback),
    onSearchProgress: (callback) => subscribe('history:searchProgress', callback),
    onSearchDone: (callback) => subscribe('history:searchDone', callback),
    onSearchError: (callback) => subscribe('history:searchError', callback),
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
  },

  clipboard: {
    pasteImage: () => ipcRenderer.invoke('clipboard:pasteImage'),
    readText: () => ipcRenderer.invoke('clipboard:readText'),
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
    onSplitPane: (callback) => subscribe('menu:splitPane', callback),
    onFocusOtherPane: (callback) => subscribe('menu:focusOtherPane', callback),
    onClosePane: (callback) => subscribe('menu:closePane', callback),
    onOpenHistory: (callback) => subscribe('menu:openHistory', callback),
    onFocusSearch: (callback) => subscribe('menu:focusSearch', callback),
    onRefreshHistory: (callback) => subscribe('menu:refreshHistory', callback),
    onOpenProjectTab: (callback) => subscribe('menu:openProjectTab', callback),
  },
});
