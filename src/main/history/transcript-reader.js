'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const parser = require('./transcript-parser');

/**
 * Doc mot transcript de hien thi trong khung xem hoi thoai.
 *
 * Doc theo luong chu khong `readFile`: transcript lon nhat tren may nay la
 * 220MB, nap ca file thanh mot chuoi JS se ngon khoang gap doi so do trong RAM
 * va lam dung tien trinh main. Doc theo dong cho phep dung han lai ngay khi du
 * so message can hien, nen chi phi khong con phu thuoc vao kich thuoc file.
 *
 * Van cat bot than cua nhung block qua dai (thuong la tool_result chua nguyen
 * noi dung file) truoc khi gui sang renderer.
 */

const MAX_MESSAGES = 3000;
const MAX_BLOCK_CHARS = 6000;

function truncateBlock(block) {
  const text = block.text || '';
  if (text.length <= MAX_BLOCK_CHARS) return { ...block, truncated: false };
  return {
    ...block,
    text: text.slice(0, MAX_BLOCK_CHARS),
    truncated: true,
    fullLength: text.length,
  };
}

/**
 * Chuan bi block de hien thi.
 *
 * Van ban cua nguoi dung phai qua buoc lam sach truoc: message `type: 'user'`
 * thuong chua nhac nho he thong va output slash command do harness chen vao,
 * de nguyen se lam khung xem day the XML vo nghia.
 */
function prepareBlocks(record) {
  const isUser = record.type === 'user';

  return record.blocks
    .map((block) => {
      if (!isUser || block.kind !== 'text') return block;
      const cleaned = parser.cleanUserText(block.text || '');
      return cleaned ? { ...block, text: cleaned } : null;
    })
    .filter(Boolean)
    .map(truncateBlock);
}

function readTranscript(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    const messages = [];
    const meta = { sessionId: null, cwd: null, slug: null, version: null, gitBranch: null };
    let reachedLimit = false;
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      lines.close();
      stream.destroy();
    };

    lines.on('line', (line) => {
      if (stopped) return;

      const record = parser.parseLine(line);
      if (!record) return;

      if (!meta.sessionId && record.sessionId) meta.sessionId = record.sessionId;
      if (!meta.cwd && record.cwd) meta.cwd = record.cwd;
      if (!meta.slug && record.slug) meta.slug = record.slug;
      if (!meta.version && record.version) meta.version = record.version;
      if (!meta.gitBranch && record.gitBranch) meta.gitBranch = record.gitBranch;

      if (!parser.isConversational(record) || record.blocks.length === 0) return;

      const blocks = prepareBlocks(record);
      // Message chi gom nhieu cua harness thi khong con gi de hien.
      if (blocks.length === 0) return;

      messages.push({
        uuid: record.uuid,
        timestamp: record.timestamp,
        type: record.type,
        role: record.role,
        model: record.model,
        isSidechain: record.isSidechain,
        isUserPrompt: parser.isUserPrompt(record),
        blocks,
      });

      if (messages.length >= MAX_MESSAGES) {
        // Khong doc tiep de dem chinh xac phan con lai: voi file hang tram MB
        // chi rieng viec doc het da mat vai giay ma khong doi duoc gi.
        reachedLimit = true;
        stop();
      }
    });

    lines.on('close', () => resolve({ meta, messages, reachedLimit }));
    stream.on('error', reject);
  });
}

module.exports = { readTranscript };
