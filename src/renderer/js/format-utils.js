'use strict';

/** Cac ham dinh dang dung chung cho giao dien. */

/** Chen van ban vao DOM luon phai qua day: noi dung transcript la du lieu khong tin cay. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Ngay gio dang ngan, theo mui gio may. */
function formatDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Khoang cach thoi gian doc nhanh: "3 phut truoc", "2 ngay truoc". */
function formatRelative(isoString) {
  if (!isoString) return '';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'vừa xong';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} tháng trước`;
  return `${Math.round(months / 12)} năm trước`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * So token rut gon: 1.2M, 340K...
 * Con so token luon rat lon nen hien day du chi lam roi mat.
 */
function formatTokens(tokens) {
  const value = Number(tokens) || 0;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

/** Rut gon duong dan dai o giua de van thay duoc ten thu muc cuoi. */
function shortenPath(fullPath, maxLength = 46) {
  const value = String(fullPath || '');
  if (value.length <= maxLength) return value;

  const sep = value.includes('\\') ? '\\' : '/';
  const parts = value.split(/[\\/]/);
  const last = parts[parts.length - 1] || '';
  const first = parts[0] || '';
  return `${first}${sep}...${sep}${last}`.slice(0, maxLength);
}

function baseName(fullPath) {
  const parts = String(fullPath || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || fullPath || '';
}

/** Ep mot doan van ban nhieu dong thanh mot dong ngan de hien trong danh sach. */
function toTitleLike(text, maxLength = 90) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength - 1)}…`;
}

/** To sang tat ca lan xuat hien cua `needle`. Ca hai phia deu duoc escape truoc. */
function highlightHtml(text, needle) {
  const safeText = escapeHtml(text);
  if (!needle) return safeText;

  const safeNeedle = escapeHtml(needle);
  const pattern = safeNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safeText.replace(new RegExp(pattern, 'gi'), (match) => `<mark>${match}</mark>`);
}

/**
 * Khop mo kieu "go tat": cac ky tu cua tu khoa phai xuat hien dung thu tu
 * nhung khong can lien nhau, nen `qlt` khop `quan ly terminal`.
 * Diem cao hon khi khop lien mach va khi khop som trong chuoi. Tra ve -1 neu
 * khong khop gi ca.
 */
function fuzzyScore(text, query) {
  if (!query) return 0;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack.includes(needle)) {
    // Khop nguyen cum luon hon khop roi rac.
    return 1000 - haystack.indexOf(needle);
  }

  let score = 0;
  let at = -1;
  let streak = 0;

  for (const char of needle) {
    const found = haystack.indexOf(char, at + 1);
    if (found === -1) return -1;
    streak = found === at + 1 ? streak + 1 : 0;
    score += 10 + streak * 5;
    at = found;
  }
  return score;
}

window.formatUtils = {
  escapeHtml,
  formatDateTime,
  formatRelative,
  formatBytes,
  formatTokens,
  shortenPath,
  baseName,
  toTitleLike,
  highlightHtml,
  fuzzyScore,
};
