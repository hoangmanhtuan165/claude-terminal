'use strict';

const fs = require('node:fs');
const historyIndex = require('./history-index');
const contentCache = require('./content-cache');
const workerClient = require('./history-worker-client');

/**
 * Tim kiem trong lich su, tren hai muc do:
 *
 * - Nhanh (mac dinh): quet cache noi dung da rut gon. Chi vai chuc MB.
 * - Sau  : quet thang transcript goc de tim duoc ca tham so va ket qua cong cu.
 *   Doc gan 2GB nen cham hon han; chi dung khi nguoi dung chu dong bat.
 */

function filterSessions({ cwdFilter, sessionIdFilter }) {
  let sessions = historyIndex.listSessions();

  if (sessionIdFilter) {
    return sessions.filter((s) => s.sessionId === sessionIdFilter);
  }
  if (cwdFilter) {
    const target = String(cwdFilter).toLowerCase();
    return sessions.filter((s) => String(s.cwd || '').toLowerCase() === target);
  }
  return sessions;
}

/**
 * Chon file can quet va lap ban do file -> phien.
 *
 * Che do sau gom ca transcript cua subagent, vi do la file rieng nam ngoai
 * transcript chinh.
 */
function resolveTargets(params) {
  const sessions = filterSessions(params);
  const deep = Boolean(params.includeToolCalls);

  const files = [];
  const owners = new Map();

  for (const session of sessions) {
    if (deep) {
      files.push(session.filePath);
      owners.set(session.filePath, session);

      if (params.includeSidechain) {
        for (const subagentFile of session.subagentFiles || []) {
          files.push(subagentFile);
          owners.set(subagentFile, session);
        }
      }
    } else {
      const cachePath = contentCache.cachePathFor(session.sessionId);
      // Phien vua tao co the chua kip co cache; bo qua thay vi bao loi.
      if (!fs.existsSync(cachePath)) continue;
      files.push(cachePath);
      owners.set(cachePath, session);
    }
  }

  return { files, owners, mode: deep ? 'raw' : 'cache' };
}

function search(params, handlers) {
  const { files, owners, mode } = resolveTargets(params);

  if (files.length === 0) {
    handlers.onDone?.({ scanned: 0, total: 0, totalHits: 0, truncated: false });
    return null;
  }

  return workerClient.post(
    'search',
    {
      type: 'search',
      query: params.query,
      files,
      mode,
      options: {
        useRegex: params.useRegex,
        caseSensitive: params.caseSensitive,
        includeToolCalls: params.includeToolCalls,
        includeSidechain: params.includeSidechain,
        limit: params.limit,
      },
    },
    {
      ...handlers,
      // Worker chi biet duong dan file; gan lai thong tin phien o day de
      // renderer co san tieu de va thu muc ma hien.
      decorateHits: (hits) =>
        hits.map((hit) => {
          const session = owners.get(hit.file);
          if (!session) return hit;
          return { ...hit, sessionId: session.sessionId, cwd: session.cwd };
        }),
    },
  );
}

module.exports = { search, cancel: workerClient.cancel, shutdown: workerClient.shutdown };
