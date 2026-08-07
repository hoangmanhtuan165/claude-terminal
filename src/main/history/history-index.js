'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { claudeProjectsDir, historyIndexPath } = require('../app-paths');
const { readJson, writeJson } = require('../storage/json-store');
const parser = require('./transcript-parser');
const contentCache = require('./content-cache');

/**
 * Xay va cache metadata cua toan bo transcript Claude Code.
 *
 * Vi sao chi doc mot phan file: may nay dang co ~500 transcript, file lon nhat
 * hon 6MB. Doc het de dem so message se ton hang tram MB I/O moi lan mo app.
 * Toan bo metadata can thiet (cwd, slug, prompt dau tien, moc thoi gian) deu
 * nam o dau va cuoi file, nen chi doc hai dau la du.
 */

// Tang so nay khi cau truc metadata doi. Chi metadata bi doc lai (nhanh, chi
// doc dau/cuoi moi file); cache noi dung khong bi anh huong.
const INDEX_VERSION = 4;
const HEAD_BYTES = 192 * 1024;
const TAIL_BYTES = 64 * 1024;

/** Doc mot doan byte tai vi tri bat ky, tra ve chuoi utf8. */
async function readChunk(filePath, start, length) {
  if (length <= 0) return '';
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle?.close();
  }
}

/**
 * Tim transcript cua cac subagent thuoc mot phien.
 *
 * Claude Code de chung o <thu-muc-du-an>/<session-id>/subagents/agent-*.jsonl.
 * Day la file rieng, khong phai dong nam trong transcript chinh, nen neu khong
 * gom lai o day thi cong viec subagent da lam se nam ngoai tam tim kiem.
 */
async function findSubagentFiles(filePath) {
  const sessionId = path.basename(filePath, '.jsonl');
  const subagentDir = path.join(path.dirname(filePath), sessionId, 'subagents');

  try {
    const entries = await fs.readdir(subagentDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(subagentDir, entry.name));
  } catch {
    // Phan lon phien khong dung subagent nen khong co thu muc nay.
    return [];
  }
}

/**
 * Doc metadata cua mot transcript.
 * Dong dau/cuoi cua moi doan co the bi cat ngang, parser tu bo qua dong hong.
 */
async function extractMetadata(filePath, stat) {
  const headLength = Math.min(HEAD_BYTES, stat.size);
  const head = await readChunk(filePath, 0, headLength);

  const meta = {
    sessionId: path.basename(filePath, '.jsonl'),
    filePath,
    cwd: null,
    slug: null,
    version: null,
    gitBranch: null,
    title: '',
    startedAt: null,
    endedAt: null,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  };

  for (const line of head.split('\n')) {
    const record = parser.parseLine(line);
    if (!record) continue;

    // cwd la nguon su that de biet phien chay o thu muc nao. Ten thu muc trong
    // .claude/projects da ma hoa mat mat (ky tu co dau bi thay bang '-') nen
    // khong the giai ma nguoc.
    if (!meta.cwd && record.cwd) meta.cwd = record.cwd;
    if (!meta.slug && record.slug) meta.slug = record.slug;
    if (!meta.version && record.version) meta.version = record.version;
    if (!meta.gitBranch && record.gitBranch) meta.gitBranch = record.gitBranch;
    if (!meta.startedAt && record.timestamp) meta.startedAt = record.timestamp;

    if (!meta.title && parser.isUserPrompt(record)) {
      const text = parser.userPromptText(record);
      // Uu tien cau thuc chat; chi giu slash command lam phuong an cuoi.
      if (parser.isMeaningfulTitle(text)) meta.title = parser.toTitle(text);
      else if (!meta.fallbackTitle && text) meta.fallbackTitle = parser.toTitle(text);
    }
  }

  const tailStart = Math.max(headLength, stat.size - TAIL_BYTES);
  const tail = await readChunk(filePath, tailStart, stat.size - tailStart);
  for (const line of tail.split('\n')) {
    const record = parser.parseLine(line);
    if (record?.timestamp) meta.endedAt = record.timestamp;
  }

  if (!meta.endedAt) meta.endedAt = meta.startedAt || new Date(stat.mtimeMs).toISOString();
  if (!meta.title) meta.title = meta.fallbackTitle || meta.slug || NO_PROMPT_TITLE;
  delete meta.fallbackTitle;

  meta.subagentFiles = await findSubagentFiles(filePath);

  return meta;
}

const NO_PROMPT_TITLE = '(phiên không có prompt)';

/**
 * Tieu de nay co dang tim lai trong cache khong?
 *
 * Gom ba truong hop: chi la slash command, khong tim thay prompt nao trong
 * doan dau file, hoac dang phai dung tam ten slug tu sinh.
 */
function needsBetterTitle(session) {
  const title = String(session.title || '');
  if (title === NO_PROMPT_TITLE) return true;
  if (session.slug && title === session.slug) return true;
  return !parser.isMeaningfulTitle(title);
}

async function listTranscriptFiles() {
  let projectDirs;
  try {
    projectDirs = await fs.readdir(claudeProjectsDir, { withFileTypes: true });
  } catch {
    // Chua tung chay claude, hoac CLAUDE_CONFIG_DIR tro sang cho khac.
    return [];
  }

  const files = [];
  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(claudeProjectsDir, dirent.name);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(dir, entry.name));
      }
    }
  }
  return files;
}

function loadCache() {
  const cached = readJson(historyIndexPath(), null);
  if (!cached || cached.version !== INDEX_VERSION || !cached.sessions) {
    return { version: INDEX_VERSION, sessions: {} };
  }
  return cached;
}

/**
 * Quet lai thu muc transcript, chi doc lai nhung file da doi (mtime hoac size).
 *
 * Gom hai giai doan:
 * 1. Metadata - chi doc dau va cuoi moi file, rat nhanh.
 * 2. Cache noi dung - doc day du nhung phien da thay doi, chay trong worker.
 *
 * `onProgress` nhan them truong `phase` de renderer noi ro dang o buoc nao;
 * lan chay dau tren toan bo transcript mat vai chuc giay.
 */
async function refresh({ onProgress } = {}) {
  const cache = loadCache();
  const files = await listTranscriptFiles();
  const nextSessions = {};
  const staleSessions = [];

  let processed = 0;

  for (const filePath of files) {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      continue;
    }

    const cachedEntry = cache.sessions[filePath];
    const unchanged =
      cachedEntry && cachedEntry.mtimeMs === stat.mtimeMs && cachedEntry.sizeBytes === stat.size;

    let meta = null;
    if (unchanged) {
      meta = cachedEntry;
    } else {
      try {
        meta = await extractMetadata(filePath, stat);
      } catch {
        // File dang bi khoa hoac vua bi xoa - bo qua o lan quet nay.
      }
    }

    if (meta) {
      nextSessions[filePath] = meta;
      // Cache noi dung co so hop le rieng, khong theo phien ban chi muc: doi
      // cach dat tieu de khong keo theo viec rut gon lai ca 1,74GB.
      if (!contentCache.isFresh(meta)) staleSessions.push(meta);
    }

    processed += 1;
    if (onProgress && processed % 25 === 0) {
      onProgress({ phase: 'metadata', processed, total: files.length });
    }
  }

  writeJson(historyIndexPath(), { version: INDEX_VERSION, sessions: nextSessions });

  const allSessions = Object.values(nextSessions);
  contentCache.pruneOrphans(allSessions.map((s) => s.sessionId));

  const cacheResult = await contentCache.build(staleSessions, {
    onProgress: (progress) =>
      onProgress?.({ phase: 'content', processed: progress.processed, total: progress.total }),
  });

  // Voi phien chua co tieu de tu te, tim tiep trong cache: cache da loc san
  // chi con hoi thoai nen prompt thuc chat nam ngay dau, du no nam rat sau
  // trong file goc.
  let improvedTitles = 0;
  for (const session of allSessions) {
    if (!needsBetterTitle(session)) continue;
    const better = contentCache.readTitle(session.sessionId, parser.isMeaningfulTitle);
    if (better) {
      session.title = parser.toTitle(better);
      improvedTitles += 1;
    }
  }
  if (improvedTitles > 0) {
    writeJson(historyIndexPath(), { version: INDEX_VERSION, sessions: nextSessions });
  }

  if (onProgress) {
    onProgress({ phase: 'done', processed: files.length, total: files.length });
  }

  return {
    total: files.length,
    rescanned: staleSessions.length,
    cachedMessages: cacheResult.messages || 0,
  };
}

/** Danh sach phien, moi nhat truoc. */
function listSessions() {
  const cache = loadCache();
  return Object.values(cache.sessions).sort((a, b) =>
    String(b.endedAt || '').localeCompare(String(a.endedAt || '')),
  );
}

/** Gom phien theo thu muc lam viec, dung cho sidebar du an. */
function listProjects() {
  const byCwd = new Map();

  for (const session of listSessions()) {
    const cwd = session.cwd || '(không rõ thư mục)';
    let project = byCwd.get(cwd);
    if (!project) {
      // 80 du an, moi existsSync duoi 0.1ms - do that tren may thi tong chua
      // toi 3ms, khong dang phai lam bat dong bo. Du an "khong ro thu muc" thi
      // khong co gi de kiem, coi la con ton tai de khoi bao nham.
      const exists = cwd === '(không rõ thư mục)' || fsSync.existsSync(cwd);
      project = {
        cwd,
        name: path.basename(cwd) || cwd,
        sessionCount: 0,
        lastUsedAt: null,
        exists,
      };
      byCwd.set(cwd, project);
    }
    project.sessionCount += 1;
    if (!project.lastUsedAt || String(session.endedAt) > String(project.lastUsedAt)) {
      project.lastUsedAt = session.endedAt;
    }
  }

  return [...byCwd.values()].sort((a, b) =>
    String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')),
  );
}

function findSession(sessionId) {
  return listSessions().find((session) => session.sessionId === sessionId) || null;
}

module.exports = { refresh, listSessions, listProjects, findSession };
