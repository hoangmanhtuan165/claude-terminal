'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { parentPort } = require('node:worker_threads');
const parser = require('./transcript-parser');

/**
 * Worker lo hai viec nang cua lop lich su: dung cache noi dung va tim kiem.
 *
 * Ca hai deu doc hang tram MB nen phai nam ngoai tien trinh main, neu khong
 * giao dien se dung hinh moi lan quet.
 *
 * Co hai che do tim:
 * - 'cache': quet file cache rut gon. Nhanh, day la mac dinh.
 * - 'raw'  : quet thang transcript goc, tim duoc ca tham so va ket qua cong cu.
 *   Cham hon nhieu vi phai doc toan bo du lieu.
 */

const BATCH_SIZE = 25;
const SNIPPET_CONTEXT = 90;

const cancelled = new Set();

parentPort.on('message', (msg) => {
  const run =
    msg.type === 'search' ? runSearch : msg.type === 'buildCache' ? runBuildCache : null;

  if (msg.type === 'cancel') {
    cancelled.add(msg.requestId);
    return;
  }
  if (!run) return;

  run(msg).catch((err) => {
    parentPort.postMessage({
      type: 'error',
      requestId: msg.requestId,
      message: String(err?.stack || err),
    });
  });
});

// --- Dung cache ------------------------------------------------------------

/**
 * Rut gon mot phien thanh file chi con phan hoi thoai.
 *
 * Moi dong la mot message: r=vai tro, t=thoi diem, u=uuid, x=van ban,
 * s=1 neu den tu subagent hoac nhanh phu. Ten truong ngan vi file nay chi
 * may doc, va so message co the len toi hang chuc nghin.
 */
async function buildOneCache({ cachePath, sources }) {
  const tempPath = `${cachePath}.tmp`;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  const out = fs.createWriteStream(tempPath, { encoding: 'utf8' });
  let messageCount = 0;

  for (const source of sources) {
    let lines;
    try {
      lines = readline.createInterface({
        input: fs.createReadStream(source.path, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });
    } catch {
      continue;
    }

    try {
      for await (const line of lines) {
        const record = parser.parseLine(line);
        if (!record || !parser.isConversational(record)) continue;

        const raw = record.blocks
          .filter((block) => block.kind === 'text' || block.kind === 'thinking')
          .map((block) => block.text || '')
          .join('\n')
          .trim();

        // Bo nhieu harness ngay tu khi dung cache, neu khong ket qua tim kiem
        // se day cac doan trich toan the XML cua nhac nho he thong.
        const text = record.type === 'user' ? parser.cleanUserText(raw) : raw;
        if (!text) continue;

        const entry = { r: record.role || record.type, t: record.timestamp, u: record.uuid, x: text };
        if (record.isSidechain || source.isSubagent) entry.s = 1;

        if (!out.write(`${JSON.stringify(entry)}\n`)) {
          await new Promise((resolve) => out.once('drain', resolve));
        }
        messageCount += 1;
      }
    } catch {
      // File hong hoac bi khoa giua chung: giu phan da rut gon duoc.
    }
  }

  await new Promise((resolve, reject) => {
    out.end(() => resolve());
    out.on('error', reject);
  });

  // Doi ten la thao tac nguyen tu: file cache khong bao gio o trang thai do dang.
  fs.renameSync(tempPath, cachePath);
  return messageCount;
}

async function runBuildCache({ requestId, jobs }) {
  let built = 0;
  let messages = 0;

  for (const job of jobs) {
    if (cancelled.has(requestId)) break;
    try {
      messages += await buildOneCache(job);
      built += 1;
    } catch {
      // Mot phien khong rut gon duoc khong nen chan ca lan quet.
    }

    if (built % 5 === 0 || built === jobs.length) {
      parentPort.postMessage({ type: 'progress', requestId, processed: built, total: jobs.length });
    }
  }

  parentPort.postMessage({ type: 'done', requestId, built, messages, total: jobs.length });
  cancelled.delete(requestId);
}

// --- Tim kiem --------------------------------------------------------------

function buildMatcher({ query, useRegex, caseSensitive }) {
  const source = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(source, caseSensitive ? 'g' : 'gi');
}

function makeSnippet(text, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_CONTEXT);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();

  return {
    text: `${start > 0 ? '...' : ''}${snippet}${end < text.length ? '...' : ''}`,
    highlight: text.slice(matchIndex, matchIndex + matchLength),
  };
}

/**
 * Chuoi loc tho de sang dong truoc khi JSON.parse.
 *
 * Chi an toan khi tu khoa khong chua ky tu ma JSON bien doi luc ghi ra file:
 * dau nhay kep, dau cheo nguoc, ky tu dieu khien. Dau cach va ky tu co dau
 * deu khong sao vi JSON.stringify giu nguyen UTF-8.
 */
function buildPrefilter(query, useRegex, caseSensitive) {
  if (useRegex) return null;
  if (/["\\]/.test(query)) return null;
  if (/[\u0000-\u001f]/.test(query)) return null;
  return caseSensitive ? query : query.toLowerCase();
}

/** Lay van ban can do khop tu mot dong, tuy theo dang file dang quet. */
function extractSearchable(line, mode, { includeToolCalls, includeSidechain }) {
  if (mode === 'cache') {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return null;
    }
    if (entry.s && !includeSidechain) return null;
    return { text: entry.x || '', role: entry.r, timestamp: entry.t, uuid: entry.u, isSidechain: Boolean(entry.s) };
  }

  const record = parser.parseLine(line);
  if (!record || !parser.isConversational(record)) return null;
  if (record.isSidechain && !includeSidechain) return null;

  const blocks = includeToolCalls
    ? record.blocks
    : record.blocks.filter((b) => b.kind === 'text' || b.kind === 'thinking');
  if (blocks.length === 0) return null;

  return {
    text: blocks.map((b) => b.text || '').join('\n'),
    role: record.role || record.type,
    timestamp: record.timestamp,
    uuid: record.uuid,
    isSidechain: record.isSidechain,
  };
}

async function runSearch({ requestId, query, files, mode = 'cache', options = {} }) {
  const { includeToolCalls = false, includeSidechain = false, limit = 300 } = options;
  const caseSensitive = Boolean(options.caseSensitive);
  const useRegex = Boolean(options.useRegex);
  const prefilter = buildPrefilter(query, useRegex, caseSensitive);

  let matcher;
  try {
    matcher = buildMatcher({ query, useRegex, caseSensitive });
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      requestId,
      message: `Bieu thuc chinh quy khong hop le: ${err.message}`,
    });
    return;
  }

  let batch = [];
  let totalHits = 0;
  let scannedFiles = 0;
  let truncated = false;

  const flush = () => {
    if (batch.length === 0) return;
    parentPort.postMessage({ type: 'hits', requestId, hits: batch });
    batch = [];
  };

  for (const file of files) {
    if (cancelled.has(requestId)) break;
    if (totalHits >= limit) {
      truncated = true;
      break;
    }

    try {
      await scanFile({
        file,
        mode,
        matcher,
        prefilter,
        caseSensitive,
        includeToolCalls,
        includeSidechain,
        onHit: (hit) => {
          if (totalHits >= limit) return false;
          batch.push(hit);
          totalHits += 1;
          if (batch.length >= BATCH_SIZE) flush();
          return true;
        },
        isCancelled: () => cancelled.has(requestId),
      });
    } catch {
      // Cache co the chua duoc dung cho phien nay - bo qua, quet tiep.
    }

    scannedFiles += 1;
    if (scannedFiles % 20 === 0) {
      parentPort.postMessage({
        type: 'progress',
        requestId,
        scanned: scannedFiles,
        total: files.length,
      });
    }
  }

  flush();
  parentPort.postMessage({
    type: 'done',
    requestId,
    scanned: scannedFiles,
    total: files.length,
    totalHits,
    truncated,
    cancelled: cancelled.has(requestId),
  });
  cancelled.delete(requestId);
}

function scanFile({
  file,
  mode,
  matcher,
  prefilter,
  caseSensitive,
  includeToolCalls,
  includeSidechain,
  onHit,
  isCancelled,
}) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      lines.close();
      stream.destroy();
    };

    lines.on('line', (line) => {
      if (stopped) return;
      if (isCancelled()) return stop();

      // Dong khong chua tu khoa o dang van ban thi khong the sinh ket qua.
      if (prefilter) {
        const haystack = caseSensitive ? line : line.toLowerCase();
        if (!haystack.includes(prefilter)) return;
      }

      const found = extractSearchable(line, mode, { includeToolCalls, includeSidechain });
      if (!found || !found.text) return;

      matcher.lastIndex = 0;
      const match = matcher.exec(found.text);
      if (!match) return;

      const snippet = makeSnippet(found.text, match.index, match[0].length);
      const accepted = onHit({
        file,
        uuid: found.uuid,
        timestamp: found.timestamp,
        role: found.role,
        isSidechain: found.isSidechain,
        snippet: snippet.text,
        highlight: snippet.highlight,
      });
      if (!accepted) stop();
    });

    lines.on('close', resolve);
    stream.on('error', reject);
  });
}
