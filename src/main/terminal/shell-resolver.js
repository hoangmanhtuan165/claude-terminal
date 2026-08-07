'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Chon shell de spawn va dung dong lenh khoi dong cho tung loai tab.
 *
 * Uu tien PowerShell 7 (pwsh.exe) vi no xu ly UTF-8 tot hon han Windows
 * PowerShell 5.1 - quan trong khi duong dan du an co dau tieng Viet.
 */

let cachedShell = null;

function findOnPath(exeName) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, exeName);
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Thu muc trong PATH co the khong ton tai; bo qua.
    }
  }
  return null;
}

function resolveShell() {
  if (cachedShell) return cachedShell;

  const override = process.env.CLAUDE_TERMINAL_SHELL;
  if (override && fs.existsSync(override)) {
    cachedShell = { path: override, kind: detectKind(override) };
    return cachedShell;
  }

  const pwsh = findOnPath('pwsh.exe');
  if (pwsh) {
    cachedShell = { path: pwsh, kind: 'powershell' };
    return cachedShell;
  }

  const windowsPowerShell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  if (fs.existsSync(windowsPowerShell)) {
    cachedShell = { path: windowsPowerShell, kind: 'powershell' };
    return cachedShell;
  }

  cachedShell = { path: process.env.ComSpec || 'cmd.exe', kind: 'cmd' };
  return cachedShell;
}

function detectKind(shellPath) {
  const base = path.basename(shellPath).toLowerCase();
  if (base === 'pwsh.exe' || base === 'powershell.exe') return 'powershell';
  if (base === 'cmd.exe') return 'cmd';
  return 'other';
}

/**
 * Dung mang tham so cho shell.
 *
 * `startupCommand` chay ngay khi mo tab roi tra lai quyen dieu khien cho shell
 * (-NoExit / /k), de khi claude thoat nguoi dung van con shell de go tiep.
 */
function buildShellArgs(shell, startupCommand) {
  if (!startupCommand) {
    return shell.kind === 'powershell' ? ['-NoLogo'] : [];
  }
  if (shell.kind === 'powershell') {
    return ['-NoLogo', '-NoExit', '-Command', startupCommand];
  }
  if (shell.kind === 'cmd') {
    return ['/k', startupCommand];
  }
  return [];
}

/**
 * Dong lenh khoi dong ung voi loai tab.
 * - shell        : chi mo shell tran
 * - claude       : mo phien claude moi
 * - claude-resume: noi tiep mot phien cu theo session id
 */
function startupCommandFor(sessionType, options = {}) {
  const skipFlag = options.skipPermissions ? ' --dangerously-skip-permissions' : '';
  if (sessionType === 'claude') return `claude${skipFlag}`;
  if (sessionType === 'claude-resume') {
    const id = String(options.resumeSessionId || '').trim();
    // Chi nhan dinh dang UUID: gia tri nay di thang vao dong lenh shell.
    if (!/^[a-fA-F0-9-]{8,64}$/.test(id)) {
      throw new Error(`Session id khong hop le: ${options.resumeSessionId}`);
    }
    return `claude --resume ${id}${skipFlag}`;
  }
  return null;
}

module.exports = { resolveShell, buildShellArgs, startupCommandFor };
