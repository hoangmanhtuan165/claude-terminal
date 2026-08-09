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
  constructor({ elements, getActiveTab, getAllTabs, activateTab }) {
    this.el = elements;
    this.getActiveTab = getActiveTab;
    this.getAllTabs = getAllTabs || (() => new Map());
    this.activateTab = activateTab || (() => {});
    this.isOpen = false;
    this.lastQuery = '';
    // Che do "tim tat ca tab": Enter quet toan bo pane dang mo thay vi chi tab
    // hien tai. Khong quet theo tung phim go (input) - qua ton neu nhieu tab
    // dai, chi quet khi nguoi dung chu dong bam Enter.
    this.allTabsMode = false;

    this._bind();
  }

  _bind() {
    this.el.input.addEventListener('input', () => {
      if (this.allTabsMode) return;
      this.search({ fromStart: true });
    });

    this.el.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (this.allTabsMode) this._searchAllTabs();
        else this.search({ backwards: event.shiftKey });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.el.next.addEventListener('click', () => this.search({}));
    this.el.prev.addEventListener('click', () => this.search({ backwards: true }));
    this.el.close.addEventListener('click', () => this.close());
    this.el.allToggle?.addEventListener('click', () => this._toggleAllTabsMode());
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
    this.el.allResults?.classList.add('is-hidden');

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

  // --- Tim trong tat ca tab ----------------------------------------------------

  _toggleAllTabsMode() {
    this.allTabsMode = !this.allTabsMode;
    this.el.allToggle.classList.toggle('is-active', this.allTabsMode);
    this.el.allResults.classList.add('is-hidden');
    this.el.allResults.innerHTML = '';
    this.el.count.textContent = '';

    if (this.allTabsMode) {
      if (this.el.input.value) this._searchAllTabs();
    } else {
      const tab = this.getActiveTab();
      if (tab) tab.searchAddon.clearDecorations();
      if (this.el.input.value) this.search({ fromStart: true });
    }
  }

  /** Dem so lan xuat hien cua query trong toan bo scrollback cua mot terminal (khong phan biet hoa/thuong). */
  _countMatches(term, query) {
    const needle = query.toLowerCase();
    const buffer = term.buffer.active;
    let count = 0;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i)?.translateToString(true);
      if (!line) continue;
      const lower = line.toLowerCase();
      let idx = lower.indexOf(needle);
      while (idx !== -1) {
        count++;
        idx = lower.indexOf(needle, idx + needle.length);
      }
    }
    return count;
  }

  _searchAllTabs() {
    const query = this.el.input.value.trim();
    this.el.allResults.innerHTML = '';
    if (!query) {
      this.el.allResults.classList.add('is-hidden');
      this.el.count.textContent = '';
      return;
    }

    const { escapeHtml } = window.formatUtils;
    const results = [];
    for (const tab of this.getAllTabs().values()) {
      const count = tab.panes.reduce((sum, pane) => sum + this._countMatches(pane.term, query), 0);
      if (count > 0) results.push({ tabId: tab.id, title: tab.title, count });
    }

    if (!results.length) {
      this.el.count.textContent = 'không thấy';
      this.el.count.style.color = 'var(--danger)';
      this.el.allResults.classList.add('is-hidden');
      return;
    }

    this.el.count.textContent = `${results.length} tab`;
    this.el.count.style.color = '';
    this.el.allResults.classList.remove('is-hidden');
    this.el.allResults.innerHTML = results
      .map(
        (r) => `
        <button class="term-find-all-row" data-tab-id="${escapeHtml(r.tabId)}">
          <span class="term-find-all-title">${escapeHtml(r.title)}</span>
          <span class="term-find-all-count">${r.count}</span>
        </button>`,
      )
      .join('');

    for (const button of this.el.allResults.querySelectorAll('[data-tab-id]')) {
      button.addEventListener('click', () => {
        this.activateTab(button.dataset.tabId);
        // Doi tab xong chuyen ve che do tim thuong de to sang/nhay ngay ket qua.
        this.allTabsMode = false;
        this.el.allToggle.classList.remove('is-active');
        this.el.allResults.classList.add('is-hidden');
        requestAnimationFrame(() => this.search({ fromStart: true }));
      });
    }
  }
}

window.TerminalFind = TerminalFind;
