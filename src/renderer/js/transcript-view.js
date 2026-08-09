'use strict';

/**
 * Vẽ lại một phiên hội thoại Claude Code đã lưu.
 *
 * Mỗi message gồm nhiều block khác loại (text, suy nghĩ, gọi công cụ, kết quả
 * công cụ). Mặc định chỉ hiện phần hội thoại; block kỹ thuật được gấp lại để
 * không làm loãng nội dung chính.
 *
 * Phiên dài có thể tới vài nghìn message, nên cột mục lục bên phải liệt kê các
 * prompt của người dùng để nhảy nhanh — cuộn tay là không khả thi.
 */

const ROLE_LABEL = {
  user: 'Bạn',
  assistant: 'Claude',
};

/** Dưới ngưỡng này thì mục lục chỉ tổ chiếm chỗ. */
const MIN_PROMPTS_FOR_OUTLINE = 3;

class TranscriptView {
  constructor({ container, outlineElement, wrapElement, onResume, onNoteChange, onNavigate }) {
    this.container = container;
    this.outlineElement = outlineElement;
    this.wrapElement = wrapElement;
    this.onResume = onResume || (() => {});
    // Danh sach phien ben trai phai ve lai sao khi doi, nen bao nguoc len app.
    this.onNoteChange = onNoteChange || (() => {});
    // (session, direction) -> phien ke tiep/truoc cung thu muc, null neu khong co.
    this.onNavigate = onNavigate || (() => null);
    // Bao nguoc de danh sach ben trai to sang dung hang khi dieu huong bang nut ‹ ›.
    this.onSessionNavigated = () => {};

    this.currentSession = null;
    this.showToolBlocks = false;
    this.showSidechain = false;
    /** sessionId -> { starred, note } cua phien dang mo. */
    this.currentNote = null;

    this._bindScrollSpy();
  }

  showEmpty(message = 'Chọn một phiên ở cột bên trái để xem lại nội dung.') {
    const { escapeHtml } = window.formatUtils;
    this.container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">☰</div>
        <div class="empty-title">${escapeHtml(message)}</div>
        <div class="empty-hint">Dùng ↑↓ để duyệt nhanh danh sách, hoặc Ctrl+K để nhảy thẳng tới một phiên.</div>
      </div>`;
    this._setOutline([]);
  }

  showLoading() {
    this.container.innerHTML = `
      <div style="padding:var(--sp-4)">
        ${Array.from({ length: 5 })
          .map(
            (_, i) =>
              `<div class="skeleton-row">
                 <div class="skeleton-bar" style="width:${30 + i * 4}%;height:11px"></div>
                 <div class="skeleton-bar" style="width:${92 - i * 7}%"></div>
                 <div class="skeleton-bar" style="width:${70 - i * 5}%"></div>
               </div>`,
          )
          .join('')}
      </div>`;
  }

  async load(session, note = null) {
    this.currentSession = session;
    this.currentNote = note;
    this.showLoading();

    try {
      const data = await window.api.history.readTranscript(session.filePath);
      // Người dùng có thể đã bấm sang phiên khác trong lúc đọc.
      if (this.currentSession?.sessionId !== session.sessionId) return;
      this.data = data;
      this.render();
    } catch (err) {
      const { escapeHtml } = window.formatUtils;
      this.container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠</div>
          <div class="empty-title">Không đọc được transcript</div>
          <div class="empty-hint">${escapeHtml(err.message)}</div>
        </div>`;
      this._setOutline([]);
    }
  }

  render() {
    if (!this.data || !this.currentSession) return this.showEmpty();

    const { escapeHtml, formatDateTime, formatBytes } = window.formatUtils;
    const session = this.currentSession;
    const { messages, reachedLimit } = this.data;

    const isStarred = Boolean(this.currentNote?.starred);
    const noteText = this.currentNote?.note || '';

    const visible = messages.filter((msg) => this.showSidechain || !msg.isSidechain);

    const prevSession = this.onNavigate(session, 'prev');
    const nextSession = this.onNavigate(session, 'next');

    const header = `
      <header class="transcript-header">
        <div class="transcript-title-row">
          <button class="icon-btn" data-action="nav-prev" ${prevSession ? '' : 'disabled'} title="${prevSession ? 'Phiên trước cùng dự án' : 'Không có phiên trước'}">
            ${window.icons.svg('chevron-up', { size: 13 })}
          </button>
          <button class="icon-btn" data-action="nav-next" ${nextSession ? '' : 'disabled'} title="${nextSession ? 'Phiên sau cùng dự án' : 'Không có phiên sau'}">
            ${window.icons.svg('chevron-down', { size: 13 })}
          </button>
          <h2>${escapeHtml(session.title)}</h2>
        </div>
        <div class="transcript-meta">
          <span title="Thư mục làm việc">${escapeHtml(session.cwd || 'không rõ thư mục')}</span>
          <span>${escapeHtml(formatDateTime(session.startedAt))} → ${escapeHtml(formatDateTime(session.endedAt))}</span>
          <span>${escapeHtml(formatBytes(session.sizeBytes))}</span>
          ${session.gitBranch ? `<span class="pill">⑂ ${escapeHtml(session.gitBranch)}</span>` : ''}
          ${session.version ? `<span class="pill">v${escapeHtml(session.version)}</span>` : ''}
        </div>
        <div class="transcript-actions">
          <button class="btn btn-primary" data-action="resume">Nối tiếp phiên này</button>
          <button class="btn" data-action="open-folder">Mở thư mục dự án</button>
          <button class="btn" data-action="reveal">Hiện file transcript</button>
          <button class="btn btn-star${isStarred ? ' is-starred' : ''}" data-action="star"
                  title="${isStarred ? 'Bỏ đánh dấu phiên này' : 'Đánh dấu phiên này để tìm lại nhanh'}">
            ${window.icons.svg('star', { filled: isStarred })}
            <span>${isStarred ? 'Đã đánh dấu' : 'Đánh dấu'}</span>
          </button>
          <label class="toggle"><input type="checkbox" data-toggle="tools" ${this.showToolBlocks ? 'checked' : ''}> Hiện gọi công cụ</label>
          <label class="toggle"><input type="checkbox" data-toggle="sidechain" ${this.showSidechain ? 'checked' : ''}> Hiện subagent</label>
        </div>
        <div class="transcript-note-row">
          ${window.icons.svg('pencil')}
          <input class="note-input" type="text" data-note-input maxlength="500"
                 placeholder="Ghi chú một dòng cho phiên này..."
                 value="${escapeHtml(noteText)}" />
          <span class="note-saved is-hidden" data-note-saved>Đã lưu</span>
        </div>
      </header>`;

    const body = visible.map((msg, index) => this._renderMessage(msg, index)).join('');
    const footer = reachedLimit
      ? `<div class="transcript-note">Phiên quá dài: chỉ hiện ${messages.length} message đầu. Dùng "Hiện file transcript" để mở file gốc.</div>`
      : '';

    this.container.innerHTML = `${header}<div class="transcript-body">${body}</div>${footer}`;
    this.container.scrollTop = 0;
    this._bindActions();
    this._buildOutline(visible);
  }

  _navigateTo(session) {
    this.load(session, null);
    this.onSessionNavigated(session);
  }

  _renderMessage(msg, index) {
    const { escapeHtml, formatDateTime } = window.formatUtils;

    const blocks = msg.blocks
      .filter((block) => this.showToolBlocks || (block.kind !== 'tool_use' && block.kind !== 'tool_result'))
      .map((block) => this._renderBlock(block))
      .join('');

    if (!blocks) return '';

    const roleClass = msg.role === 'user' ? 'is-user' : 'is-assistant';
    const label = ROLE_LABEL[msg.role] || msg.type;

    return `
      <article class="message ${roleClass}${msg.isSidechain ? ' is-sidechain' : ''}" id="msg-${index}">
        <div class="message-head">
          <span class="message-role">${escapeHtml(label)}</span>
          ${msg.isSidechain ? '<span class="pill pill-muted">subagent</span>' : ''}
          ${msg.model ? `<span class="pill pill-muted">${escapeHtml(msg.model)}</span>` : ''}
          <time>${escapeHtml(formatDateTime(msg.timestamp))}</time>
          <button class="icon-btn message-copy" data-copy-index="${index}" title="Sao chép tin nhắn này">
            ${window.icons.svg('copy', { size: 12 })}
          </button>
        </div>
        <div class="message-body">${blocks}</div>
      </article>`;
  }

  _renderBlock(block) {
    const { escapeHtml } = window.formatUtils;
    const truncatedNote = block.truncated
      ? `<div class="block-note">... đã cắt bớt, tổng ${block.fullLength.toLocaleString('vi-VN')} ký tự</div>`
      : '';

    switch (block.kind) {
      case 'text':
        return `<div class="block block-text">${escapeHtml(block.text)}</div>`;

      case 'thinking':
        return `
          <details class="block block-thinking">
            <summary>Suy nghĩ nội bộ</summary>
            <pre>${escapeHtml(block.text)}</pre>${truncatedNote}
          </details>`;

      case 'tool_use':
        return `
          <details class="block block-tool">
            <summary><span class="tool-name">${escapeHtml(block.name)}</span> — tham số</summary>
            <pre>${escapeHtml(block.text)}</pre>${truncatedNote}
          </details>`;

      case 'tool_result':
        return `
          <details class="block block-result${block.isError ? ' is-error' : ''}">
            <summary>${block.isError ? 'Kết quả lỗi' : 'Kết quả công cụ'}</summary>
            <pre>${escapeHtml(block.text)}</pre>${truncatedNote}
          </details>`;

      default:
        return '';
    }
  }

  // --- Mục lục -------------------------------------------------------------

  _buildOutline(visibleMessages) {
    const prompts = [];
    visibleMessages.forEach((msg, index) => {
      if (!msg.isUserPrompt) return;
      const text = msg.blocks.find((b) => b.kind === 'text')?.text;
      if (text) prompts.push({ index, text });
    });

    this._setOutline(prompts.length >= MIN_PROMPTS_FOR_OUTLINE ? prompts : []);
  }

  _setOutline(prompts) {
    const { escapeHtml, toTitleLike } = window.formatUtils;

    if (prompts.length === 0) {
      this.outlineElement.classList.add('is-hidden');
      this.wrapElement.classList.remove('has-outline');
      this.outlineElement.innerHTML = '';
      return;
    }

    this.outlineElement.classList.remove('is-hidden');
    this.wrapElement.classList.add('has-outline');
    this.outlineElement.innerHTML = `
      <div class="outline-heading">${prompts.length} lượt hỏi</div>
      ${prompts
        .map(
          (p) =>
            `<button class="outline-item" data-target="msg-${p.index}">
               <span class="outline-text">${escapeHtml(toTitleLike(p.text, 90))}</span>
             </button>`,
        )
        .join('')}`;

    for (const item of this.outlineElement.querySelectorAll('[data-target]')) {
      item.addEventListener('click', () => {
        document.getElementById(item.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  /** Tô sáng mục lục theo vị trí đang cuộn tới. */
  _bindScrollSpy() {
    let ticking = false;

    this.container.addEventListener('scroll', () => {
      if (ticking || this.outlineElement.classList.contains('is-hidden')) return;
      ticking = true;

      requestAnimationFrame(() => {
        ticking = false;
        const items = [...this.outlineElement.querySelectorAll('[data-target]')];
        if (items.length === 0) return;

        const top = this.container.getBoundingClientRect().top;
        let current = items[0];
        for (const item of items) {
          const target = document.getElementById(item.dataset.target);
          if (target && target.getBoundingClientRect().top - top <= 24) current = item;
        }

        for (const item of items) item.classList.toggle('is-current', item === current);
      });
    });
  }

  _bindActions() {
    const session = this.currentSession;

    this.container.querySelector('[data-action="resume"]')?.addEventListener('click', () => {
      this.onResume(session);
    });

    this.container.querySelector('[data-action="nav-prev"]')?.addEventListener('click', () => {
      const target = this.onNavigate(session, 'prev');
      if (target) this._navigateTo(target);
    });

    this.container.querySelector('[data-action="nav-next"]')?.addEventListener('click', () => {
      const target = this.onNavigate(session, 'next');
      if (target) this._navigateTo(target);
    });

    this.container.querySelector('[data-action="reveal"]')?.addEventListener('click', () => {
      window.api.history.revealFile(session.filePath);
    });

    this.container.querySelector('[data-action="open-folder"]')?.addEventListener('click', () => {
      if (session.cwd) this.onResume({ ...session, openShellOnly: true });
    });

    this.container.querySelector('[data-toggle="tools"]')?.addEventListener('change', (event) => {
      this.showToolBlocks = event.target.checked;
      this.render();
    });

    this.container.querySelector('[data-toggle="sidechain"]')?.addEventListener('change', (event) => {
      this.showSidechain = event.target.checked;
      this.render();
    });

    for (const button of this.container.querySelectorAll('[data-copy-index]')) {
      button.addEventListener('click', async () => {
        const visible = this.data.messages.filter((msg) => this.showSidechain || !msg.isSidechain);
        const msg = visible[Number(button.dataset.copyIndex)];
        if (!msg) return;
        const text = msg.blocks
          .filter((b) => this.showToolBlocks || (b.kind !== 'tool_use' && b.kind !== 'tool_result'))
          .map((b) => b.text || '')
          .join('\n\n');
        await window.api.clipboard.writeText(text);
        button.classList.add('is-copied');
        setTimeout(() => button.classList.remove('is-copied'), 1200);
      });
    }

    this.container.querySelector('[data-action="star"]')?.addEventListener('click', async () => {
      const next = !this.currentNote?.starred;
      this.currentNote = await window.api.notes.set(session.sessionId, { starred: next });
      // Chi ve lai phan dau, khong dung toi than transcript dai ben duoi.
      this.render();
      this.onNoteChange(session.sessionId, this.currentNote);
    });

    this._bindNoteInput(session);
  }

  /**
   * Ghi chú lưu khi rời ô hoặc bấm Enter, không lưu theo từng phím: mỗi lần lưu
   * là một lượt ghi file, gõ liên tục sẽ ghi đĩa hàng chục lần vô ích.
   */
  _bindNoteInput(session) {
    const input = this.container.querySelector('[data-note-input]');
    const savedTag = this.container.querySelector('[data-note-saved]');
    if (!input) return;

    const save = async () => {
      const value = input.value.trim();
      if (value === (this.currentNote?.note || '')) return;

      this.currentNote = await window.api.notes.set(session.sessionId, { note: value });
      this.onNoteChange(session.sessionId, this.currentNote);

      savedTag?.classList.remove('is-hidden');
      clearTimeout(this._savedTimer);
      this._savedTimer = setTimeout(() => savedTag?.classList.add('is-hidden'), 1600);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        input.value = this.currentNote?.note || '';
        input.blur();
      }
    });
  }
}

window.TranscriptView = TranscriptView;
