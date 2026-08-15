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

/**
 * Nut go nhanh mac dinh. Nguoi dung sua duoc, luu trong settings.
 * "tiếp" la bien the rieng cua "tiếp tục" - do tren 3.810 prompt that ca hai
 * deu la cau hay go lai (149 va 81 lan), nhung truoc day chi "tiếp tục" co nut.
 */
const DEFAULT_QUICK_ITEMS = ['tiếp tục', 'tiếp', 'ok', '/compact', 'lỗi'];

class QuickSend {
  constructor({
    quickBarElement,
    sshQuickBarElement,
    modelButton,
    modelLabel,
    getActivePane,
    onPickFiles,
    onToggleSkipPermissions,
    onNeedTerminal,
  }) {
    this.quickBar = quickBarElement;
    this.sshBar = sshQuickBarElement || null;
    this.modelButton = modelButton;
    this.modelLabel = modelLabel;
    this.getActivePane = getActivePane;
    this.onPickFiles = onPickFiles || (() => {});
    this.onToggleSkipPermissions = onToggleSkipPermissions || (() => {});
    this.onNeedTerminal = onNeedTerminal || (() => {});

    this.items = [...DEFAULT_QUICK_ITEMS];
    /** Thu vien prompt: { id, group, text } - text co the chua {{cwd}}/{{branch}}/{{date}}. */
    this.library = [];
    /** cwd -> nhan model da chon lan cuoi o du an do. */
    this.modelByCwd = {};
    // Tang moi lan doi tab, tranh phan hoi ssh.list() cham cua tab cu ghi de tab moi.
    this._sshBarSeq = 0;

    this.modelButton.addEventListener('click', () => this._openModelMenu());
  }

  async loadPrefs() {
    const prefs = await window.api.prefs.get();
    if (Array.isArray(prefs.quickItems) && prefs.quickItems.length) {
      this.items = prefs.quickItems;
    }
    this.library = Array.isArray(prefs.promptLibrary) ? prefs.promptLibrary : [];
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
      <button class="quick-chip quick-chip-icon" data-action="screenshot" title="Chụp màn hình rồi dán vào terminal">
        ${window.icons.svg('camera', { size: 13 })}
      </button>
      ${this.items
        .map(
          (text, index) =>
            `<button class="quick-chip" data-index="${index}" title="Gõ &quot;${escapeHtml(text)}&quot; xuống terminal">${escapeHtml(text)}</button>`,
        )
        .join('')}
      <button class="quick-chip quick-chip-icon" data-action="library" title="Thư viện prompt">
        ${window.icons.svg('book', { size: 13 })}
      </button>
      <button class="quick-chip quick-chip-edit" data-action="edit" title="Sửa danh sách nút gõ nhanh">
        ${window.icons.svg('pencil', { size: 12 })}
      </button>
      <span class="quick-bar-spacer"></span>
      <button class="quick-chip quick-chip-icon" data-action="expand-prompt" title="Gửi dòng đang gõ, rồi nhờ Claude gợi ý cách hỏi rõ ràng/chi tiết hơn cho lần sau">
        ${window.icons.svg('sparkle', { size: 13 })}
      </button>
      <button class="quick-chip quick-chip-icon" data-action="attach" title="Chèn file vào terminal">
        ${window.icons.svg('paperclip', { size: 13 })}
      </button>
      <button class="quick-chip quick-chip-icon" data-action="skip-permissions" title="Bật bỏ qua xin quyền (--dangerously-skip-permissions) cho dự án này">
        ${window.icons.svg('bolt', { size: 13 })}
      </button>`;

    for (const button of this.quickBar.querySelectorAll('[data-index]')) {
      button.addEventListener('click', () => {
        this.sendToActivePane(this.items[Number(button.dataset.index)]);
      });
    }

    this.quickBar
      .querySelector('[data-action="edit"]')
      ?.addEventListener('click', (event) => this._editItems(event.currentTarget));

    this.quickBar
      .querySelector('[data-action="screenshot"]')
      ?.addEventListener('click', (event) => this._captureScreenshot(event.currentTarget));

    this.quickBar
      .querySelector('[data-action="library"]')
      ?.addEventListener('click', (event) => this._openLibrary(event.currentTarget));

    this.quickBar.querySelector('[data-action="attach"]')?.addEventListener('click', () => {
      const pane = this.getActivePane();
      if (pane) this.onPickFiles(pane);
    });

    this.quickBar
      .querySelector('[data-action="expand-prompt"]')
      ?.addEventListener('click', () => this._expandPrompt());

    this.skipPermissionsButton = this.quickBar.querySelector('[data-action="skip-permissions"]');
    this.skipPermissionsButton?.addEventListener('click', () => {
      const pane = this.getActivePane();
      if (pane) this.onToggleSkipPermissions(pane);
    });
    this.refreshSkipPermissionsButton();
  }

  /** Dong bo icon nut bypass permissions voi trang thai cua pane dang active. */
  refreshSkipPermissionsButton() {
    if (!this.skipPermissionsButton) return;
    const pane = this.getActivePane();
    const on = Boolean(pane?.skipPermissions);
    this.skipPermissionsButton.classList.toggle('is-active', on);
    this.skipPermissionsButton.title = on
      ? 'Đang bỏ qua xin quyền (--dangerously-skip-permissions) - bấm để tắt cho dự án này'
      : 'Bật bỏ qua xin quyền (--dangerously-skip-permissions) cho dự án này';
  }

  // --- Hang lenh nhanh rieng cho tab SSH -------------------------------------

  /** Goi khi doi tab/pane - hien lenh nhanh cua may chu neu pane dang mo la ssh va co luu san. */
  async refreshSshBar() {
    if (!this.sshBar) return;
    const seq = ++this._sshBarSeq;
    const pane = this.getActivePane();

    if (!pane || pane.sessionType !== 'ssh' || !pane.sshHostId) {
      this.sshBar.classList.add('is-hidden');
      return;
    }

    const hosts = await window.api.ssh.list();
    if (seq !== this._sshBarSeq) return;

    const host = hosts.find((h) => h.id === pane.sshHostId);
    if (!host?.commands?.length) {
      this.sshBar.classList.add('is-hidden');
      return;
    }

    const { escapeHtml } = window.formatUtils;
    this.sshBar.classList.remove('is-hidden');
    this.sshBar.innerHTML = host.commands
      .map(
        (c) =>
          `<button class="quick-chip quick-chip-ssh" data-cmd="${escapeHtml(c.cmd)}" title="${escapeHtml(c.cmd)}">${escapeHtml(c.label)}</button>`,
      )
      .join('');

    for (const button of this.sshBar.querySelectorAll('[data-cmd]')) {
      button.addEventListener('click', () => this.sendToActivePane(button.dataset.cmd));
    }
  }

  // --- Thu vien prompt ---------------------------------------------------------

  /**
   * Chen (khong tu gui Enter) mot prompt tu thu vien, thay cac bien co san
   * bang gia tri thuc te cua pane dang lam viec.
   */
  async _insertLibraryItem(item) {
    const pane = this.getActivePane();
    if (!pane) return;

    let text = item.text;
    if (text.includes('{{cwd}}')) {
      text = text.replaceAll('{{cwd}}', window.formatUtils.baseName(pane.cwd) || '');
    }
    if (text.includes('{{date}}')) {
      text = text.replaceAll('{{date}}', new Date().toLocaleDateString('vi-VN'));
    }
    if (text.includes('{{branch}}')) {
      const branch = await window.api.git.branch(pane.cwd);
      text = text.replaceAll('{{branch}}', branch || '');
    }
    this.sendToActivePane(text, { submit: false });
  }

  _openLibrary(anchor) {
    const existing = document.querySelector('.prompt-library-menu');
    if (existing) {
      existing.remove();
      return;
    }

    const { escapeHtml } = window.formatUtils;
    const menu = document.createElement('div');
    menu.className = 'account-menu prompt-library-menu';
    menu.innerHTML = `
      <div class="account-key">Thư viện prompt</div>
      <input class="field-input prompt-library-search" placeholder="Tìm..." />
      <div class="prompt-library-list"></div>
      <div class="usage-note">Biến dùng được: {{cwd}}, {{branch}}, {{date}}. Bấm để chèn (không tự gửi).</div>
      <button class="btn btn-ghost" data-action="add-prompt">+ Thêm prompt</button>
      <div class="prompt-library-add is-hidden">
        <input class="field-input prompt-add-group" placeholder="Nhóm (tuỳ chọn)" />
        <textarea class="quick-edit-textarea prompt-add-text" rows="3" placeholder="Nội dung prompt..."></textarea>
        <div class="quick-edit-actions">
          <button class="btn" data-action="cancel-add">Huỷ</button>
          <button class="btn btn-primary" data-action="save-add">Lưu</button>
        </div>
      </div>`;
    document.body.append(menu);

    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 6}px`;

    const listEl = menu.querySelector('.prompt-library-list');
    const renderList = (query = '') => {
      const q = query.trim().toLowerCase();
      const filtered = this.library.filter(
        (item) => !q || item.text.toLowerCase().includes(q) || item.group.toLowerCase().includes(q),
      );
      listEl.innerHTML = filtered.length
        ? filtered
            .map(
              (item) => `
          <div class="prompt-library-row" data-id="${escapeHtml(item.id)}">
            ${item.group ? `<span class="prompt-library-group">${escapeHtml(item.group)}</span>` : ''}
            <button class="prompt-library-text" data-act="insert">${escapeHtml(item.text)}</button>
            <button class="icon-btn" data-act="delete" title="Xoá">${window.icons.svg('x', { size: 12 })}</button>
          </div>`,
            )
            .join('')
        : `<div class="sidebar-empty">Chưa có prompt nào.</div>`;

      listEl.querySelectorAll('[data-act="insert"]').forEach((button) => {
        button.addEventListener('click', () => {
          const item = this.library.find((i) => i.id === button.closest('[data-id]').dataset.id);
          if (item) this._insertLibraryItem(item);
        });
      });
      listEl.querySelectorAll('[data-act="delete"]').forEach((button) => {
        button.addEventListener('click', async () => {
          const id = button.closest('[data-id]').dataset.id;
          this.library = this.library.filter((i) => i.id !== id);
          await window.api.prefs.set({ promptLibrary: this.library });
          renderList(searchInput.value);
        });
      });
    };

    const searchInput = menu.querySelector('.prompt-library-search');
    searchInput.addEventListener('input', () => renderList(searchInput.value));
    renderList();
    searchInput.focus();

    const addPanel = menu.querySelector('.prompt-library-add');
    menu.querySelector('[data-action="add-prompt"]').addEventListener('click', () => {
      addPanel.classList.remove('is-hidden');
      addPanel.querySelector('.prompt-add-text').focus();
    });
    menu.querySelector('[data-action="cancel-add"]').addEventListener('click', () => {
      addPanel.classList.add('is-hidden');
    });
    menu.querySelector('[data-action="save-add"]').addEventListener('click', async () => {
      const text = addPanel.querySelector('.prompt-add-text').value.trim();
      if (!text) return;
      const group = addPanel.querySelector('.prompt-add-group').value.trim();
      this.library.push({ id: crypto.randomUUID(), group, text });
      await window.api.prefs.set({ promptLibrary: this.library });
      addPanel.classList.add('is-hidden');
      addPanel.querySelector('.prompt-add-text').value = '';
      addPanel.querySelector('.prompt-add-group').value = '';
      renderList(searchInput.value);
    });

    const closeOnOutside = (event) => {
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
  }

  /**
   * Chup man hinh bang cong cu goc cua Windows (Win+Shift+S) roi tu dan
   * duong dan anh vao terminal - danh cho 592/3810 prompt that co dan anh
   * (15,5%), phan lon la anh chup man hinh dan tu clipboard co san.
   */
  async _captureScreenshot(button) {
    if (button.classList.contains('is-waiting')) return;

    const pane = this.getActivePane();
    if (!pane) return;

    button.classList.add('is-waiting');
    const originalTitle = button.title;
    button.title = 'Đang chờ bạn chọn vùng chụp trên màn hình (Esc để huỷ)...';

    try {
      const result = await window.api.clipboard.captureScreenshot();
      if (!result) return;

      this.onNeedTerminal();
      const quoted = /\s/.test(result.filePath) ? `"${result.filePath}"` : result.filePath;
      window.api.pty.write(pane.id, quoted);
      requestAnimationFrame(() => pane.term.focus());
      this._showScreenshotPreview(button, result.dataUrl);
    } finally {
      button.classList.remove('is-waiting');
      button.title = originalTitle;
    }
  }

  /** The nho xem truoc anh vua chup, tu bien mat sau vai giay - xac nhan dung anh da dan. */
  _showScreenshotPreview(anchor, dataUrl) {
    document.querySelector('.screenshot-preview')?.remove();

    const card = document.createElement('div');
    card.className = 'screenshot-preview';
    card.innerHTML = `
      <img src="${dataUrl}" alt="Ảnh vừa chụp" />
      <span>Đã dán ảnh vào terminal</span>`;
    document.body.append(card);

    // Nut camera nam gan dinh man hinh - moc xuong duoi, khong moc len tren
    // (xem ghi chu tuong tu o _editItems).
    const rect = anchor.getBoundingClientRect();
    card.style.left = `${Math.max(8, rect.left)}px`;
    card.style.top = `${rect.bottom + 8}px`;

    card.addEventListener('click', () => card.remove());
    setTimeout(() => card.remove(), 4000);
  }

  /**
   * Doc dong con tro dang dung (dong nguoi dung go do, chua Enter) tu buffer
   * xterm, roi nho chinh Claude Code dang chay viet lai thanh mot prompt ro
   * rang/chi tiet hon.
   *
   * KHONG tu xoa dong dang go: da kiem chung bang CDP rang terminal khong the
   * biet chinh xac ranh gioi giua "prompt cua shell" (vd `PS C:\...>`) va
   * "phan nguoi dung go" - xoa bang Backspace/Ctrl+U deu co nguy co xoa qua
   * da vao ca prompt shell. Vi vay chi con cach an toan la CHOT dong dang go
   * (Enter that) roi hoi tiep - dong nghia dong goc CUNG duoc gui that, khong
   * chi la xem truoc.
   */
  _expandPrompt() {
    const pane = this.getActivePane();
    if (!pane) return;

    // Chi co y nghia trong phien Claude Code - tab shell/ssh tran hieu moi
    // dong go la LENH he dieu hanh, khong phai hoi thoai, nen se bao loi
    // "not recognized" thay vi tra loi nhu mong doi.
    if (pane.sessionType !== 'claude' && pane.sessionType !== 'claude-resume') {
      pane.term.write(
        '\r\n\x1b[31m--- chỉ dùng được trong tab Claude Code, không dùng được ở tab shell/SSH trần ---\x1b[0m\r\n',
      );
      return;
    }

    const buffer = pane.term.buffer.active;
    const cursorAbsoluteY = buffer.baseY + buffer.cursorY;
    const draft = buffer.getLine(cursorAbsoluteY)?.translateToString(true).trim();
    if (!draft) return;

    this.onNeedTerminal();
    window.api.pty.write(pane.id, '\r');
    window.api.pty.write(
      pane.id,
      `Viết lại yêu cầu vừa rồi thành một prompt rõ ràng, chi tiết, đầy đủ ngữ cảnh hơn cho lần hỏi sau - chỉ đề xuất cách hỏi tốt hơn, chưa cần thực hiện ngay.\r`,
    );
    requestAnimationFrame(() => pane.term.focus());
  }

  /**
   * `window.prompt()` khong duoc Electron ho tro (bi chan mac dinh, bam nut
   * sua truoc day chi bao loi im lang trong console) - dung mot menu noi
   * dung textarea, giong cach `.account-menu`/`.model-menu` da lam.
   */
  _editItems(anchor) {
    const existing = document.querySelector('.quick-edit-menu');
    if (existing) {
      existing.remove();
      return;
    }

    const { escapeHtml } = window.formatUtils;
    const menu = document.createElement('div');
    menu.className = 'account-menu quick-edit-menu';
    menu.innerHTML = `
      <div class="account-key">Sửa nút gõ nhanh</div>
      <textarea class="quick-edit-textarea" rows="6">${escapeHtml(this.items.join('\n'))}</textarea>
      <div class="usage-note">Mỗi dòng một nút, tối đa 10 nút. Xoá hết để quay lại mặc định.</div>
      <div class="quick-edit-actions">
        <button class="btn" data-action="cancel">Huỷ</button>
        <button class="btn btn-primary" data-action="save">Lưu</button>
      </div>`;
    document.body.append(menu);

    // Nut sua nam gan dinh man hinh (hang go nhanh o tren cung terminal),
    // khac voi nut tai khoan/model o thanh trang thai duoi cung - phai moc
    // XUONG duoi nut thay vi moc len tren nhu .account-menu/.model-menu,
    // neu khong menu se bi day ra ngoai mep tren.
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 6}px`;

    const textarea = menu.querySelector('.quick-edit-textarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    menu.querySelector('[data-action="cancel"]').addEventListener('click', () => menu.remove());

    menu.querySelector('[data-action="save"]').addEventListener('click', () => {
      const parsed = textarea.value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 10);

      this.items = parsed.length ? parsed : [...DEFAULT_QUICK_ITEMS];
      window.api.prefs.set({ quickItems: this.items });
      this.renderQuickBar();
      menu.remove();
    });

    // Enter luu, Shift+Enter xuong dong - khop thoi quen go textarea thong thuong.
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        menu.querySelector('[data-action="save"]').click();
      } else if (event.key === 'Escape') {
        menu.remove();
      }
    });

    const closeOnOutside = (event) => {
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
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
