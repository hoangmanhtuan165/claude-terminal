'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { claudeProjectsDir } = require('../app-paths');

/**
 * So lieu doc thang tu file transcript duoi may: % context window cua phien
 * dang chay, va token/chi phi cua hom nay.
 *
 * Khac han usage-limits.js: khong goi mang, khong dinh gioi han tan suat, nen
 * cap nhat duoc thuong xuyen. Rut gon tu `check use` (lib/context-usage.js,
 * lib/aggregate.js, lib/pricing.js) cua nguoi dung.
 */

/** Cua so context tieu chuan. Co the vuot 100% voi phien dung cache dai. */
const CONTEXT_WINDOW = 200000;

/** Don gia USD tren 1 trieu token. Khop theo tien to de chiu duoc hau to ngay. */
const PRICES = {
  'claude-opus-4': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-5': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-fable-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-3-5-haiku': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
};

/** Model la thi uoc tinh theo bac Sonnet. */
const DEFAULT_PRICE = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };

function priceFor(model) {
  if (!model || model === '<synthetic>') return null;
  if (PRICES[model]) return PRICES[model];

  let best = null;
  for (const key of Object.keys(PRICES)) {
    if (model.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return best ? PRICES[best] : DEFAULT_PRICE;
}

function costOf(model, usage) {
  const price = priceFor(model);
  if (!price) return 0;
  const M = 1_000_000;
  return (
    ((usage.input_tokens || 0) / M) * price.input +
    ((usage.output_tokens || 0) / M) * price.output +
    ((usage.cache_creation_input_tokens || 0) / M) * price.cacheWrite +
    ((usage.cache_read_input_tokens || 0) / M) * price.cacheRead
  );
}

/** Duyet mot lan qua thu muc transcript, tra ve danh sach file kem mtime. */
function listTranscripts() {
  const files = [];
  let dirs;
  try {
    dirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(claudeProjectsDir, dirent.name);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const filePath = path.join(dir, name);
      try {
        const stat = fs.statSync(filePath);
        files.push({
          filePath,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          project: dirent.name,
        });
      } catch {
        // File vua bi xoa giua chung - bo qua.
      }
    }
  }
  return files;
}

/**
 * Doc phan duoi cua mot file, toi da `maxBytes`.
 *
 * VI SAO KHONG DOC CA FILE: transcript o day co file toi 220MB, doc tron ven
 * mat gan 3 giay va khoa ca tien trinh main. Message can tim luon nam o cuoi,
 * nen chi can phan duoi la du. Dong dau tien co the bi cat ngang - ham goi phai
 * bo qua dong hong (deu dung try/catch khi JSON.parse).
 */
async function readTail(filePath, maxBytes) {
  let handle;
  try {
    handle = await fsp.open(filePath, 'r');
    const { size } = await handle.stat();
    const length = Math.min(maxBytes, size);
    const start = size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer.toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close();
  }
}

/** Doan duoi du de chua vai luot hoi dap gan nhat. */
const CONTEXT_TAIL_BYTES = 512 * 1024;

/**
 * Doan duoi cho phan tinh chi phi.
 *
 * Phai rong that: mot phien lam viec ca ngay tren may nay len toi hang tram MB,
 * cat ngan qua se bo sot message va bao chi phi thap hon thuc te (do thu 8MB
 * thi mat gan mot nua so lieu - con so sai nhu vay con te hon la khong hien).
 * 256MB phu duoc file lon nhat dang co (220MB), va van nhanh vi chi doc nhung
 * file duoc sua trong ngay.
 */
const TODAY_TAIL_BYTES = 256 * 1024 * 1024;

/**
 * Context cua phien dang chay = token nap vao luot gan nhat cua file moi nhat.
 * Doc nguoc tu cuoi file de khoi phai parse ca file lon.
 */
async function readContext(files) {
  let latest = null;
  for (const file of files) {
    if (!latest || file.mtimeMs > latest.mtimeMs) latest = file;
  }
  if (!latest) return null;

  const content = await readTail(latest.filePath, CONTEXT_TAIL_BYTES);
  if (!content) return null;

  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"type":"assistant"')) continue;
    try {
      const record = JSON.parse(line);
      const usage = record?.message?.usage;
      if (!usage) continue;

      const tokens =
        (usage.input_tokens || 0) +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0);

      return {
        tokens,
        window: CONTEXT_WINDOW,
        pct: (tokens / CONTEXT_WINDOW) * 100,
        model: record.message.model || null,
        ageMs: Date.now() - latest.mtimeMs,
      };
    } catch {
      // Dong hong - thu dong truoc do.
    }
  }
  return null;
}

/**
 * Token va chi phi cua hom nay.
 *
 * Chi doc nhung file duoc sua trong ngay: quet toan bo ~1,8GB transcript moi
 * lan hoi se lam treo giao dien, ma file cu thi khong the chua message hom nay.
 */
async function readToday(files) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startMs = startOfDay.getTime();

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let cost = 0;
  let messages = 0;
  // Bao cho giao dien biet con so co the thieu (file qua dai, chi doc phan duoi).
  let truncated = false;

  for (const file of files) {
    if (file.mtimeMs < startMs) continue;

    if (file.sizeBytes > TODAY_TAIL_BYTES) truncated = true;
    const content = await readTail(file.filePath, TODAY_TAIL_BYTES);
    if (!content) continue;

    for (const line of content.split('\n')) {
      if (!line || !line.includes('"type":"assistant"')) continue;
      try {
        const record = JSON.parse(line);
        const usage = record?.message?.usage;
        if (!usage || !record.timestamp) continue;
        if (new Date(record.timestamp).getTime() < startMs) continue;

        inputTokens += usage.input_tokens || 0;
        outputTokens += usage.output_tokens || 0;
        cacheTokens +=
          (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
        cost += costOf(record.message.model, usage);
        messages += 1;
      } catch {
        // Dong hong - bo qua.
      }
    }
  }

  return {
    inputTokens,
    outputTokens,
    cacheTokens,
    totalTokens: inputTokens + outputTokens + cacheTokens,
    costUsd: cost,
    messages,
    truncated,
  };
}

/*
 * Hai so lieu nay co gia rat khac nhau nen cache rieng:
 *
 *   context - chi doc 512KB cuoi mot file, vai chuc ms, doi lien tuc theo tung
 *             luot chat nen phai tuoi.
 *   today   - phai quet moi file duoc sua trong ngay (co hom len toi 2,3 giay
 *             tren may nay). Doi cham va khong ai nhin tung giay, nen tinh
 *             thua ra roi dung lai.
 *
 * Gop chung mot cache se keo phan nhanh xuong theo phan cham - giao dien cho
 * 2 giay chi de biet % context.
 */
const CONTEXT_CACHE_MS = 5 * 1000;
const TODAY_CACHE_MS = 5 * 60 * 1000;

let contextCache = null;
let contextAt = 0;
let contextInFlight = null;

let todayCache = null;
let todayAt = 0;
let todayInFlight = null;

async function getContext({ force = false } = {}) {
  if (contextCache && !force && Date.now() - contextAt < CONTEXT_CACHE_MS) return contextCache;
  if (contextInFlight) return contextInFlight;

  contextInFlight = (async () => {
    try {
      contextCache = await readContext(listTranscripts());
      contextAt = Date.now();
      return contextCache;
    } finally {
      contextInFlight = null;
    }
  })();

  return contextInFlight;
}

async function getToday({ force = false } = {}) {
  if (todayCache && !force && Date.now() - todayAt < TODAY_CACHE_MS) return todayCache;
  if (todayInFlight) return todayInFlight;

  todayInFlight = (async () => {
    try {
      todayCache = await readToday(listTranscripts());
      todayAt = Date.now();
      return todayCache;
    } finally {
      todayInFlight = null;
    }
  })();

  return todayInFlight;
}

/**
 * Tra ve ngay context (nhanh), con chi phi thi chi tra neu da tinh san.
 * Nho vay giao dien khong bao gio phai cho vai giay chi de ve thanh context.
 */
async function get({ force = false } = {}) {
  const context = await getContext({ force });

  // Chi phi tinh nen; lan dau chua co thi tra null, lan hoi sau se co.
  if (!todayCache || Date.now() - todayAt >= TODAY_CACHE_MS) {
    getToday({ force }).catch(() => {});
  }

  return { context, today: todayCache };
}

module.exports = { get, getContext, getToday, CONTEXT_WINDOW };
