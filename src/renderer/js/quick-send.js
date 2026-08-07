'use strict';

/**
 * Go nhanh mot chuoi co san xuong terminal dang chay.
 *
 * Vi sao co file nay: do tren 4044 prompt that trong lich su, phan lon thao tac
 * lap lai deu la go lai dung mot chuoi ngan.
 *   - `/model ...`  316 lan, tren 65/151 phien (33 phien mo dau bang chinh no)
 *   - "tiếp tục" 146, "tiếp" 78, "ok" 36, "/compact" 31
 * Tat ca deu chi la ghi vai ky tu vao PTY - viec app lam duoc thay nguoi dung.
 *
 * Hai thanh phan trong file dung chung ham `sendToActivePane`, nen de chung
 * mot cho thay vi tach doi.
 */

/**
 * Cac model hay dung, lay dung theo tan suat trong lich su that.
 * `label` la chu hien tren nut, `command` la chuoi go xuong terminal.
 */
const MODEL_CHOICES = [
  { label: 'sonnet', command: '/model sonnet' },
  { label: 'opus 1m', command: '/model opus[1m]' },
  { label: 'fable-5 1m', command: '/model claude-fable-5[1m]' },
  { label: 'opus', command: '/model opus' },
  { label: 'haiku', command: '/model haiku' },
  { label: 'default', command: '/model default' },
];

/** Nut go nhanh mac dinh. Nguoi dung sua duoc, luu trong settings. */
const DEFAULT_QUICK_ITEMS = ['tiếp tục', 'ok', '/compact', 'lỗi'];

class QuickSend {
  constructor({ quickBarElement, modelButton, modelLabel, getActivePane, onNeedTerminal }) {
    this.quickBar = quickBarElement;
    this.modelButton = modelButton;
    this.modelLabel = modelLabel;
    this.getActivePane = getActivePane;
    this.onNeedTerminal = onNeedTerminal || (() => {});

    this.items = [...DEFAULT_QUICK_ITEMS];
    /** cwd -> nhan model da chon lan cuoi o du an do. */
    this.modelByCwd = {};

    this.modelButton.addEventListener('click', () => this._openModelMenu());
  }

  async loadPrefs() {
    const prefs = await window.api.prefs.get();
    if (Array.isArray(prefs.quickItems) && prefs.quickItems.length) {
      this.items = prefs.quickItems;
    }
    this.modelByCwd = prefs.modelByCwd && typeof prefs.modelByCwd === 'object' ? prefs.modelByCwd : {};
    this.renderQuickBar();
    this.refreshModelLabel();
  }

  /**
   * Go chuoi xuong pane dang lam viec.
   *
   * `submit` quyet dinh co gui kem Enter khong. Voi cac cau nhu "tiếp tục" thi
   * gui luon; voi chuoi nguoi dung con muon sua tiep thi chi chen chu.
   */
  sendToActivePane(text, { submit = true } = {}) {
    const pane = this.getActivePane();
    if (!pane) return false;

    this.onNeedTerminal();
    window.api.pty.write(pane.id, submit ? `${text}\r` : text);
    // Tra focus ve terminal, neu khong con tro se ket lai o nut vua bam.
    requestAnimationFrame(() => pane.term.focus());
    return true;
  }

  // --- Hang nut go nhanh ---------------------------------------------------

  renderQuickBar() {
    const { escapeHtml } = window.formatUtils;

    this.quickBar.innerHTML = `
      ${this.items
        .map(
          (text, index) =>
            `<button class="quick-chip" data-index="${index}" title="Gõ &quot;${escapeHtml(text)}&quot; xuống terminal">${escapeHtml(text)}</button>`,
        )
        .join('')}
      <button class="quick-chip quick-chip-edit" data-action="edit" title="Sửa danh sách nút gõ nhanh">
        ${window.icons.svg('pencil', { size: 12 })}
      </button>`;

    for (const button of this.quickBar.querySelectorAll('[data-index]')) {
      button.addEventListener('click', () => {
        this.sendToActivePane(this.items[Number(button.dataset.index)]);
      });
    }

    this.quickBar
      .querySelector('[data-action="edit"]')
      ?.addEventListener('click', () => this._editItems());
  }

  _editItems() {
    // Danh sach ngan, sua bang mot o nhap la du - khong dang dung mot hop thoai
    // rieng cho viec nay.
    const current = this.items.join('\n');
    const next = window.prompt(
      'Mỗi dòng là một nút gõ nhanh. Xoá hết để quay lại mặc định.',
      current,
    );
    if (next === null) return;

    const parsed = next
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10);

    this.items = parsed.length ? parsed : [...DEFAULT_QUICK_ITEMS];
    window.api.prefs.set({ quickItems: this.items });
    this.renderQuickBar();
  }

  // --- Doi model -----------------------------------------------------------

  /** Nhan model dang hien: nho theo tung du an vi moi du an hay dung mot model. */
  refreshModelLabel() {
    const pane = this.getActivePane();
    const remembered = pane?.cwd ? this.modelByCwd[pane.cwd.toLowerCase()] : null;
    this.modelLabel.textContent = remembered || 'model';
  }

  _openModelMenu() {
    const existing = document.querySelector('.model-menu');
    if (existing) {
      existing.remove();
      return;
    }

    const { escapeHtml } = window.formatUtils;
    const menu = document.createElement('div');
    menu.className = 'model-menu';
    menu.innerHTML = MODEL_CHOICES.map(
      (choice) =>
        `<button class="model-menu-item" data-command="${escapeHtml(choice.command)}" data-label="${escapeHtml(choice.label)}">
           <span class="model-menu-label">${escapeHtml(choice.label)}</span>
           <span class="model-menu-cmd">${escapeHtml(choice.command)}</span>
         </button>`,
    ).join('');

    document.body.append(menu);

    // Neo menu ngay tren nut, can le phai de khong tran ra ngoai man hinh.
    const rect = this.modelButton.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;

    for (const item of menu.querySelectorAll('[data-command]')) {
      item.addEventListener('click', () => {
        this._chooseModel(item.dataset.command, item.dataset.label);
        menu.remove();
      });
    }

    // Bam ra ngoai thi dong. Dat o pha capture va bo qua chinh lan bam dang mo
    // menu, neu khong menu se dong ngay lap tuc.
    const closeOnOutside = (event) => {
      if (menu.contains(event.target) || this.modelButton.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
  }

  _chooseModel(command, label) {
    if (!this.sendToActivePane(command)) return;

    const pane = this.getActivePane();
    if (pane?.cwd) {
      this.modelByCwd[pane.cwd.toLowerCase()] = label;
      window.api.prefs.set({ modelByCwd: this.modelByCwd });
    }
    this.modelLabel.textContent = label;
  }
}

window.QuickSend = QuickSend;
window.QUICK_MODEL_CHOICES = MODEL_CHOICES;
