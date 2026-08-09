'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { claudeProjectsDir, historyIndexPath } = require('../app-paths');
const { readJson, writeJson } = require('../storage/json-store');
const parser = require('./transcript-parser');
const contentCache = require('./content-cache');
const { costOf } = require('../usage/usage-local');

/**
 * Xay va cache metadata cua toan bo transcript Claude Code.
 *
 * Vi sao chi doc mot phan file: may nay dang co ~500 transcript, file lon nhat
 * hon 6MB. Doc het de dem so message se ton hang tram MB I/O moi lan mo app.
 * Toan bo metadata can thiet (cwd, slug, prompt dau tien, moc thoi gian) deu
 * nam o dau va cuoi file, nen chi doc hai dau la du.
 */

// Tang so nay khi cau truc metadata doi. Chi metadata bi doc lai (nhanh, chi
// doc dau/cuoi moi file, tru totalTokens/costUsd/hasError phai doc ca file -
// xem sumUsage); cache noi dung khong bi anh huong.
const INDEX_VERSION = 6;
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
 * Cong don token/chi phi cua ca phien - PHAI doc toan bo file (khac voi
 * extractMetadata chi doc dau/cuoi), vi usage nam rai rac o moi luot tra loi
 * chu khong chi dau/cuoi. Doc theo dong qua stream de khong nap ca file (co
 * phien toi 220MB) vao bo nho.
 *
 * Tien the phat hien "phien co loi" (tool_result.is_error) trong cung mot
 * luot doc - them mot lan quet rieng cho ca file se ton gap doi I/O vo ich.
 *
 * Ton chi phi hon cac truong metadata khac, nhung chi chay khi phien MOI hoac
 * thay doi (xem cho goi trong extractMetadata/refresh) - sau do ket qua duoc
 * cache vinh vien trong history-index.json giong moi truong khac.
 */
function sumUsage(filePath) {
  return new Promise((resolve) => {
    let totalTokens = 0;
    let costUsd = 0;
    let hasError = false;

    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      if (!hasError && line.includes('"is_error":true')) hasError = true;
      if (!line.includes('"type":"assistant"')) return;
      try {
        const record = JSON.parse(line);
        const usage = record?.message?.usage;
        if (!usage) return;
        totalTokens +=
          (usage.input_tokens || 0) +
          (usage.output_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) +
          (usage.cache_read_input_tokens || 0);
        costUsd += costOf(record.message.model, usage);
      } catch {
        // Dong hong - bo qua.
      }
    });

    rl.on('close', () => resolve({ totalTokens, costUsd, hasError }));
    stream.on('error', () => resolve({ totalTokens, costUsd, hasError }));
  });
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

  const usage = await sumUsage(filePath);
  meta.totalTokens = usage.totalTokens;
  meta.costUsd = usage.costUsd;
  meta.hasError = usage.hasError;

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

/**
 * Gom phien theo thu muc lam viec, dung cho sidebar du an.
 *
 * Key gom nhom phai la cwd DA HA CHU, khong phai cwd goc: o dia Windows khong
 * phan biet hoa/thuong (`F:\...` va `f:\...` la cung mot thu muc), nhung Claude
 * Code ghi lai cwd nguyen van tung lan goi - hai lan chay cung du an co the ra
 * hai chuoi khac nhau chi vi chu hoa/thuong o dia, tach dinh mot du an thanh
 * hai dong rieng trong sidebar (do duoc tren du lieu that: sheet.com.vn bi
 * tach thanh 403 + 248 prompt). Van giu nguyen cwd GOC (khong ha chu) de hien
 * thi/mo thu muc - cac cho loc theo cwd khac da tu ha chu ca hai ve khi so
 * sanh nen khong bi anh huong.
 */
function listProjects() {
  const byCwd = new Map();

  for (const session of listSessions()) {
    const cwd = session.cwd || '(không rõ thư mục)';
    const key = cwd.toLowerCase();
    let project = byCwd.get(key);
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
        // listSessions() tra ve moi nhat truoc, nen phien dau tien gap cho moi
        // cwd chinh la phien gan nhat - dung de sidebar "no tiep" thang.
        lastSessionId: session.sessionId,
        exists,
        totalTokens: 0,
        costUsd: 0,
      };
      byCwd.set(key, project);
    }
    project.sessionCount += 1;
    if (!project.lastUsedAt || String(session.endedAt) > String(project.lastUsedAt)) {
      project.lastUsedAt = session.endedAt;
    }
    project.totalTokens += session.totalTokens || 0;
    project.costUsd += session.costUsd || 0;
  }

  return [...byCwd.values()].sort((a, b) =>
    String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')),
  );
}

function findSession(sessionId) {
  return listSessions().find((session) => session.sessionId === sessionId) || null;
}

/**
 * Dung luong tong toan bo transcript da index - cong don `sizeBytes` da co
 * san trong cache, khong doc lai dia. Dung de canh bao khi thu muc lich su
 * phinh to (xem history-panel.js).
 */
function getStorageStats() {
  const sessions = listSessions();
  const totalBytes = sessions.reduce((sum, s) => sum + (s.sizeBytes || 0), 0);
  const largest = sessions.reduce((max, s) => Math.max(max, s.sizeBytes || 0), 0);
  return { totalBytes, sessionCount: sessions.length, largestBytes: largest };
}

/**
 * Cac phien CU NHAT (theo endedAt) se bi xoa neu bam "Xoa bot" - chi de
 * XEM TRUOC (khong xoa gi ca), dung cho hop thoai xac nhan hien du bao nhieu
 * phien/dung luong se mat truoc khi nguoi dung dong y that.
 *
 * `targetFreeBytes`: muon giai phong toi thieu bao nhieu byte - gom du phien cu
 * nhat cho toi khi tong dung luong cua chung dat nguong nay.
 */
function previewOldestSessions(targetFreeBytes) {
  const sessions = [...listSessions()].sort((a, b) =>
    String(a.endedAt || '').localeCompare(String(b.endedAt || '')),
  );

  const picked = [];
  let freed = 0;
  for (const session of sessions) {
    if (freed >= targetFreeBytes) break;
    picked.push(session);
    freed += session.sizeBytes || 0;
  }
  return { sessions: picked, freedBytes: freed };
}

/**
 * Xoa hang loat cac phien CU NHAT cho toi khi giai phong du `targetFreeBytes`.
 * Xoa that su tren dia: file .jsonl goc + thu muc subagent di kem - KHONG THE
 * HOAN TAC. Loi goi phai tu xac nhan voi nguoi dung truoc (xem previewOldestSessions).
 *
 * Sau khi xoa, ghi lai index tu bo nho (khong doc lai dia) de tranh mot vong
 * quet day; contentCache.pruneOrphans() don not cache thua tuong ung.
 */
function deleteOldestSessions(targetFreeBytes) {
  const { sessions: toDelete } = previewOldestSessions(targetFreeBytes);
  const cache = loadCache();
  let deletedCount = 0;
  let freedBytes = 0;

  for (const session of toDelete) {
    try {
      fsSync.unlinkSync(session.filePath);
    } catch {
      continue; // File da mat hoac dang khoa - bo qua, khong tinh vao da xoa.
    }

    // Thu muc subagent nam canh file .jsonl: <thu-muc>/<session-id>/subagents/.
    const sessionDir = path.join(path.dirname(session.filePath), session.sessionId);
    try {
      fsSync.rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // Khong co thu muc subagent - binh thuong, phan lon phien khong dung.
    }

    delete cache.sessions[session.filePath];
    deletedCount += 1;
    freedBytes += session.sizeBytes || 0;
  }

  writeJson(historyIndexPath(), { version: INDEX_VERSION, sessions: cache.sessions });
  contentCache.pruneOrphans(Object.values(cache.sessions).map((s) => s.sessionId));

  return { deletedCount, freedBytes };
}

/**
 * Tong hop so lieu cho man hinh Thong ke - tat ca deu suy tu du lieu da co
 * san trong cache (sessions/projects), khong doc them dia.
 */
function getUsageStats() {
  const sessions = listSessions();
  const projects = listProjects();

  let totalTokens = 0;
  let totalCostUsd = 0;
  let errorSessions = 0;
  const byDay = new Map(); // 'YYYY-MM-DD' -> { tokens, costUsd, sessionCount }

  for (const session of sessions) {
    totalTokens += session.totalTokens || 0;
    totalCostUsd += session.costUsd || 0;
    if (session.hasError) errorSessions += 1;

    const day = String(session.endedAt || '').slice(0, 10);
    if (!day) continue;
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = { day, tokens: 0, costUsd: 0, sessionCount: 0 };
      byDay.set(day, bucket);
    }
    bucket.tokens += session.totalTokens || 0;
    bucket.costUsd += session.costUsd || 0;
    bucket.sessionCount += 1;
  }

  // 30 ngay gan nhat, sap theo ngay tang dan de ve bieu do tu trai qua phai.
  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);

  const topProjects = [...projects]
    .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
    .slice(0, 10)
    .map((p) => ({ name: p.name, cwd: p.cwd, totalTokens: p.totalTokens, costUsd: p.costUsd, sessionCount: p.sessionCount }));

  return {
    sessionCount: sessions.length,
    projectCount: projects.length,
    totalTokens,
    totalCostUsd,
    errorSessions,
    daily,
    topProjects,
  };
}

module.exports = {
  refresh,
  listSessions,
  listProjects,
  findSession,
  getStorageStats,
  getUsageStats,
  previewOldestSessions,
  deleteOldestSessions,
};
