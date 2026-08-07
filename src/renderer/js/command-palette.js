'use strict';

/**
 * Bảng lệnh (Ctrl+K): gõ vài chữ là nhảy tới dự án, phiên cũ, hoặc chạy lệnh.
 *
 * Gộp cả ba loại vào một ô tìm thay vì bắt người dùng nhớ đang ở màn hình nào.
 * Với 80 dự án và 150 phiên, đây là cách nhanh nhất để tới đúng chỗ.
 */

const MAX_PER_GROUP = 6;

/**
 * Khớp mờ kiểu "gõ tắt": các ký tự của từ khoá phải xuất hiện đúng thứ tự
 * nhưng không cần liền nhau, nên `qlt` khớp `quản lý terminal`.
 * Điểm cao hơn khi khớp liền mạch và khi khớp sớm trong chuỗi.
 */
function fuzzyScore(text, query) {
  if (!query) return 0;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack.includes(needle)) {
    // Khớp nguyên cụm luôn hơn khớp rời rạc.
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

class CommandPalette {
  constructor({ root, actions }) {
    this.root = root;
    this.actions = actions;
    this.isOpen = false;
    this.items = [];
    this.cursor = 0;
  }

  /** Nguồn dữ liệu được lấy lúc mở để luôn phản ánh trạng thái hiện tại. */
  _collect() {
    const { baseName, formatRelative } = window.formatUtils;
    const items = [];

    for (const command of this.actions.commands()) {
      items.push({
        group: 'Lệnh',
        icon: command.icon || 'chevron-right',
        title: command.title,
        sub: command.hint || '',
        run: command.run,
      });
    }

    for (const project of this.actions.projects()) {
      items.push({
        group: 'Dự án',
        icon: 'chevron-right',
        title: baseName(project.cwd) || project.cwd,
        sub: project.cwd,
        run: () => this.actions.openProject(project.cwd),
      });
    }

    for (const session of this.actions.sessions()) {
      items.push({
        group: 'Phiên gần đây',
        icon: 'clock',
        title: session.title,
        sub: `${baseName(session.cwd) || 'không rõ'} · ${formatRelative(session.endedAt)}`,
        run: () => this.actions.openSession(session),
      });
    }

    return items;
  }

  open() {
    this.isOpen = true;
    this.allItems = this._collect();
    this.cursor = 0;
    this._render('');

    const input = this.root.querySelector('.palette-input');
    input.focus();
  }

  close() {
    this.isOpen = false;
    this.root.innerHTML = '';
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  _filter(query) {
    if (!query.trim()) {
      // Chưa gõ gì: hiện mỗi nhóm vài mục để thấy ngay có thể làm gì.
      const byGroup = new Map();
      for (const item of this.allItems) {
        const list = byGroup.get(item.group) || [];
        if (list.length < MAX_PER_GROUP) list.push(item);
        byGroup.set(item.group, list);
      }
      return [...byGroup.values()].flat();
    }

    return this.allItems
      .map((item) => ({ item, score: Math.max(fuzzyScore(item.title, query), fuzzyScore(item.sub, query) - 200) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .map((entry) => entry.item);
  }

  _render(query) {
    const { escapeHtml } = window.formatUtils;
    this.items = this._filter(query);
    if (this.cursor >= this.items.length) this.cursor = Math.max(0, this.items.length - 1);

    let listHtml = '';
    let lastGroup = null;
    this.items.forEach((item, index) => {
      if (item.group !== lastGroup) {
        listHtml += `<div class="palette-group">${escapeHtml(item.group)}</div>`;
        lastGroup = item.group;
      }
      listHtml += `
        <button class="palette-item${index === this.cursor ? ' is-cursor' : ''}" data-index="${index}">
          <span class="item-icon">${window.icons.svg(item.icon)}</span>
          <span class="item-body">
            <span class="item-title">${escapeHtml(item.title)}</span>
            ${item.sub ? `<span class="item-sub">${escapeHtml(item.sub)}</span>` : ''}
          </span>
        </button>`;
    });

    if (this.items.length === 0) {
      listHtml = '<div class="empty-state"><div class="empty-hint">Không có mục nào khớp.</div></div>';
    }

    // Giữ nguyên ô nhập khi vẽ lại để con trỏ soạn thảo không bị nhảy.
    const existingInput = this.root.querySelector('.palette-input');
    if (existingInput) {
      this.root.querySelector('.palette-list').innerHTML = listHtml;
    } else {
      this.root.innerHTML = `
        <div class="palette-backdrop">
          <div class="palette" role="dialog" aria-label="Bảng lệnh">
            <input class="palette-input" type="text" placeholder="Gõ để tìm dự án, phiên, hoặc lệnh..." autocomplete="off" />
            <div class="palette-list">${listHtml}</div>
            <div class="palette-footer">
              <span>↑↓ chọn</span><span>Enter mở</span><span>Esc đóng</span>
            </div>
          </div>
        </div>`;
      this._bind();
    }
    this._scrollCursorIntoView();
  }

  _bind() {
    const input = this.root.querySelector('.palette-input');

    input.addEventListener('input', () => {
      this.cursor = 0;
      this._render(input.value);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this._move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this._move(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this._runCursor();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });

    this.root.querySelector('.palette-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-index]');
      if (!button) return;
      this.cursor = Number(button.dataset.index);
      this._runCursor();
    });

    // Bấm ra ngoài hộp thoại thì đóng.
    this.root.querySelector('.palette-backdrop').addEventListener('mousedown', (event) => {
      if (event.target === event.currentTarget) this.close();
    });
  }

  _move(delta) {
    if (this.items.length === 0) return;
    this.cursor = (this.cursor + delta + this.items.length) % this.items.length;

    for (const el of this.root.querySelectorAll('.palette-item')) {
      el.classList.toggle('is-cursor', Number(el.dataset.index) === this.cursor);
    }
    this._scrollCursorIntoView();
  }

  _scrollCursorIntoView() {
    this.root
      .querySelector(`.palette-item[data-index="${this.cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  _runCursor() {
    const item = this.items[this.cursor];
    if (!item) return;
    this.close();
    item.run();
  }
}

window.CommandPalette = CommandPalette;
