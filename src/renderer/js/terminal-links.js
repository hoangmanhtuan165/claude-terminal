'use strict';

/**
 * Nhan dien lien ket thay cho WebLinksAddon mac dinh.
 *
 * WebLinksAddon quet TUNG DONG MAN HINH rieng le. Mot URL dai bi xuong dong
 * (wrap) vi vay bi cat thanh hai lien ket rieng biet, sai/hong khi bam - dung
 * y het truong hop link dang nhap OAuth cua Claude Code chay tren VPS (URL
 * qua dai, luon xuong 2-3 dong man hinh).
 *
 * Provider nay ghep lai DUNG THEO DONG LOGIC (gom ca cac dong bi wrap tu dong
 * truoc, dua vao co `isWrapped` cua xterm) truoc khi do URL, nen link dai
 * xuong hang van la MOT lien ket duy nhat, bam o dong nao trong so do cung
 * mo dung, du URL.
 */

const URL_REGEX = /https?:\/\/[^\s]+/g;
// Dau cau thuong dung o cuoi cau chua khong phai mot phan URL - cat bo de
// khong bam nham dau cham/ngoac vao lien ket.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function trimTrailingPunctuation(text) {
  return text.replace(TRAILING_PUNCTUATION, '');
}

/**
 * Ghep noi dung mot "dong logic" (dong chua absoluteY, cong voi moi dong bi
 * wrap lien truoc/sau no) thanh mot chuoi duy nhat.
 * Tra ve { firstAbsoluteY, text } - firstAbsoluteY la dong tuyet doi dau tien
 * cua nhom, dung de doi vi tri ky tu nguoc lai thanh toa do sau nay.
 */
function buildLogicalLine(buffer, absoluteY, cols) {
  let firstAbsoluteY = absoluteY;
  while (firstAbsoluteY > 0) {
    const line = buffer.getLine(firstAbsoluteY);
    if (!line || !line.isWrapped) break;
    firstAbsoluteY -= 1;
  }

  const parts = [];
  for (let cur = firstAbsoluteY; ; cur += 1) {
    const line = buffer.getLine(cur);
    if (!line) break;
    parts.push(line.translateToString(false, 0, cols));
    const next = buffer.getLine(cur + 1);
    if (!next || !next.isWrapped) break;
  }

  return { firstAbsoluteY, text: parts.join('') };
}

function createLinkProvider(term, openExternal) {
  return {
    provideLinks(viewportY, callback) {
      try {
        const buffer = term.buffer.active;
        const cols = term.cols;
        const absoluteY = buffer.viewportY + viewportY - 1;

        const { firstAbsoluteY, text } = buildLogicalLine(buffer, absoluteY, cols);
        if (!text) return callback(undefined);

        const links = [];
        let match;
        URL_REGEX.lastIndex = 0;
        while ((match = URL_REGEX.exec(text))) {
          const trimmed = trimTrailingPunctuation(match[0]);
          if (!trimmed) continue;

          const startIdx = match.index;
          const endIdx = startIdx + trimmed.length - 1;
          const startRow = firstAbsoluteY + Math.floor(startIdx / cols);
          const endRow = firstAbsoluteY + Math.floor(endIdx / cols);

          links.push({
            text: trimmed,
            range: {
              start: { x: (startIdx % cols) + 1, y: startRow - buffer.viewportY + 1 },
              end: { x: (endIdx % cols) + 1, y: endRow - buffer.viewportY + 1 },
            },
            activate: () => openExternal(trimmed),
          });
        }

        callback(links.length ? links : undefined);
      } catch {
        // Loi bat ky (vd toa do vuot vung dem luc dang cuon) thi coi nhu
        // khong co link o dong nay - khong lam vo giao dien.
        callback(undefined);
      }
    },
  };
}

window.createTerminalLinkProvider = createLinkProvider;
