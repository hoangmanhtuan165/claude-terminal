'use strict';

/**
 * Chuan hoa mot dong JSONL cua Claude Code thanh cau truc de hien thi va tim kiem.
 *
 * Dinh dang thuc te (da kiem chung tren transcript cua may):
 * - Moi dong la mot object doc lap, co `type`, `uuid`, `timestamp`, `cwd`, `sessionId`.
 * - `type` gom: user | assistant | system | progress | file-history-snapshot | queue-operation
 * - `message.content` la chuoi (prompt don gian) HOAC mang block:
 *   text | thinking | tool_use | tool_result
 * - `isSidechain: true` danh dau message cua subagent, khong phai hoi thoai chinh.
 *
 * Bay quan trong: `type === 'user'` KHONG dong nghia voi "nguoi dung da go gi do".
 * Phan lon message user thuc chat la `tool_result` do he thong sinh ra.
 */

/** Cac khoi nhieu do harness chen vao, khong phai noi dung nguoi dung go. */
const NOISE_PATTERNS = [
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g,
];

function stripNoise(text) {
  let result = String(text ?? '');
  for (const pattern of NOISE_PATTERNS) result = result.replace(pattern, '');
  return result.trim();
}

/** Prompt goi slash command duoc boc trong the <command-name>. */
function extractSlashCommand(text) {
  const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
  if (!name) return null;
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/);
  const argText = args ? args[1].trim() : '';
  return `${name[1].trim()}${argText ? ` ${argText}` : ''}`.trim();
}

function normalizeContentBlocks(content) {
  if (typeof content === 'string') {
    return content.trim() ? [{ kind: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;

    switch (block.type) {
      case 'text':
        if (block.text) blocks.push({ kind: 'text', text: block.text });
        break;
      case 'thinking':
        if (block.thinking) blocks.push({ kind: 'thinking', text: block.thinking });
        break;
      case 'tool_use':
        blocks.push({
          kind: 'tool_use',
          name: block.name || 'tool',
          text: safeStringify(block.input),
        });
        break;
      case 'tool_result':
        blocks.push({
          kind: 'tool_result',
          isError: Boolean(block.is_error),
          text: flattenToolResult(block.content),
        });
        break;
      default:
        break;
    }
  }
  return blocks;
}

function flattenToolResult(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return safeStringify(content);
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return part.text || '';
      if (part?.type === 'image') return '[hinh anh]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function safeStringify(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Parse mot dong JSONL. Tra ve null neu dong hong hoac khong phai hoi thoai. */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    // Dong cuoi cua file dang duoc ghi co the bi cat ngang - bo qua.
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  return {
    uuid: raw.uuid || null,
    parentUuid: raw.parentUuid || null,
    timestamp: raw.timestamp || null,
    type: raw.type || 'unknown',
    role: raw.message?.role || null,
    isSidechain: Boolean(raw.isSidechain),
    isMeta: Boolean(raw.isMeta),
    cwd: raw.cwd || null,
    sessionId: raw.sessionId || null,
    gitBranch: raw.gitBranch || null,
    version: raw.version || null,
    slug: raw.slug || null,
    model: raw.message?.model || null,
    blocks: normalizeContentBlocks(raw.message?.content),
  };
}

/** Chi giu cac ban ghi thuc su la hoi thoai; bo progress/snapshot/queue. */
function isConversational(record) {
  return record.type === 'user' || record.type === 'assistant';
}

/**
 * Message nay co phai nguoi dung that su go khong?
 * Loai bo tool_result, message meta, va message cua subagent.
 */
function isUserPrompt(record) {
  if (record.type !== 'user' || record.isMeta || record.isSidechain) return false;
  const hasToolResult = record.blocks.some((b) => b.kind === 'tool_result');
  if (hasToolResult) return false;
  return record.blocks.some((b) => b.kind === 'text' && stripNoise(b.text).length > 0);
}

/**
 * Lam sach mot doan van ban cua nguoi dung de hien thi.
 *
 * Phan lon message `type: 'user'` khong phai nguoi dung go ma la thu harness
 * chen vao: nhac nho he thong, canh bao lenh cuc bo, output cua slash command.
 * De nguyen thi khung xem lai day cac the XML vo nghia. Loi goi slash command
 * duoc rut lai thanh dang quen thuoc `/ten tham-so`.
 *
 * Tra ve chuoi rong neu ca doan chi la nhieu - noi goi nen bo han block do.
 */
function cleanUserText(text) {
  const slash = extractSlashCommand(text);
  if (slash) return `/${slash.replace(/^\//, '')}`;
  return stripNoise(text);
}

/**
 * Prompt nay co dang de lam tieu de phien khong?
 *
 * Do tren 150 phien that: 37% tieu de vo nghia vi prompt dau tien chi la mot
 * slash command - rieng `/model` chiem 34 lan. Nguoi dung go `/model` hay
 * `/clear` truoc roi moi vao viec, nen phai bo qua chung de lay cau thuc chat.
 */
function isMeaningfulTitle(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  // Chi la loi goi lenh (`/model`, `/clear`, `/ck:plan`) - khong noi len viec gi.
  if (/^\/\S*$/.test(value)) return false;
  return true;
}

/** Van ban prompt cua nguoi dung sau khi go nhieu, dung lam tieu de phien. */
function userPromptText(record) {
  const raw = record.blocks
    .filter((b) => b.kind === 'text')
    .map((b) => b.text)
    .join('\n');
  return cleanUserText(raw);
}

/** Gop toan bo van ban cua mot ban ghi de do khop khi tim kiem. */
function searchableText(record) {
  return record.blocks.map((b) => b.text || '').join('\n');
}

function toTitle(text, maxLength = 120) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength - 1)}...`;
}

module.exports = {
  parseLine,
  isConversational,
  isUserPrompt,
  userPromptText,
  isMeaningfulTitle,
  cleanUserText,
  searchableText,
  stripNoise,
  toTitle,
};
