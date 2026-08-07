'use strict';

/**
 * Tìm trong nội dung terminal (Ctrl+F).
 *
 * xterm có sẵn SearchAddon nhưng addon chỉ lo phần dò tìm và tô sáng — phần
 * giao diện phải tự dựng. Ô tìm bám vào tab đang mở, nên chuyển tab là tìm
 * trên đúng nội dung của tab đó.
 */

const HIGHLIGHT = {
  activeMatchBackground: '#d9b23f',
  activeMatchColorOverviewRuler: '#d9b23f',
  matchBackground: 'rgba(217, 178, 63, 0.35)',
  matchOverviewRuler: 'rgba(217, 178, 63, 0.6)',
};

class TerminalFind {
  constructor({ elements, getActiveTab }) {
    this.el = elements;
    this.getActiveTab = getActiveTab;
    this.isOpen = false;
    this.lastQuery = '';

    this._bind();
  }

  _bind() {
    this.el.input.addEventListener('input', () => this.search({ fromStart: true }));

    this.el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.search({ backwards: event.shiftKey });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.el.next.addEventListener('click', () => this.search({}));
    this.el.prev.addEventListener('click', () => this.search({ backwards: true }));
    this.el.close.addEventListener('click', () => this.close());
  }

  open() {
    const tab = this.getActiveTab();
    if (!tab) return;

    this.isOpen = true;
    this.el.root.classList.remove('is-hidden');

    // Nếu đang bôi đen sẵn một đoạn thì lấy luôn làm từ khoá.
    const selected = tab.term.getSelection().trim();
    if (selected && !selected.includes('\n')) this.el.input.value = selected;

    this.el.input.focus();
    this.el.input.select();
    if (this.el.input.value) this.search({ fromStart: true });
  }

  close() {
    this.isOpen = false;
    this.el.root.classList.add('is-hidden');
    this.el.count.textContent = '';

    const tab = this.getActiveTab();
    if (tab) {
      tab.searchAddon.clearDecorations();
      tab.term.focus();
    }
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  search({ backwards = false, fromStart = false } = {}) {
    const tab = this.getActiveTab();
    if (!tab) return;

    const query = this.el.input.value;
    if (!query) {
      tab.searchAddon.clearDecorations();
      this.el.count.textContent = '';
      return;
    }

    const options = { decorations: HIGHLIGHT, incremental: fromStart };
    const found = backwards
      ? tab.searchAddon.findPrevious(query, options)
      : tab.searchAddon.findNext(query, options);

    this.el.count.textContent = found ? '' : 'không thấy';
    this.el.count.style.color = found ? '' : 'var(--danger)';
    this.lastQuery = query;
  }

  /** Đổi tab thì tìm lại trên nội dung của tab mới. */
  handleTabChange() {
    if (this.isOpen && this.el.input.value) this.search({ fromStart: true });
  }
}

window.TerminalFind = TerminalFind;
