'use strict';

const { readJson } = require('../storage/json-store');
const { credentialsPath } = require('../storage/account-status');

/**
 * Han muc goi theo thoi gian thuc, lay tu API OAuth cua Anthropic.
 *
 * So lieu nay KHONG co trong file .jsonl duoi may - phai goi endpoint that,
 * dung chinh `accessToken` ma Claude Code da luu khi dang nhap. Day la cach
 * tab Settings > Usage tren claude.ai lay so.
 *
 * Rut gon tu cong cu `check use` cua nguoi dung (F:\claude\check use), viet lai
 * de:
 *   - doc credentials theo `claudeConfigDir` cua app, nho vay ton trong ho so
 *     tai khoan dang chon (xem account-profiles.js) thay vi luon lay ~/.claude
 *   - token khong bao gio roi khoi tien trinh main
 *
 * VI SAO PHAI GIAN NHIP GOI: endpoint nay co gioi han tan suat, goi day se tra
 * 429. Vi vay co cache theo thoi gian, va khi loi thi giu lai so cu (danh dau
 * `stale`) thay vi xoa trang man hinh.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const FETCH_TIMEOUT_MS = 10000;

/** Khong goi lai som hon khoang nay, du giao dien co hoi bao nhieu lan. */
const MIN_REFETCH_MS = 60 * 1000;

let cached = null;
let cachedAt = 0;
let inFlight = null;

function readAccessToken() {
  const cred = readJson(credentialsPath(), null);
  const oauth = cred?.claudeAiOauth;
  if (!oauth?.accessToken) return null;
  return {
    token: oauth.accessToken,
    expired: oauth.expiresAt ? oauth.expiresAt < Date.now() : false,
  };
}

async function fetchUsage(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-cli/2.1.154',
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      const error = new Error('Bị giới hạn tần suất, thử lại sau ít phút');
      error.rateLimited = true;
      throw error;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (err) {
    if (controller.signal.aborted) throw new Error('Hết thời gian chờ khi gọi API');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Chuan hoa mot muc han muc { utilization, resets_at } cua API. */
function normalize(entry) {
  if (!entry || typeof entry.utilization !== 'number') return null;
  return {
    pct: entry.utilization,
    resetsAt: entry.resets_at || null,
  };
}

/**
 * Han muc hien tai. `force` bo qua cache thoi gian (nut bam tay).
 * Luon tra ve object, khong bao gio nem loi ra ngoai - giao dien can hien duoc
 * ca luc that bai.
 */
async function get({ force = false } = {}) {
  const fresh = Date.now() - cachedAt < MIN_REFETCH_MS;
  if (cached && fresh && !force) return cached;

  // Nhieu cho cung hoi mot luc (thanh trang thai + menu) thi chi goi mang mot lan.
  if (inFlight) return inFlight;

  // `finally` phai bao TRON ca cac nhanh thoat som, neu khong `inFlight` se ket
  // lai mai va moi lan hoi sau deu nhan promise cu.
  inFlight = (async () => {
    try {
      const cred = readAccessToken();
      if (!cred) return { available: false, error: 'Chưa đăng nhập Claude Code' };

      if (cred.expired) {
        // Token het han thi Claude Code se tu lam moi o lan chay ke tiep; giu
        // so cu de giao dien khong nhay ve trong.
        if (cached) return { ...cached, stale: true, staleReason: 'Token đã hết hạn' };
        return { available: false, error: 'Token đã hết hạn — mở một phiên Claude để làm mới' };
      }

      const usage = await fetchUsage(cred.token);
      cached = {
        available: true,
        session: normalize(usage.five_hour),
        weekly: normalize(usage.seven_day),
        weeklySonnet: normalize(usage.seven_day_sonnet),
        weeklyOpus: normalize(usage.seven_day_opus),
        stale: false,
        fetchedAt: Date.now(),
      };
      cachedAt = Date.now();
      return cached;
    } catch (err) {
      // Loi tam thoi: giu so cu con hon hien trong.
      if (cached) return { ...cached, stale: true, staleReason: err.message };
      return { available: false, error: err.message, rateLimited: Boolean(err.rateLimited) };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

module.exports = { get };
