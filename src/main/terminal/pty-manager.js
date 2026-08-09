'use strict';

const fs = require('node:fs');
const os = require('node:os');
const pty = require('@lydell/node-pty');
const scrollbackStore = require('../storage/scrollback-store');
const workspaceStore = require('../storage/workspace-store');
const sshStore = require('../storage/ssh-store');
const { claudeConfigDir } = require('../app-paths');
const { resolveShell, buildShellArgs, startupCommandFor } = require('./shell-resolver');

/**
 * Quan ly vong doi cac tien trinh PTY, moi tab terminal la mot tien trinh.
 *
 * Output PTY di theo hai duong: gui len renderer de ve, va ghi xuong
 * scrollback-store de xem lai sau.
 */

/** tabId -> { proc, cwd, sessionType, exited } */
const sessions = new Map();

let sendToRenderer = () => {};

function setRendererSink(fn) {
  sendToRenderer = fn;
}

function resolveCwd(requestedCwd) {
  if (requestedCwd) {
    try {
      if (fs.statSync(requestedCwd).isDirectory()) return requestedCwd;
    } catch {
      // Thu muc da bi xoa/doi ten -> lui ve home thay vi spawn that bai.
    }
  }
  return os.homedir();
}

/**
 * Cac bien danh dau mot phien Claude Code dang chay.
 *
 * Neu app duoc mo tu ben trong mot phien Claude Code (vi du go lenh trong
 * terminal cua no), nhung bien nay se nam san trong moi truong va di theo moi
 * tien trinh con. Khi do `claude` moi tuong no la phien con, va TAT viec luu
 * transcript kem canh bao "Transcript saving is off - inherited
 * CLAUDE_CODE_CHILD_SESSION marker".
 *
 * Voi ung dung nay do la hong hoc nghiem trong va am tham: toan bo tinh nang
 * lich su dua tren chinh nhung transcript do. Vi vay moi tab luon phai khoi
 * dong nhu mot phien doc lap.
 *
 * Chi go dung cac dau hieu theo phien. Cau hinh that cua nguoi dung nhu
 * CLAUDE_CONFIG_DIR, ANTHROPIC_API_KEY hay ANTHROPIC_BASE_URL van giu nguyen.
 */
const CLAUDE_SESSION_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_PID',
];

/** Bien moi truong cho phien con. */
function buildEnv() {
  const env = { ...process.env };

  // Tien trinh con khong duoc hieu nham no dang chay ben trong Electron.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  for (const marker of CLAUDE_SESSION_MARKERS) delete env[marker];

  // Ho so tai khoan duoc truyen vao app qua tham so dong lenh, nhung `claude`
  // trong terminal chi doc bien moi truong. Khong dat lai o day thi app va
  // terminal se dung hai tai khoan khac nhau - lich su hien mot dang, phien
  // chay lai ra dang khac.
  env.CLAUDE_CONFIG_DIR = claudeConfigDir;

  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

function create({ tabId, cwd, sessionType = 'shell', resumeSessionId, sshHostId, cols = 80, rows = 24 }) {
  // Renderer co the bi nap lai (crash roi tu phuc hoi) va tao lai dung tab cu.
  // Khi do tien trinh cu khong con ai doc output nua - phai giet no truoc, neu
  // khong no se song mo coi va tab moi bao loi khong mo duoc phien.
  if (sessions.has(tabId)) kill(tabId);

  const shell = resolveShell();
  const workingDir = resolveCwd(cwd);
  // Chi ap dung cho phien claude/claude-resume - shell tran khong lien quan gi
  // toi cai nay.
  const skipPermissions =
    (sessionType === 'claude' || sessionType === 'claude-resume') &&
    workspaceStore.isSkipPermissionsProject(workingDir);

  let sshHost = null;
  if (sessionType === 'ssh') {
    sshHost = sshStore.getHost(sshHostId);
    if (!sshHost) throw new Error('Không tìm thấy hồ sơ SSH này (có thể đã bị xoá).');
    sshStore.touchLastUsed(sshHostId);
  }

  const startupCommand = startupCommandFor(sessionType, {
    resumeSessionId,
    skipPermissions,
    sshHost,
    shellKind: shell.kind,
  });
  const args = buildShellArgs(shell, startupCommand);

  const proc = pty.spawn(shell.path, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workingDir,
    env: buildEnv(),
    // useConpty chi co y nghia tren Windows; khong dat tren macOS/Linux.
    ...(process.platform === 'win32' ? { useConpty: true } : {}),
  });

  const session = { proc, cwd: workingDir, sessionType, exited: false };
  sessions.set(tabId, session);

  proc.onData((data) => {
    sendToRenderer('pty:data', { tabId, data });
    scrollbackStore.append(tabId, data);
  });

  proc.onExit(({ exitCode, signal }) => {
    session.exited = true;

    // onExit ve khong dong bo. Neu tab da duoc tao lai voi cung id (renderer
    // nap lai), ban ghi trong map da la phien MOI - tien trinh cu thoat sau do
    // khong duoc phep xoa ban ghi ay hay bao cho renderer la tab da chet.
    if (sessions.get(tabId) !== session) return;

    sessions.delete(tabId);
    scrollbackStore.append(tabId, `\r\n\x1b[90m[phiên kết thúc, mã thoát ${exitCode}]\x1b[0m\r\n`);
    scrollbackStore.flush(tabId);
    sendToRenderer('pty:exit', { tabId, exitCode, signal });
  });

  return {
    tabId,
    cwd: workingDir,
    shell: shell.path,
    sessionType,
    skipPermissions,
    sshHostName: sshHost?.name || null,
  };
}

function write(tabId, data) {
  const session = sessions.get(tabId);
  if (!session || session.exited) return false;
  session.proc.write(data);
  return true;
}

function resize(tabId, cols, rows) {
  const session = sessions.get(tabId);
  if (!session || session.exited) return false;
  // ConPTY sap neu nhan kich thuoc 0 hoac am (xay ra khi tab dang bi an).
  const safeCols = Math.max(2, Math.floor(cols) || 2);
  const safeRows = Math.max(1, Math.floor(rows) || 1);
  try {
    session.proc.resize(safeCols, safeRows);
    return true;
  } catch {
    return false;
  }
}

function kill(tabId) {
  const session = sessions.get(tabId);
  if (!session) return false;
  try {
    session.proc.kill();
  } catch {
    // Tien trinh co the da tu thoat truoc do.
  }
  sessions.delete(tabId);
  scrollbackStore.flush(tabId);
  return true;
}

function killAll() {
  for (const tabId of [...sessions.keys()]) kill(tabId);
  scrollbackStore.flushAll();
}

function isAlive(tabId) {
  const session = sessions.get(tabId);
  return Boolean(session && !session.exited);
}

module.exports = { setRendererSink, create, write, resize, kill, killAll, isAlive };
