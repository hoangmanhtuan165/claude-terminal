'use strict';

const fs = require('node:fs');
const { Client } = require('ssh2');

/**
 * Cac ket noi SFTP dang mo cho trinh duyet file - hoan toan doc lap voi PTY
 * dang chay trong tab (neu co), tu ket noi rieng bang thong tin xac thuc cua
 * ho so.
 */

let nextId = 1;
/** connId -> { conn, sftp } */
const connections = new Map();

const CONNECT_TIMEOUT_MS = 15000;

/**
 * `readyTimeout` cua ssh2 chi tinh tu khi socket TCP da noi xong; mot dia chi
 * "den" (khong ai phan hoi SYN/RST, vd may chu sai hoac tuong lua nuot goi
 * tin) co the treo lau hon nhieu o buoc TCP truoc do. Boc them mot deadline
 * cung o day de dam bao luon that bai trong khoang thoi gian du doan duoc,
 * bat ke ssh2 xu ly buoc nao dang cham.
 */
function connect(host) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const timer = setTimeout(() => {
      conn.destroy();
      finish(reject, new Error('Hết thời gian chờ kết nối tới máy chủ.'));
    }, CONNECT_TIMEOUT_MS);

    conn
      .on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return finish(reject, err);
          }
          const connId = String(nextId++);
          connections.set(connId, { conn, sftp });
          finish(resolve, connId);
        });
      })
      .on('error', (err) => finish(reject, err))
      .connect({
        host: host.host,
        port: host.port || 22,
        username: host.username || undefined,
        privateKey: host.keyPath ? fs.readFileSync(host.keyPath) : undefined,
        agent: !host.keyPath ? process.env.SSH_AUTH_SOCK : undefined,
        readyTimeout: CONNECT_TIMEOUT_MS,
      });
  });
}

function getSftp(connId) {
  const entry = connections.get(connId);
  if (!entry) throw new Error('Phiên SFTP đã đóng hoặc không tồn tại.');
  return entry.sftp;
}

function realpath(connId, remotePath) {
  return new Promise((resolve, reject) => {
    getSftp(connId).realpath(remotePath, (err, absPath) => (err ? reject(err) : resolve(absPath)));
  });
}

function list(connId, remotePath) {
  return new Promise((resolve, reject) => {
    getSftp(connId).readdir(remotePath, (err, entries) => {
      if (err) return reject(err);
      resolve(
        entries
          .map((entry) => ({
            name: entry.filename,
            isDirectory: entry.attrs.isDirectory(),
            size: entry.attrs.size,
            mtime: entry.attrs.mtime * 1000,
          }))
          .sort((a, b) =>
            a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
          ),
      );
    });
  });
}

function mkdir(connId, remotePath) {
  return new Promise((resolve, reject) => {
    getSftp(connId).mkdir(remotePath, (err) => (err ? reject(err) : resolve()));
  });
}

function unlink(connId, remotePath) {
  return new Promise((resolve, reject) => {
    getSftp(connId).unlink(remotePath, (err) => (err ? reject(err) : resolve()));
  });
}

function rmdir(connId, remotePath) {
  return new Promise((resolve, reject) => {
    getSftp(connId).rmdir(remotePath, (err) => (err ? reject(err) : resolve()));
  });
}

function download(connId, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    getSftp(connId).fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()));
  });
}

function upload(connId, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    getSftp(connId).fastPut(localPath, remotePath, (err) => (err ? reject(err) : resolve()));
  });
}

function disconnect(connId) {
  const entry = connections.get(connId);
  if (!entry) return;
  try {
    entry.conn.end();
  } catch {
    // Ket noi co the da roi truoc do.
  }
  connections.delete(connId);
}

function disconnectAll() {
  for (const connId of [...connections.keys()]) disconnect(connId);
}

module.exports = {
  connect,
  realpath,
  list,
  mkdir,
  unlink,
  rmdir,
  download,
  upload,
  disconnect,
  disconnectAll,
};
