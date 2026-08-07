'use strict';

/**
 * Quan ly tab terminal: tao/dong/chuyen tab, gan xterm voi PTY o main process,
 * va khoi phuc lai tab cua lan chay truoc.
 *
 * Mot tab chua mot hoac hai PANE, moi pane la mot tien trinh PTY doc lap. Chia
 * doi de chay `claude` mot ben va lenh shell ben kia ma khong phai nhay tab.
 *
 * Quan he id: pane thu nhat luon mang dung id cua tab. Nho vay scrollback va
 * file tabs.json tu cac phien ban truoc (khi mot tab chi co mot terminal) van
 * khoi phuc dung, khong mat noi dung da luu.
 *
 * Instance xterm cua tab khong active van duoc giu nguyen trong DOM (chi an di)
 * de khong mat noi dung man hinh khi nguoi dung chuyen qua lai.
 */

/** Ty le be rong toi thieu cua mot pane khi keo vach chia. */
const MIN_PANE_RATIO = 0.15;

class TerminalTabs {
  constructor({ paneElement, stripElement, themeManager, onChange }) {
    this.paneElement = paneElement;
    this.stripElement = stripElement;
    this.themeManager = themeManager;
    this.onChange = onChange || (() => {});

    /** id -> tab. Moi tab: { id, title, element, panes: [pane], activePaneId, splitRatio } */
    this.tabs = new Map();
    /** paneId -> pane, de tra cuu nhanh khi nhan su kien PTY. */
    this.panes = new Map();
    this.activeTabId = null;

    this._bindPtyEvents();
    this._bindResize();

    // xterm ve mau len canvas nen phai duoc bao rieng khi theme doi.
    this.themeManager.onChange((palette) => {
      for (const pane of this.panes.values()) pane.term.options.theme = palette;
    });
  }

  // --- Vong doi -----------------------------------------------------------

  _bindPtyEvents() {
    window.api.pty.onData(({ tabId, data }) => {
      // `tabId` trong giao thuc PTY thuc chat la id cua pane.
      this.panes.get(tabId)?.term.write(data);
    });

    window.api.pty.onExit(({ tabId, exitCode }) => {
      const pane = this.panes.get(tabId);
      if (!pane) return;
      pane.alive = false;
      pane.term.write(`\r\n\x1b[90m[phiên kết thúc, mã thoát ${exitCode}]\x1b[0m\r\n`);
      this._renderStrip();
    });
  }

  _bindResize() {
    // Chi fit tab dang hien: do kich thuoc cua phan tu an luon ra 0, se lam
    // ConPTY nhan kich thuoc vo nghia.
    const observer = new ResizeObserver(() => this._fitActiveTab());
    observer.observe(this.paneElement);
  }

  /** Fit moi pane cua tab dang hien - chia doi thi ca hai deu phai do lai. */
  _fitActiveTab() {
    const tab = this.tabs.get(this.activeTabId);
    // offsetParent la null khi chinh no hoac mot to tien dang display:none.
    // Do kich thuoc luc do se ra 0 va lam ConPTY nhan gia tri vo nghia.
    if (!tab || !this.paneElement.offsetParent) return;

    for (const pane of tab.panes) this._fitPane(pane);
  }

  _fitPane(pane) {
    try {
      pane.fitAddon.fit();
      window.api.pty.resize(pane.id, pane.term.cols, pane.term.rows);
    } catch {
      // Fit that bai khi pane co kich thuoc 0 (dang chuyen man hinh) - bo qua.
    }
  }

  /** Goi khi man hinh terminal duoc hien lai, de xterm do lai kich thuoc dung. */
  handleShown() {
    requestAnimationFrame(() => {
      this._fitActiveTab();
      this.activePane?.term.focus();
    });
  }

  // --- Tao pane ------------------------------------------------------------

  /**
   * Dung mot pane: vo boc DOM + instance xterm + PTY.
   * Chua goi `pty.create` o day - ham goi quyet dinh khi nao spawn.
   */
  _createPane(tab, { id, cwd, sessionType, resumeSessionId }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'terminal-pane-slot';
    wrapper.dataset.paneId = id;

    const term = new window.Terminal({
      fontFamily: 'Cascadia Mono, Consolas, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 20000,
      theme: this.themeManager.terminalTheme(),
    });

    const fitAddon = new window.FitAddon.FitAddon();
    const searchAddon = new window.SearchAddon.SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(
      new window.WebLinksAddon.WebLinksAddon((_event, uri) => window.api.app.openExternal(uri)),
    );

    term.open(wrapper);
    term.onData((data) => window.api.pty.write(id, data));
    term.onResize(({ cols, rows }) => window.api.pty.resize(id, cols, rows));

    // Khong dua vao su kien 'paste' cua trinh duyet - trong app nay no khong
    // bao gio ban ra du textarea dang focus dung (kiem chung rieng). Tu bat
    // Ctrl+V/Cmd+V va doc thang clipboard cua he thong thay vi cho su kien do.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const withCtrl = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (!withCtrl) return true;

      if (event.key === 'v') {
        event.preventDefault();
        this._pasteFromClipboard(pane);
        return false;
      }

      // Ctrl+\ va Ctrl+] do accelerator cua menu xu ly (xem main.js). Chan o
      // day de ky tu khong bi gui xuong shell kem theo.
      if (event.key === '\\' || event.key === ']') return false;

      return true;
    });

    // Bam vao pane nao thi pane do thanh pane dang lam viec.
    wrapper.addEventListener('mousedown', () => this.focusPane(tab.id, id));

    this._bindFileDrop(wrapper, id);

    const pane = {
      id,
      tabId: tab.id,
      cwd: cwd || null,
      sessionType,
      resumeSessionId: resumeSessionId || null,
      alive: false,
      element: wrapper,
      term,
      fitAddon,
      searchAddon,
      // terminal-find.js va exportActiveLog doc `title` tu pane dang focus.
      get title() {
        return tab.title;
      },
    };

    this.panes.set(id, pane);
    return pane;
  }

  /** Spawn PTY that cho mot pane da dung xong DOM. */
  async _startPane(pane, restoredScrollback = null) {
    if (restoredScrollback) {
      pane.term.write(restoredScrollback);
      pane.term.write(
        '\r\n\x1b[90m--- hết lịch sử phiên trước, bên dưới là phiên mới ---\x1b[0m\r\n\r\n',
      );
    }

    try {
      pane.fitAddon.fit();
      const info = await window.api.pty.create({
        tabId: pane.id,
        cwd: pane.cwd,
        sessionType: pane.sessionType,
        resumeSessionId: pane.resumeSessionId,
        cols: pane.term.cols,
        rows: pane.term.rows,
      });
      pane.cwd = info.cwd;
      pane.alive = true;
      pane.skipPermissions = Boolean(info.skipPermissions);
      this._renderStrip();
    } catch (err) {
      pane.term.write(`\r\n\x1b[31mKhông mở được phiên: ${err.message}\x1b[0m\r\n`);
    }
  }

  /**
   * Keo-tha file/thu muc vao terminal thi chen duong dan cua no.
   *
   * Do tren 4044 prompt that: 772 prompt co chua duong dan Windows - go tay
   * hoac dan qua lai la viec lap di lap lai nhieu nhat sau cac cau ngan.
   *
   * Chi chen chu, KHONG tu gui Enter: duong dan gan nhu luon la mot phan cua
   * cau dai hon ("doc file X roi lam Y"), tu gui se cat ngang y nguoi dung.
   */
  _bindFileDrop(wrapper, paneId) {
    const stop = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    wrapper.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      stop(event);
      event.dataTransfer.dropEffect = 'copy';
      wrapper.classList.add('is-drop-target');
    });

    wrapper.addEventListener('dragleave', (event) => {
      // dragleave ban ca khi tro qua phan tu con ben trong; chi bo to sang khi
      // that su roi khoi vung pane.
      if (wrapper.contains(event.relatedTarget)) return;
      wrapper.classList.remove('is-drop-target');
    });

    wrapper.addEventListener('drop', (event) => {
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      stop(event);
      wrapper.classList.remove('is-drop-target');

      const paths = files
        .map((file) => window.api.files.pathFor(file))
        .filter(Boolean)
        // Duong dan co khoang trang phai boc ngoac kep moi chay duoc trong shell.
        .map((filePath) => (/\s/.test(filePath) ? `"${filePath}"` : filePath));

      if (!paths.length) return;
      window.api.pty.write(paneId, paths.join(' '));
      this.panes.get(paneId)?.term.focus();
    });
  }

  /**
   * PTY la luong van ban thuan: anh khong the "dan" thang byte vao duoc. Uu
   * tien anh truoc - neu clipboard co anh (vi du vua chup man hinh), luu ra
   * file PNG tam roi go duong dan file do vao terminal, giong cach VS Code xu
   * ly dan anh. Claude Code doc duong dan anh trong prompt va tu nhan no la
   * file dinh kem. Khong co anh thi dan van ban binh thuong.
   */
  async _pasteFromClipboard(pane) {
    const filePath = await window.api.clipboard.pasteImage();
    if (filePath) {
      const quoted = /\s/.test(filePath) ? `"${filePath}"` : filePath;
      window.api.pty.write(pane.id, quoted);
      return;
    }

    const text = await window.api.clipboard.readText();
    if (text) window.api.pty.write(pane.id, text);
  }

  // --- Tao tab -------------------------------------------------------------

  /**
   * `restoredScrollback` la noi dung cua phien truoc. Ve lai truoc khi spawn PTY
   * moi de nguoi dung thay lich su nam tren, phien moi noi tiep ben duoi.
   */
  async createTab({ cwd, sessionType = 'shell', resumeSessionId = null, title = null, id = null, restoredScrollback = null }) {
    const tabId = id || crypto.randomUUID();

    const tab = {
      id: tabId,
      title: title || this._defaultTitle(sessionType, cwd),
      createdAt: new Date().toISOString(),
      panes: [],
      activePaneId: null,
      // Ti le be rong pane trai khi chia doi.
      splitRatio: 0.5,
    };

    const container = document.createElement('div');
    container.className = 'terminal-instance';
    container.dataset.tabId = tabId;
    this.paneElement.append(container);
    tab.element = container;

    this.tabs.set(tabId, tab);

    // Pane dau tien mang dung id cua tab (xem ghi chu dau file).
    const pane = this._createPane(tab, { id: tabId, cwd, sessionType, resumeSessionId });
    tab.panes.push(pane);
    tab.activePaneId = pane.id;
    this._layoutTab(tab);

    this.activate(tabId);
    await this._startPane(pane, restoredScrollback);

    this._renderStrip();
    this._persist();
    this.onChange();
    return tab;
  }

  _defaultTitle(sessionType, cwd) {
    const folder = window.formatUtils.baseName(cwd) || 'home';
    if (sessionType === 'claude') return `claude · ${folder}`;
    if (sessionType === 'claude-resume') return `resume · ${folder}`;
    return `shell · ${folder}`;
  }

  // --- Chia doi ------------------------------------------------------------

  /**
   * Mo them mot pane ben canh pane dang focus. Mot tab toi da hai pane: chia
   * ba tro len tren man hinh thong thuong thi moi cot con qua hep de doc TUI
   * cua Claude Code.
   */
  async splitActiveTab({ sessionType = 'shell' } = {}) {
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.panes.length >= 2) return null;

    // Ke thua thu muc cua pane hien tai: chia doi gan nhu luon la de lam hai
    // viec trong cung mot du an.
    const current = this.panes.get(tab.activePaneId);
    const pane = this._createPane(tab, {
      id: crypto.randomUUID(),
      cwd: current?.cwd || null,
      sessionType,
      resumeSessionId: null,
    });

    tab.panes.push(pane);
    tab.activePaneId = pane.id;
    this._layoutTab(tab);
    this._paintPaneFocus(tab);

    await this._startPane(pane);

    // Pane cu bi hep lai nen phai bao kich thuoc moi cho ConPTY.
    this._fitActiveTab();
    requestAnimationFrame(() => pane.term.focus());

    this._renderStrip();
    this._persist();
    this.onChange();
    return pane;
  }

  /** Dong mot pane. Dong pane cuoi cung dong luon ca tab. */
  async closePane(paneId) {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    const tab = this.tabs.get(pane.tabId);
    if (!tab) return;

    if (tab.panes.length <= 1) {
      await this.closeTab(tab.id);
      return;
    }

    await window.api.pty.kill(paneId);
    await window.api.scrollback.remove(paneId);

    pane.term.dispose();
    pane.element.remove();
    this.panes.delete(paneId);
    tab.panes = tab.panes.filter((p) => p.id !== paneId);

    tab.activePaneId = tab.panes[0].id;
    this._layoutTab(tab);
    this._paintPaneFocus(tab);
    this._fitActiveTab();
    requestAnimationFrame(() => this.panes.get(tab.activePaneId)?.term.focus());

    this._renderStrip();
    this._persist();
    this.onChange();
  }

  /** Nhay qua lai giua hai pane cua tab dang mo. */
  focusOtherPane() {
    const tab = this.tabs.get(this.activeTabId);
    if (!tab || tab.panes.length < 2) return;

    const index = tab.panes.findIndex((p) => p.id === tab.activePaneId);
    const next = tab.panes[(index + 1) % tab.panes.length];
    this.focusPane(tab.id, next.id);
    next.term.focus();
  }

  focusPane(tabId, paneId) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.activePaneId === paneId) return;
    tab.activePaneId = paneId;
    this._paintPaneFocus(tab);
    this.onChange();
  }

  /**
   * Dung lai bo cuc cac pane trong mot tab.
   *
   * Vach chia la mot phan tu that (khong phai border) vi con phai keo duoc; be
   * rong hai ben tinh bang `flex-basis` theo ti le da luu.
   */
  _layoutTab(tab) {
    tab.element.classList.toggle('is-split', tab.panes.length > 1);

    // Chi go cac vach chia cu roi xep lai thu tu. TUYET DOI khong dung
    // innerHTML='' o day: lam vay se thao ca cay DOM ma xterm da dung ben
    // trong moi pane, khien terminal do trang du doi tuong JS van con song.
    for (const divider of [...tab.element.querySelectorAll(':scope > .pane-divider')]) {
      divider.remove();
    }

    tab.panes.forEach((pane, index) => {
      if (index > 0) tab.element.append(this._createDivider(tab));
      // append() tu di chuyen node neu no da nam trong cay, khong tao lai.
      tab.element.append(pane.element);
    });

    this._applySplitRatio(tab);
    this._paintPaneFocus(tab);
  }

  _applySplitRatio(tab) {
    if (tab.panes.length < 2) {
      if (tab.panes[0]) tab.panes[0].element.style.flexBasis = '';
      return;
    }
    const percent = Math.round(tab.splitRatio * 1000) / 10;
    tab.panes[0].element.style.flexBasis = `${percent}%`;
    tab.panes[1].element.style.flexBasis = `${100 - percent}%`;
  }

  _createDivider(tab) {
    const divider = document.createElement('div');
    divider.className = 'pane-divider';
    divider.title = 'Kéo để đổi tỉ lệ hai bên';

    divider.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const rect = tab.element.getBoundingClientRect();
      divider.classList.add('is-dragging');

      const onMove = (moveEvent) => {
        const ratio = (moveEvent.clientX - rect.left) / rect.width;
        tab.splitRatio = Math.min(1 - MIN_PANE_RATIO, Math.max(MIN_PANE_RATIO, ratio));
        this._applySplitRatio(tab);
      };

      const onUp = () => {
        divider.classList.remove('is-dragging');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Chi bao ConPTY mot lan luc tha chuot: bao lien tuc trong khi keo se
        // lam TUI ve lai lien mien va giat hinh.
        this._fitActiveTab();
        this._persist();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    return divider;
  }

  _paintPaneFocus(tab) {
    // Chi to vien khi that su co hai pane: mot pane thi vien chi la nhieu mat.
    const showFocus = tab.panes.length > 1;
    for (const pane of tab.panes) {
      pane.element.classList.toggle('is-focused', showFocus && pane.id === tab.activePaneId);
    }
  }

  // --- Chuyen / dong -------------------------------------------------------

  activate(tabId) {
    if (!this.tabs.has(tabId)) return;
    this.activeTabId = tabId;

    for (const [id, tab] of this.tabs) {
      tab.element.classList.toggle('is-active', id === tabId);
    }

    this._renderStrip();
    requestAnimationFrame(() => {
      this._fitActiveTab();
      this.activePane?.term.focus();
    });
    this._persist();
    this.onChange();
  }

  async closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    for (const pane of tab.panes) {
      await window.api.pty.kill(pane.id);
      await window.api.scrollback.remove(pane.id);
      pane.term.dispose();
      this.panes.delete(pane.id);
    }

    tab.element.remove();
    this.tabs.delete(tabId);

    if (this.activeTabId === tabId) {
      const next = [...this.tabs.keys()].pop() || null;
      this.activeTabId = next;
      if (next) this.activate(next);
    }

    this._renderStrip();
    this._persist();
    this.onChange();
  }

  /**
   * Pane dang lam viec cua tab dang mo.
   *
   * Tra ve PANE chu khong phai tab: terminal-find.js va exportActiveLog can
   * `term`, `searchAddon`, `id`, `cwd`, `title` - tat ca deu thuoc ve pane.
   */
  get activePane() {
    const tab = this.tabs.get(this.activeTabId);
    return tab ? this.panes.get(tab.activePaneId) || null : null;
  }

  get activeTab() {
    return this.activePane;
  }

  // --- Thanh tab -----------------------------------------------------------

  _renderStrip() {
    const { escapeHtml } = window.formatUtils;

    // Giu nguyen node chi-bao qua moi lan ve lai: tao moi se mat gia tri
    // transform cu, khong con gi de CSS transition "truot" tu do sang vi tri
    // moi - chi con hieu ung bat/tat cung.
    let indicator = this.stripElement.querySelector('.tab-active-indicator');
    this.stripElement.innerHTML = '';
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'tab-active-indicator';
    }

    for (const tab of this.tabs.values()) {
      const firstPane = tab.panes[0];
      const anyAlive = tab.panes.some((p) => p.alive);

      const button = document.createElement('button');
      button.className = 'tab';
      button.classList.toggle('is-active', tab.id === this.activeTabId);
      button.classList.toggle('is-dead', !anyAlive);
      const skipPermissions = tab.panes.some((p) => p.skipPermissions);
      button.title = [firstPane?.cwd, skipPermissions ? '⚠ --dangerously-skip-permissions' : '']
        .filter(Boolean)
        .join('\n');
      button.innerHTML = `
        <span class="tab-dot" data-type="${escapeHtml(firstPane?.sessionType || 'shell')}" data-skip="${skipPermissions}"></span>
        <span class="tab-label">${escapeHtml(tab.title)}</span>
        ${tab.panes.length > 1 ? `<span class="tab-split-badge" title="Tab này đang chia đôi">${window.icons.svg('split', { size: 11 })}</span>` : ''}
        <span class="tab-close" role="button" aria-label="Đóng tab">${window.icons.svg('x', { size: 12 })}</span>
      `;

      button.addEventListener('click', (event) => {
        if (event.target.closest('.tab-close')) {
          this.closeTab(tab.id);
          return;
        }
        this.activate(tab.id);
      });

      // Chuot giua la thao tac dong tab quen thuoc cua trinh duyet/terminal.
      button.addEventListener('auxclick', (event) => {
        if (event.button === 1) this.closeTab(tab.id);
      });

      this.stripElement.append(button);
    }

    this.stripElement.append(indicator);
    this._positionIndicator();
  }

  /** Truot thanh nen phia sau tab dang active toi vi tri/kich thuoc that. */
  _positionIndicator() {
    const indicator = this.stripElement.querySelector('.tab-active-indicator');
    const activeBtn = this.stripElement.querySelector('.tab.is-active');
    if (!indicator) return;

    if (!activeBtn) {
      indicator.style.opacity = '0';
      return;
    }

    indicator.style.opacity = '1';
    indicator.style.transform = `translate(${activeBtn.offsetLeft}px, ${activeBtn.offsetTop}px)`;
    indicator.style.width = `${activeBtn.offsetWidth}px`;
    indicator.style.height = `${activeBtn.offsetHeight}px`;
  }

  // --- Luu / khoi phuc -----------------------------------------------------

  _persist() {
    window.api.tabs.save({
      tabs: [...this.tabs.values()].map((tab) => ({
        id: tab.id,
        title: tab.title,
        createdAt: tab.createdAt,
        splitRatio: tab.splitRatio,
        // Giu nguyen cac truong cu o cap tab (doc tu pane dau) de ban cu cua
        // app - chi biet mot terminal moi tab - van doc duoc file nay.
        cwd: tab.panes[0]?.cwd || null,
        sessionType: tab.panes[0]?.sessionType || 'shell',
        resumeSessionId: tab.panes[0]?.resumeSessionId || null,
        panes: tab.panes.map((pane) => ({
          id: pane.id,
          cwd: pane.cwd,
          sessionType: pane.sessionType,
        })),
      })),
      activeTabId: this.activeTabId,
    });
  }

  /** Mo lai cac tab cua lan chay truoc; tra ve so tab da khoi phuc. */
  async restore() {
    const state = await window.api.tabs.load();
    if (!state.tabs.length) return 0;

    // Giu scrollback cua moi pane, khong chi pane dau tien.
    const liveIds = state.tabs.flatMap((tab) =>
      Array.isArray(tab.panes) && tab.panes.length ? tab.panes.map((p) => p.id) : [tab.id],
    );
    await window.api.tabs.pruneScrollback(liveIds);

    for (const saved of state.tabs) {
      const scrollback = await window.api.scrollback.restore(saved.id);
      const tab = await this.createTab({
        id: saved.id,
        cwd: saved.cwd,
        // Luon khoi phuc thanh shell tran. Tu dong chay lai `claude` hay
        // `claude --resume` khi mo app se tieu ton token ngoai y muon nguoi dung.
        sessionType: 'shell',
        title: saved.title,
        restoredScrollback: scrollback,
      });

      // Dung lai pane thu hai neu lan truoc tab dang chia doi.
      const savedPanes = Array.isArray(saved.panes) ? saved.panes : [];
      if (savedPanes.length > 1 && tab) {
        if (typeof saved.splitRatio === 'number') tab.splitRatio = saved.splitRatio;
        const second = savedPanes[1];
        const pane = this._createPane(tab, {
          id: second.id,
          cwd: second.cwd,
          sessionType: 'shell',
          resumeSessionId: null,
        });
        tab.panes.push(pane);
        this._layoutTab(tab);
        await this._startPane(pane, await window.api.scrollback.restore(second.id));
      }
    }

    if (state.activeTabId && this.tabs.has(state.activeTabId)) {
      this.activate(state.activeTabId);
    }
    return this.tabs.size;
  }
}

window.TerminalTabs = TerminalTabs;
