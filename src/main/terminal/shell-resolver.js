'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Chon shell de spawn va dung dong lenh khoi dong cho tung loai tab.
 *
 * Windows: uu tien PowerShell 7 (pwsh.exe) vi no xu ly UTF-8 tot hon han
 * Windows PowerShell 5.1 - quan trong khi duong dan du an co dau tieng Viet.
 *
 * macOS/Linux: dung shell dang nguoi dung da chon (`$SHELL`) de ke thua dung
 * alias/PATH cua ho (vd nvm, pyenv) - khong ep cung mot shell mac dinh.
 */

const IS_WINDOWS = process.platform === 'win32';

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

  if (!IS_WINDOWS) {
    cachedShell = resolvePosixShell();
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

/** `$SHELL` la shell nguoi dung tu chon trong he thong; thieu thi lui ve mac dinh theo OS. */
function resolvePosixShell() {
  const envShell = process.env.SHELL;
  if (envShell && fs.existsSync(envShell)) {
    return { path: envShell, kind: 'posix' };
  }

  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  if (fs.existsSync(fallback)) return { path: fallback, kind: 'posix' };
  return { path: '/bin/sh', kind: 'posix' };
}

function detectKind(shellPath) {
  const base = path.basename(shellPath).toLowerCase();
  if (base === 'pwsh.exe' || base === 'powershell.exe') return 'powershell';
  if (base === 'cmd.exe') return 'cmd';
  if (!IS_WINDOWS) return 'posix';
  return 'other';
}

/**
 * Dung mang tham so cho shell.
 *
 * `startupCommand` chay ngay khi mo tab roi tra lai quyen dieu khien cho shell
 * (-NoExit / /k), de khi claude thoat nguoi dung van con shell de go tiep.
 */
function buildShellArgs(shell, startupCommand) {
  if (shell.kind === 'posix') {
    // -l: shell dang nhap, doc .zshrc/.bashrc/.profile nhu mo Terminal that.
    // Co startupCommand thi chay xong roi exec lai chinh shell do (tuong duong
    // -NoExit cua PowerShell) de nguoi dung go tiep sau khi claude thoat.
    // Luu y: cu phap nay danh cho bash/zsh - fish khong tuong thich `-lc`.
    return startupCommand ? ['-lc', `${startupCommand}; exec "${shell.path}" -l`] : ['-l'];
  }
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

/** Boc trong ngoac kep neu chua khoang trang - can cho duong dan Windows co dau cach. */
function quoteArg(value) {
  const str = String(value);
  return /\s/.test(str) ? `"${str}"` : str;
}

/**
 * Dung dong lenh `ssh ...` tu ho so may chu da luu.
 *
 * Khong bao gio nhet mat khau vao day: thieu `keyPath` thi ssh tu hoi mat
 * khau hoac dung ssh-agent ngay trong terminal, giong het go tay.
 */
function sshCommandFor(host) {
  const parts = ['ssh'];
  if (host.port && host.port !== 22) parts.push('-p', String(host.port));
  if (host.keyPath) parts.push('-i', quoteArg(host.keyPath));
  for (const fwd of host.forwards || []) {
    parts.push(`-${fwd.type}`, `${fwd.localPort}:${fwd.remoteHost}:${fwd.remotePort}`);
  }
  const target = host.username ? `${host.username}@${host.host}` : host.host;
  parts.push(target);
  return parts.join(' ');
}

/**
 * Boc lenh ssh trong mot vong lap thu ket noi lai, dung khi ho so bat "tu dong
 * ket noi lai". Vong lap vo han - chi dung khi tab bi dong (giet ca cay tien
 * trinh) hoac nguoi dung tu Ctrl+C giua luc cho.
 *
 * Moi shell co cu phap vong lap rieng nen phai viet tay tung nhanh; cmd.exe
 * dung `for /l %%i in (1,0,2)` (buoc nhay 0) de vong lap khong bao gio dung.
 */
function wrapWithReconnect(shellKind, sshCmd) {
  if (shellKind === 'posix') {
    return `while true; do ${sshCmd}; echo; echo "[mất kết nối, thử lại sau 3 giây...]"; sleep 3; done`;
  }
  if (shellKind === 'powershell') {
    return `while ($true) { ${sshCmd}; Write-Host "\`n[mất kết nối, thử lại sau 3 giây...]" -ForegroundColor DarkGray; Start-Sleep -Seconds 3 }`;
  }
  if (shellKind === 'cmd') {
    return `for /l %%i in (1,0,2) do (${sshCmd} & echo. & echo [mat ket noi, thu lai sau 3 giay...] & timeout /t 3 /nobreak >nul)`;
  }
  return sshCmd;
}

/**
 * Dong lenh khoi dong ung voi loai tab.
 * - shell        : chi mo shell tran
 * - claude       : mo phien claude moi
 * - claude-resume: noi tiep mot phien cu theo session id
 * - ssh          : ket noi toi may chu da luu (options.sshHost)
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
  if (sessionType === 'ssh') {
    if (!options.sshHost) throw new Error('Thiếu hồ sơ SSH để kết nối');
    const cmd = sshCommandFor(options.sshHost);
    return options.sshHost.autoReconnect ? wrapWithReconnect(options.shellKind, cmd) : cmd;
  }
  return null;
}

/**
 * Duong dan `scp`, dung rieng cho tinh nang keo-tha upload file (khong qua
 * PTY - day la tien trinh mot lan, ket qua tra ve qua IPC roi ghi thang len
 * xterm o renderer).
 *
 * Windows 10/11 luon kem san OpenSSH client (ssh.exe/scp.exe) tai
 * System32\OpenSSH, nhung thu muc do khong luon nam trong PATH.
 */
function resolveScp() {
  const onPath = findOnPath(IS_WINDOWS ? 'scp.exe' : 'scp');
  if (onPath) return onPath;
  if (IS_WINDOWS) {
    const fallback = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'scp.exe');
    if (fs.existsSync(fallback)) return fallback;
  }
  return null;
}

module.exports = { resolveShell, buildShellArgs, startupCommandFor, resolveScp };
