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
    contextBarElement,
    bypassBannerElement,
    composerElement,
    quickBarElement,
    sshQuickBarElement,
    getActivePane,
    onPickFiles,
    onPasteInto,
    getReference,
    onSetPermissionMode,
    onNeedTerminal,
  }) {
    this.contextBar = contextBarElement;
    this.bypassBanner = bypassBannerElement || null;
    this.composer = composerElement || null;
    this.composerInput = this.composer?.querySelector('.composer-input') || null;
    this.quickBar = quickBarElement;
    this.sshBar = sshQuickBarElement || null;
    // Nut model va nhan model gio nam trong context bar, tao lai moi lan
    // renderContextBar - gan tai do, khong nhan tu ngoai nua.
    this.modelButton = null;
    this.modelLabel = null;
    this.getActivePane = getActivePane;
    this.onPickFiles = onPickFiles || (() => {});
    // (pane, insert) - dan clipboard (ca anh) vao noi `insert` chi dinh.
    this.onPasteInto = onPasteInto || (() => {});
    // (pane, filePath) -> chuoi tham chieu @... (tab SSH: upload truoc).
    this.getReference = getReference || ((_pane, filePath) => filePath);
    // (pane, mode) voi mode: 'ask' | 'auto' | 'bypass'.
    this.onSetPermissionMode = onSetPermissionMode || (() => {});
    this.onNeedTerminal = onNeedTerminal || (() => {});

    this.items = [...DEFAULT_QUICK_ITEMS];
    /** Thu vien prompt: { id, group, text } - text co the chua {{cwd}}/{{branch}}/{{date}}. */
    this.library = [];
    /** cwd -> nhan model da chon lan cuoi o du an do. */
    this.modelByCwd = {};
    // Tang moi lan doi tab, tranh phan hoi ssh.list() cham cua tab cu ghi de tab moi.
    this._sshBarSeq = 0;
    /** cwd (chu thuong) -> { branch, at } - nhanh git hien o context bar. */
    this._branchByCwd = new Map();
    this._branchCheckedAt = new Map();
    /** Cac lan gui tu o nhap, moi nhat cuoi - mui ten len de goi lai. */
    this._sentHistory = [];

    this._bindComposer();
  }

  // --- O nhap lenh -------------------------------------------------------------

  _bindComposer() {
    if (!this.composer) return;
    const input = this.composerInput;

    input.addEventListener('input', () => this._autosizeComposer());

    input.addEventListener('keydown', (event) => {
      // Go tieng Viet bang bo go co khung soan (IME): Enter dang chot chu,
      // khong duoc gui.
      if (event.isComposing) return;

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.sendComposer();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.getActivePane()?.term.focus();
        return;
      }
      // Mui ten len khi o trong: goi lai cau vua gui (giong lich su lenh).
      if (event.key === 'ArrowUp' && !input.value && this._sentHistory.length) {
        event.preventDefault();
        input.value = this._sentHistory[this._sentHistory.length - 1];
        this._autosizeComposer();
        return;
      }
      // Ctrl+V tu xu ly: clipboard co anh thi luu file + chen tham chieu @...
      // nhu terminal; trinh duyet tu dan chi biet chu.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'v') {
        const pane = this.getActivePane();
        if (!pane) return;
        event.preventDefault();
        this.onPasteInto(pane, (text) => this._insertText(text));
      }
    });

    this.composer.addEventListener('click', (event) => {
      const action = event.target.closest('[data-composer]')?.dataset.composer;
      if (!action) return;
      const pane = this.getActivePane();
      if (action === 'send') this.sendComposer();
      else if (action === 'attach' && pane) this.onPickFiles(pane, (text) => this._insertText(text));
      else if (action === 'screenshot') this._captureScreenshot(event.target.closest('button'));
      else if (action === 'expand') this._expandPrompt();
    });
  }

  /** O nhap cao theo noi dung, toi da ~6 dong roi cuon. */
  _autosizeComposer() {
    const input = this.composerInput;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }

  /** Chen chu tai vi tri con tro trong o nhap, tu them khoang cach hai ben. */
  _insertText(text) {
    const input = this.composerInput;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const pad = (s) => (s && !/\s$/.test(s) ? ' ' : '');
    const insert = `${pad(before)}${text}${after && !/^\s/.test(after) ? ' ' : ''}`;
    input.value = before + insert + after;
    const caret = (before + insert).length;
    input.setSelectionRange(caret, caret);
    input.focus();
    this._autosizeComposer();
  }

  /**
   * Gui noi dung o nhap xuong phien dang mo: dan (term.paste - co boc
   * bracketed-paste khi Claude Code bat, nen nhieu dong van la MOT tin nhan)
   * roi Enter. O trong thi chi gui Enter - tien cho cac hop "Enter to confirm".
   */
  sendComposer() {
    const pane = this.getActivePane();
    if (!pane || !this.composerInput) return false;

    const text = this.composerInput.value.replace(/\s+$/, '');
    this.onNeedTerminal();
    if (text) {
      pane.term.paste(text);
      this._sentHistory.push(text);
      if (this._sentHistory.length > 50) this._sentHistory.shift();
    }
    // Enter tach rieng sau mot nhip: mot so TUI (Claude Code) nhan dien "dang
    // dan" theo thoi gian - Enter dinh lien vao khoi dan co the bi coi la mot
    // phan noi dung chu khong phai lenh gui.
    setTimeout(() => window.api.pty.write(pane.id, '\r'), text ? 40 : 0);

    this.composerInput.value = '';
    this._autosizeComposer();
    this.composerInput.focus();
    return true;
  }

  /** Doi theo loai tab: nut "viet lai cau hoi" chi co nghia voi Claude/Grok. */
  renderComposer() {
    if (!this.composer) return;
    const pane = this.getActivePane();
    const type = pane?.sessionType || 'shell';
    const isAgent = type === 'claude' || type === 'claude-resume' || type === 'grok';
    this.composer.classList.toggle('is-disabled', !pane);
    const expand = this.composer.querySelector('[data-composer="expand"]');
    if (expand) expand.hidden = !isAgent;
    this.composerInput.placeholder = !pane
      ? 'Chưa có tab nào đang mở'
      : isAgent
        ? 'Hỏi Claude hoặc gõ lệnh /…'
        : type === 'ssh'
          ? 'Gõ lệnh cho máy chủ…'
          : 'Gõ lệnh…';
  }

  // --- Duong dan / nhanh git cho context bar -----------------------------------

  /** Rut gon thu muc nha thanh "~" cho de doc: C:\Users\ten\x -> ~\x. */
  _shortPath(cwd) {
    if (!cwd) return '';
    return String(cwd).replace(/^[A-Za-z]:\\Users\\[^\\]+/i, '~').replace(/^\/(home|Users)\/[^/]+/, '~');
  }

  /**
   * Lay nhanh git cua thu muc tab dang mo (bat dong bo) roi ve lai context bar
   * NEU co doi. Nho ket qua 5 giay de doi qua lai giua cac tab khong goi git
   * lien tuc; bo qua ket qua tra ve muon cua tab cu.
   */
  _refreshBranch(pane) {
    if (!pane?.cwd || pane.sessionType === 'ssh') return;
    const key = pane.cwd.toLowerCase();
    const checkedAt = this._branchCheckedAt.get(key) || 0;
    if (Date.now() - checkedAt < 5000) return;
    this._branchCheckedAt.set(key, Date.now());

    window.api.git
      .branch(pane.cwd)
      .then((branch) => {
        const next = branch || null;
        if (this._branchByCwd.get(key) === next) return;
        this._branchByCwd.set(key, next);
        if (this.getActivePane()?.cwd?.toLowerCase() === key) this.renderContextBar();
      })
      .catch(() => {});
  }

  async loadPrefs() {
    const prefs = await window.api.prefs.get();
    if (Array.isArray(prefs.quickItems) && prefs.quickItems.length) {
      this.items = prefs.quickItems;
    }
    this.library = Array.isArray(prefs.promptLibrary) ? prefs.promptLibrary : [];
    this.modelByCwd = prefs.modelByCwd && typeof prefs.modelByCwd === 'object' ? prefs.modelByCwd : {};
    this.renderQuickBar();
    this.renderContextBar();
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
            `<button class="quick-chip${text.startsWith('/') ? ' is-slash' : ''}" data-index="${index}" title="Gõ &quot;${escapeHtml(text)}&quot; xuống terminal">${escapeHtml(text)}</button>`,
        )
        .join('')}
      <button class="quick-chip quick-chip-icon" data-action="library" title="Thư viện prompt">
        ${window.icons.svg('book', { size: 13 })}
      </button>
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
      ?.addEventListener('click', (event) => this._editItems(event.currentTarget));

    this.quickBar
      .querySelector('[data-action="library"]')
      ?.addEventListener('click', (event) => this._openLibrary(event.currentTarget));

  }

  // --- Context bar -------------------------------------------------------------

  /**
   * Hang ngay tren terminal, noi dung DOI THEO LOAI TAB dang mo:
   * - claude/grok: ten phien, che do quyen (Hoi/Auto/Bypass), model, cong cu
   * - ssh        : ten may chu (lenh nhanh cua host nam o hang rieng ben duoi)
   * - shell      : chi duong dan
   * Ve lai toan bo moi lan doi tab hoac doi che do - re, va don gian hon giu
   * tung nut rieng le dong bo.
   */
  renderContextBar() {
    if (!this.contextBar) return;
    const { escapeHtml, baseName } = window.formatUtils;
    const pane = this.getActivePane();

    if (!pane) {
      this.contextBar.innerHTML = '';
      this.contextBar.dataset.mode = '';
      if (this.bypassBanner) this.bypassBanner.hidden = true;
      this.renderComposer();
      return;
    }

    const type = pane.sessionType || 'shell';
    const isAgent = type === 'claude' || type === 'claude-resume' || type === 'grok';
    const isClaude = type === 'claude' || type === 'claude-resume';
    const mode = pane.skipPermissions ? 'bypass' : pane.autoMode ? 'auto' : 'ask';
    this.contextBar.dataset.mode = isClaude ? mode : '';
    // Dai canh bao Bypass ngay duoi context bar - thay cho to do ca hang:
    // co chu noi ro hau qua, va chi hien khi that su dang bat.
    if (this.bypassBanner) this.bypassBanner.hidden = !(isClaude && mode === 'bypass');

    const label = type === 'ssh' ? pane.title : baseName(pane.cwd) || pane.cwd || 'home';
    const path = type === 'ssh' ? '' : this._shortPath(pane.cwd);
    const remembered = pane.cwd ? this.modelByCwd[pane.cwd.toLowerCase()] : null;
    const branch = pane.cwd ? this._branchByCwd.get(pane.cwd.toLowerCase()) : null;

    const seg = (m) => `segment${mode === m ? ` is-active is-${m}` : ''}`;

    this.contextBar.innerHTML = `
      <div class="ctx-left" title="${escapeHtml(pane.cwd || '')}">
        <span class="ctx-title">${escapeHtml(label)}</span>
        ${path ? `<span class="ctx-path">${escapeHtml(path)}</span>` : ''}
        ${branch ? `<span class="ctx-branch">${window.icons.svg('git-branch', { size: 11 })}${escapeHtml(branch)}</span>` : ''}
      </div>
      <div class="ctx-right">
        ${
          isClaude
            ? `<div class="segmented ctx-mode" role="radiogroup" aria-label="Chế độ quyền">
                 <button class="${seg('ask')}" role="radio" aria-checked="${mode === 'ask'}" data-mode="ask" title="Claude hỏi trước mỗi thao tác sửa file / chạy lệnh">Hỏi</button>
                 <button class="${seg('auto')}" role="radio" aria-checked="${mode === 'auto'}" data-mode="auto" title="--permission-mode auto: tự duyệt việc an toàn, vẫn hỏi khi rủi ro">Auto</button>
                 <button class="${seg('bypass')}" role="radio" aria-checked="${mode === 'bypass'}" data-mode="bypass" title="--dangerously-skip-permissions: KHÔNG hỏi gì cả, kể cả việc nguy hiểm">${window.icons.svg('bolt', { size: 12 })}Bypass</button>
               </div>
               <button class="ctx-model" data-action="model" title="Đổi model cho phiên Claude đang chạy">
                 ${window.icons.svg('cpu', { size: 13 })}<span class="ctx-model-label">${escapeHtml(remembered || 'model')}</span>${window.icons.svg('chevron-down', { size: 12 })}
               </button>`
            : ''
        }
      </div>`;

    this._refreshBranch(pane);
    this.renderComposer();

    this.modelButton = this.contextBar.querySelector('[data-action="model"]');
    this.modelLabel = this.contextBar.querySelector('.ctx-model-label');
    this.modelButton?.addEventListener('click', () => this._openModelMenu());

    for (const button of this.contextBar.querySelectorAll('[data-mode]')) {
      button.addEventListener('click', () => {
        if (button.dataset.mode === mode) return;
        this.onSetPermissionMode(pane, button.dataset.mode);
      });
    }


    // Chip go nhanh chi co y nghia khi phia kia la agent (Claude/Grok) - voi
    // shell tran "tiếp tục"/"ok" chi la lenh khong ton tai.
    this.quickBar.classList.toggle('is-hidden', !isAgent && type !== 'ssh');
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
      const reference = await this.getReference(pane, result.filePath);
      if (!reference) return;
      if (this.composerInput) this._insertText(reference);
      else {
        window.api.pty.write(pane.id, reference);
        requestAnimationFrame(() => pane.term.focus());
      }
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

    // Co ban nhap trong o nhap lenh: nho Claude viet lai CHINH ban nhap do ma
    // khong gui no di - nguoi dung doc goi y roi tu sua o nhap va gui that.
    const composerDraft = this.composerInput?.value.trim();
    if (composerDraft) {
      this.composerInput.value = `Viết lại yêu cầu sau thành một prompt rõ ràng, chi tiết, đầy đủ ngữ cảnh hơn - chỉ trả về đúng đoạn prompt đã viết lại, chưa thực hiện yêu cầu đó:\n\n${composerDraft}`;
      this.sendComposer();
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
    if (!this.modelLabel) return;
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

    // Nut model nam o context bar (gan dinh) - moc menu XUONG duoi nut, can
    // le phai de khong tran ra ngoai man hinh.
    const rect = this.modelButton.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 6}px`;

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
    if (this.modelLabel) this.modelLabel.textContent = label;
  }
}

window.QuickSend = QuickSend;
window.QUICK_MODEL_CHOICES = MODEL_CHOICES;
