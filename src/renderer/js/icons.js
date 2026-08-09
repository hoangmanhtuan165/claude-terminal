'use strict';

/**
 * Bo icon SVG toi gian dung chung toan app, thay cho ky tu Unicode lam icon
 * (font he thong khac nhau render khong dong nhat, nhin thieu chuyen nghiep).
 * Stroke ke thua currentColor nen tu doi mau theo theme/trang thai nut, khong
 * can khai bao mau rieng.
 */

const ICON_PATHS = {
  'terminal-prompt':
    '<rect x="1.5" y="2.5" width="13" height="11" rx="2"/><polyline points="4.5,6 7,8 4.5,10"/><line x1="8" y1="10" x2="11" y2="10"/>',
  clock: '<circle cx="8" cy="8" r="6"/><polyline points="8,4.5 8,8 10.5,9.5"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><line x1="10.3" y1="10.3" x2="14" y2="14"/>',
  refresh: '<path d="M12.5 8a4.5 4.5 0 1 1-1.5-3.36"/><polyline points="12.5,3 12.5,6 9.5,6"/>',
  contrast:
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11Z" fill="currentColor" stroke="none"/>',
  download: '<path d="M8 2v8"/><polyline points="4.5,7 8,10.5 11.5,7"/><line x1="3" y1="13.5" x2="13" y2="13.5"/>',
  plus: '<line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>',
  'chevron-right': '<polyline points="6,3 11,8 6,13"/>',
  'chevron-down': '<polyline points="3,6 8,11 13,6"/>',
  'chevron-up': '<polyline points="3,10 8,5 13,10"/>',
  x: '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>',
  play: '<path d="M5 3.5v9l8-4.5-8-4.5Z" fill="currentColor" stroke="none"/>',
  pin: '<path d="M8 1.5c-2 0-3.5 1.6-3.5 3.6 0 2.3 3.5 6.4 3.5 6.4s3.5-4.1 3.5-6.4C11.5 3.1 10 1.5 8 1.5Z"/>',
  folder:
    '<path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.3 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6.5Z"/>',
  star: '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6L8 1.8Z"/>',
  split: '<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6"/><line x1="8" y1="2.5" x2="8" y2="13.5"/>',
  cpu: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.2"/><path d="M6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14"/>',
  user: '<circle cx="8" cy="5.6" r="2.8"/><path d="M2.8 14c0-2.9 2.3-4.6 5.2-4.6s5.2 1.7 5.2 4.6"/>',
  gauge: '<path d="M2.5 12a5.5 5.5 0 1 1 11 0"/><path d="M8 12l3-3.4"/>',
  pencil: '<path d="M11.5 2.3l2.2 2.2-8 8-3 .8.8-3 8-8Z"/>',
  diamond:
    '<rect x="3" y="3" width="10" height="10" rx="2" transform="rotate(45 8 8)"/><path d="M6.2 5v6M6.2 8l2.6-3M6.2 8l2.6 3"/>',
  bolt: '<path d="M9 1.5 3.5 9h3.2L6 14.5 12.5 7H9.3L9 1.5Z"/>',
  camera:
    '<path d="M2 5.5a1 1 0 0 1 1-1h1.8l.9-1.4h4.6l.9 1.4H13a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7Z"/><circle cx="8" cy="9" r="2.6"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M3.5 10.5H2.8a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1h6.7a1 1 0 0 1 1 1v.7"/>',
  server:
    '<rect x="2" y="2.5" width="12" height="4.6" rx="1.2"/><rect x="2" y="8.9" width="12" height="4.6" rx="1.2"/><circle cx="4.6" cy="4.8" r="0.9" fill="currentColor" stroke="none"/><circle cx="4.6" cy="11.2" r="0.9" fill="currentColor" stroke="none"/>',
  key: '<circle cx="5.2" cy="10.8" r="2.7"/><path d="M7.1 8.9 12.5 3.5l1.2 1.2M11 5l1.4 1.4"/>',
  'git-branch':
    '<circle cx="4.2" cy="3.5" r="1.8"/><circle cx="4.2" cy="12.5" r="1.8"/><circle cx="11.8" cy="6.5" r="1.8"/><path d="M4.2 5.3v5.4M4.2 8a4 4 0 0 0 4-4h1.8"/>',
  broadcast:
    '<circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/><path d="M5.3 5.3a3.8 3.8 0 0 0 0 5.4M10.7 5.3a3.8 3.8 0 0 1 0 5.4M3 3a7.6 7.6 0 0 0 0 10M13 3a7.6 7.6 0 0 1 0 10"/>',
  layers:
    '<path d="M8 2 2.5 5.2 8 8.4l5.5-3.2Z"/><path d="M2.5 8 8 11.2 13.5 8"/><path d="M2.5 10.8 8 14l5.5-3.2"/>',
  sftp: '<path d="M2 5.5a1 1 0 0 1 1-1h3.2l1.3 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6.5Z"/><path d="M8 7v4M6.2 9.2 8 11l1.8-1.8"/>',
  book: '<path d="M2.5 3.2c1.6-.6 3.5-.6 5 0v9.6c-1.5-.6-3.4-.6-5 0Z"/><path d="M13.5 3.2c-1.6-.6-3.5-.6-5 0v9.6c1.5-.6 3.4-.6 5 0Z"/>',
};

/** Tra ve chuoi <svg> markup. Noi dung tu ta viet, dang tin cay de dat thang vao innerHTML. */
function iconSvg(name, { size = 16, filled = false } = {}) {
  const inner = ICON_PATHS[name];
  if (!inner) return '';
  const fill = filled ? 'currentColor' : 'none';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="${fill}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** Thay moi phan tu tinh trong index.html co data-icon bang SVG tuong ung. */
function applyStaticIcons() {
  for (const el of document.querySelectorAll('[data-icon]')) {
    el.innerHTML = iconSvg(el.dataset.icon);
  }
}

window.icons = { svg: iconSvg };
window.addEventListener('DOMContentLoaded', applyStaticIcons);
