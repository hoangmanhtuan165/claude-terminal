'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { clipboard } = require('electron');
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

/** Luu anh clipboard hien tai ra file, tra ve duong dan hoac null neu clipboard khong co anh. */
function pasteImageToFile() {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;

  pruneOld();

  counter += 1;
  const filePath = path.join(pastedImagesDir(), `pasted-${Date.now()}-${counter}.png`);
  fs.writeFileSync(filePath, image.toPNG());
  return filePath;
}

module.exports = { pasteImageToFile };
