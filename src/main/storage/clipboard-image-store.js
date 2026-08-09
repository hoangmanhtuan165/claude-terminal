'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { clipboard, shell } = require('electron');
const { pastedImagesDir } = require('../app-paths');

/**
 * Luu anh dang co trong clipboard he thong ra file PNG tam, de dan duong dan
 * vao terminal - PTY la luong van ban thuan, khong the nhan thang byte anh.
 *
 * Claude Code (va hau het CLI khac) nhan anh qua duong dan file go/dan vao
 * prompt, giong cach VS Code terminal xu ly khi dan anh.
 */

let counter = 0;

// Anh tam khong can giu lau: don sach truoc moi lan luu de thu muc khong phinh
// to qua nhung phien dung app dai ngay.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function pruneOld() {
  const dir = pastedImagesDir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of entries) {
    const filePath = path.join(dir, name);
    try {
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath);
    } catch {
      // Bo qua file dang bi khoa hoac vua bi xoa boi tien trinh khac.
    }
  }
}

/** Ghi mot buffer PNG ra file tam, tra ve duong dan. */
function saveBuffer(buffer) {
  pruneOld();
  counter += 1;
  const filePath = path.join(pastedImagesDir(), `pasted-${Date.now()}-${counter}.png`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Luu anh clipboard hien tai ra file, tra ve { filePath, dataUrl } hoac null
 * neu clipboard khong co anh. Kem dataUrl de renderer hien khung xem truoc -
 * ban than terminal (PTY van ban thuan) khong the ve anh thuc.
 */
function pasteImageToFile() {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const buffer = image.toPNG();
  const filePath = saveBuffer(buffer);
  return { filePath, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
}

const SCREENSHOT_POLL_MS = 400;
const SCREENSHOT_TIMEOUT_MS = 45_000;

/**
 * Mo cong cu chup man hinh goc cua Windows (Win+Shift+S) roi cho anh moi xuat
 * hien trong clipboard he thong - Windows tu dong copy ket qua vao clipboard
 * ngay khi nguoi dung chon xong vung chup, khong co API rieng de "nhan" ket
 * qua nen phai doi (poll) va so sanh voi anh dang co san truoc do.
 *
 * Tra ve { filePath, dataUrl } khi phat hien anh moi, hoac null neu qua thoi
 * gian cho (nguoi dung bam Esc huy chup, hoac chon "Sao chep" mot noi dung
 * khac khong phai anh).
 */
function captureScreenshot() {
  const before = clipboard.readImage();
  const beforeBuffer = before.isEmpty() ? null : before.toPNG();

  shell.openExternal('ms-screenclip:');

  return new Promise((resolve) => {
    const deadline = Date.now() + SCREENSHOT_TIMEOUT_MS;

    const tick = () => {
      const current = clipboard.readImage();
      if (!current.isEmpty()) {
        const currentBuffer = current.toPNG();
        const isNew = !beforeBuffer || !currentBuffer.equals(beforeBuffer);
        if (isNew) {
          const filePath = saveBuffer(currentBuffer);
          resolve({ filePath, dataUrl: `data:image/png;base64,${currentBuffer.toString('base64')}` });
          return;
        }
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      setTimeout(tick, SCREENSHOT_POLL_MS);
    };

    setTimeout(tick, SCREENSHOT_POLL_MS);
  });
}

module.exports = { pasteImageToFile, captureScreenshot };
