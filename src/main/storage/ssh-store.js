'use strict';

const crypto = require('node:crypto');
const { sshHostsPath } = require('../app-paths');
const { readJson, writeJson } = require('./json-store');

/**
 * Ho so may chu SSH nguoi dung tu luu.
 *
 * Xac thuc cho PHIEN TERMINAL (tab ssh) van do chinh `ssh` lo: co keyPath thi
 * dung khoa, khong thi ssh tu hoi mat khau trong terminal - app khong xen vao.
 *
 * `password` chi phuc vu cac KENH PHU chay ngoai PTY (upload file khi keo-tha
 * hoac dan anh, trinh duyet SFTP): cac kenh do khong co terminal de nguoi dung
 * go mat khau, nen khong luu thi chung khong the xac thuc duoc voi may chu chi
 * cho dang nhap bang mat khau.
 *
 * Luu y bao mat: truong nay ghi xuong dia dang VAN BAN THUONG theo lua chon cua
 * nguoi dung - bat ky tien trinh nao chay duoi cung tai khoan Windows deu doc
 * duoc. Dung khoa SSH thay cho mat khau neu can an toan hon.
 */

function listHosts() {
  const data = readJson(sshHostsPath(), null);
  return Array.isArray(data?.hosts) ? data.hosts : [];
}

function getHost(id) {
  if (!id) return null;
  return listHosts().find((h) => h.id === id) || null;
}

function sanitizeForward(forward) {
  const type = forward?.type === 'R' ? 'R' : 'L';
  const localPort = Number(forward?.localPort);
  const remotePort = Number(forward?.remotePort);
  const remoteHost = String(forward?.remoteHost || 'localhost').slice(0, 200);
  if (!Number.isInteger(localPort) || localPort <= 0 || localPort > 65535) return null;
  if (!Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535) return null;
  return { type, localPort, remoteHost, remotePort };
}

/** Lenh nhanh rieng cho mot may chu (vd `systemctl restart nginx`) - hien trong quick-bar khi tab ssh cua host nay dang mo. */
function sanitizeCommand(command) {
  const label = String(command?.label || '').trim().slice(0, 60);
  const cmd = String(command?.cmd || '').trim().slice(0, 500);
  if (!label || !cmd) return null;
  return { id: typeof command?.id === 'string' ? command.id.slice(0, 64) : crypto.randomUUID(), label, cmd };
}

/** Chuan hoa du lieu tu form truoc khi ghi dia - form la du lieu nguoi dung nhap tay. */
function sanitizeHost(input) {
  const port = Number(input?.port);
  return {
    name: String(input?.name || '').trim().slice(0, 100) || String(input?.host || '').trim(),
    host: String(input?.host || '').trim().slice(0, 300),
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22,
    username: String(input?.username || '').trim().slice(0, 100),
    keyPath: String(input?.keyPath || '').trim() || null,
    // Khong trim: mat khau co the co khoang trang dau/cuoi that.
    password: typeof input?.password === 'string' && input.password ? input.password : null,
    autoReconnect: Boolean(input?.autoReconnect),
    forwards: Array.isArray(input?.forwards)
      ? input.forwards.map(sanitizeForward).filter(Boolean).slice(0, 10)
      : [],
    commands: Array.isArray(input?.commands)
      ? input.commands.map(sanitizeCommand).filter(Boolean).slice(0, 20)
      : [],
  };
}

function addHost(input) {
  const hosts = listHosts();
  const host = {
    id: crypto.randomUUID(),
    ...sanitizeHost(input),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  hosts.unshift(host);
  writeJson(sshHostsPath(), { hosts });
  return host;
}

function updateHost(id, input) {
  const hosts = listHosts();
  const index = hosts.findIndex((h) => h.id === id);
  if (index === -1) return null;

  const next = sanitizeHost(input);
  // Form sua ho so khong gui lai mat khau da luu (o nhap de trong nghia la
  // "giu nguyen", khong phai "xoa di") - chi ghi de khi nguoi dung thuc su
  // nhap gia tri moi. Xoa mat khau thi dung `password: ''` tuong minh.
  if (next.password === null && input?.password !== '') {
    next.password = hosts[index].password || null;
  }

  hosts[index] = { ...hosts[index], ...next };
  writeJson(sshHostsPath(), { hosts });
  return hosts[index];
}

function removeHost(id) {
  const hosts = listHosts().filter((h) => h.id !== id);
  writeJson(sshHostsPath(), { hosts });
  return hosts;
}

function touchLastUsed(id) {
  const hosts = listHosts();
  const index = hosts.findIndex((h) => h.id === id);
  if (index === -1) return;
  hosts[index] = { ...hosts[index], lastUsedAt: new Date().toISOString() };
  writeJson(sshHostsPath(), { hosts });
}

module.exports = { listHosts, getHost, addHost, updateHost, removeHost, touchLastUsed };
