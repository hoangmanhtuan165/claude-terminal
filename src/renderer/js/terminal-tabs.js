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

/**
 * Bao "co ket qua moi" cho tab khong dang xem, khi no vua im lang du lau roi
 * co output tro lai - dau hieu mot lenh dai (npx tsc, npm run build, ssh
 * deploy...) vua chay xong. Khong the biet chinh xac ranh gioi lenh vi PTY
 * chi la luong byte thuan, khong co OSC133/shell-integration - day la uoc
 * luong dua tren khoang lang, du dung cho da so truong hop thuc te.
 */
const NOTIFY_QUIET_THRESHOLD_MS = 20_000;
/** Sau khi bao, phai im lang lai it nhat tung nay truoc khi bao lan tiep - tranh spam khi output do vang doan dai. */
const NOTIFY_REARM_QUIET_MS = 2_000;

/** So tab vua dong duoc giu de hoan tac (Ctrl+Shift+K) - moi vao la mot phan tu. */
const MAX_CLOSED_HISTORY = 10;

class TerminalTabs {
  constructor({ paneElement, stripElement, tabListButton, broadcastButton, themeManager, onChange }) {
    this.paneElement = paneElement;
    this.stripElement = stripElement;
    this.tabListButton = tabListButton;
    this.broadcastButton = broadcastButton;
    this.themeManager = themeManager;
    this.onChange = onChange || (() => {});

    /** id -> tab. Moi tab: { id, title, element, panes: [pane], activePaneId, splitRatio } */
    this.tabs = new Map();
    /** paneId -> pane, de tra cuu nhanh khi nhan su kien PTY. */
    this.panes = new Map();
    this.activeTabId = null;
    /** Ngan xep tab vua dong, moi nhat o cuoi - dung cho hoan tac (Ctrl+Shift+K). */
    this.closedHistory = [];
    // Co chu terminal, doc lap voi zoom toan bo giao dien - xem loadFontSize().
    this.fontSize = 13;
    // Gui dong thoi: moi ky tu go vao MOT pane ssh duoc lap lai sang TAT CA
    // pane ssh khac dang song - xem _broadcastToOtherSsh().
    this.broadcastMode = false;

    this.broadcastButton?.addEventListener('click', () => this.toggleBroadcastMode());

    this._bindPtyEvents();
    this._bindResize();
    this._bindTabListButton();

    // xterm ve mau len canvas nen phai duoc bao rieng khi theme doi.
    this.themeManager.onChange((palette) => {
      for (const pane of this.panes.values()) pane.term.options.theme = palette;
    });
  }

  // --- Vong doi -----------------------------------------------------------

  _bindPtyEvents() {
    window.api.pty.onData(({ tabId, data }) => {
      // `tabId` trong giao thuc PTY thuc chat la id cua pane.
      const pane = this.panes.get(tabId);
      if (!pane) return;
      pane.term.write(data);
      this._trackPaneActivity(pane);
    });

    window.api.pty.onExit(({ tabId, exitCode }) => {
      const pane = this.panes.get(tabId);
      if (!pane) return;
      pane.alive = false;
      pane.term.write(`\r\n\x1b[90m[phiên kết thúc, mã thoát ${exitCode}]\x1b[0m\r\n`);
      this._renderStrip();
    });
  }

  /**
   * Goi moi khi pane co output moi. Neu khoang lang truoc do du dai VA pane
   * dang khong duoc xem (tab khac dang mo, hoac ca cua so app khong duoc
   * focus), coi day la dau hieu mot lenh dai vua xong roi bao cho nguoi dung.
   */
  _trackPaneActivity(pane) {
    const now = Date.now();
    const quietFor = pane.lastOutputAt ? now - pane.lastOutputAt : Infinity;
    pane.lastOutputAt = now;

    if (pane.notifyArmed && quietFor >= NOTIFY_QUIET_THRESHOLD_MS && !this._isPaneVisible(pane)) {
      pane.notifyArmed = false;
      this._notifyPaneOutput(pane);
    }

    clearTimeout(pane.quietTimer);
    pane.quietTimer = setTimeout(() => {
      pane.notifyArmed = true;
    }, NOTIFY_REARM_QUIET_MS);
  }

  /** Pane dang thuc su hien tren man hinh VA cua so app dang duoc focus. */
  _isPaneVisible(pane) {
    if (!document.hasFocus()) return false;
    if (pane.tabId !== this.activeTabId) return false;
    const tab = this.tabs.get(pane.tabId);
    return tab?.activePaneId === pane.id;
  }

  _notifyPaneOutput(pane) {
    if (typeof Notification === 'undefined') return;

    const tab = this.tabs.get(pane.tabId);
    const title = tab?.title || 'Terminal';

    const show = () => {
      const notification = new Notification('Có kết quả mới', {
        body: title,
        silent: false,
      });
      notification.onclick = () => {
        window.api.app.focusWindow();
        this.activate(pane.tabId);
      };
    };

    if (Notification.permission === 'granted') show();
    else if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') show();
      });
    }
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

  // --- Co chu terminal (doc lap voi zoom giao dien) -------------------------

  async loadFontSize() {
    const prefs = await window.api.prefs.get();
    const n = Number(prefs.terminalFontSize);
    this.fontSize = Number.isFinite(n) ? Math.min(24, Math.max(9, n)) : 13;
  }

  _applyFontSize() {
    for (const pane of this.panes.values()) pane.term.options.fontSize = this.fontSize;
    this._fitActiveTab();
    window.api.prefs.set({ terminalFontSize: this.fontSize });
  }

  adjustFontSize(delta) {
    this.fontSize = Math.min(24, Math.max(9, this.fontSize + delta));
    this._applyFontSize();
  }

  resetFontSize() {
    this.fontSize = 13;
    this._applyFontSize();
  }

  // --- Gui dong thoi toi nhieu tab SSH ---------------------------------------

  /** Lap lai du lieu go vao tu mot pane ssh sang tat ca pane ssh khac dang song. */
  _broadcastToOtherSsh(sourcePaneId, data) {
    for (const [paneId, pane] of this.panes) {
      if (paneId === sourcePaneId) continue;
      if (pane.sessionType === 'ssh' && pane.alive) window.api.pty.write(paneId, data);
    }
  }

  toggleBroadcastMode() {
    if (!this.broadcastMode) {
      const aliveSshCount = [...this.panes.values()].filter((p) => p.alive && p.sessionType === 'ssh').length;
      if (aliveSshCount < 2) {
        window.alert('Cần ít nhất 2 tab SSH đang kết nối để bật gửi đồng thời.');
        return;
      }
      const ok = window.confirm(
        'Bật gửi lệnh đồng thời: mọi ký tự gõ vào MỘT tab SSH sẽ được gửi tới TẤT CẢ tab SSH khác đang mở. Cẩn thận với lệnh nguy hiểm (rm, reboot...). Bật?',
      );
      if (!ok) return;
    }

    this.broadcastMode = !this.broadcastMode;
    this.broadcastButton?.classList.toggle('is-active', this.broadcastMode);
    this._renderStrip();
  }

  // --- Tao pane ------------------------------------------------------------

  /**
   * Dung mot pane: vo boc DOM + instance xterm + PTY.
   * Chua goi `pty.create` o day - ham goi quyet dinh khi nao spawn.
   */
  _createPane(tab, { id, cwd, sessionType, resumeSessionId, sshHostId = null, resumeHint = null }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'terminal-pane-slot';
    wrapper.dataset.paneId = id;

    const term = new window.Terminal({
      fontFamily: 'Cascadia Mono, Consolas, Menlo, monospace',
      fontSize: this.fontSize,
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
    // Tu viet link provider thay vi dung WebLinksAddon truc tiep: addon do
    // quet TUNG DONG MAN HINH rieng le nen URL dai bi xuong dong (rat pho
    // bien voi link dang nhap OAuth) bi cat thanh hai lien ket rieng, sai khi
    // bam - xem terminal-links.js.
    term.registerLinkProvider(
      window.createTerminalLinkProvider(term, (uri) => window.api.app.openExternal(uri)),
    );

    /**
     * OSC 52: chuong trinh dang chay (vd `claude` tren VPS qua ssh, hoi "press
     * c to copy") tu ghi thang vao clipboard he thong qua chuoi dieu khien
     * nay, khong can nguoi dung tu bloi den. Chi GHI, khong bao gio tra loi
     * truy van doc lai (payload "?") - tranh mot chuong trinh tu xa doc trom
     * noi dung clipboard cua may that.
     */
    term.parser.registerOscHandler(52, (data) => {
      const separatorIndex = data.indexOf(';');
      const payload = separatorIndex === -1 ? '' : data.slice(separatorIndex + 1);
      if (!payload || payload === '?') return true;

      try {
        const binary = atob(payload);
        const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
        const text = new TextDecoder('utf-8').decode(bytes);
        if (text) window.api.clipboard.writeText(text);
      } catch {
        // Base64 khong hop le - bo qua, khong lam vo phien.
      }
      return true;
    });

    term.open(wrapper);
    term.onData((data) => {
      window.api.pty.write(id, data);
      if (this.broadcastMode && sessionType === 'ssh') this._broadcastToOtherSsh(id, data);
    });
    term.onResize(({ cols, rows }) => window.api.pty.resize(id, cols, rows));

    // Nut "cuon toi day" chi hien khi nguoi dung da cuon len xem lai lich su -
    // xterm khong tu bao khi dang o day, nen suy tu buffer.viewportY so voi
    // baseY (dong cuoi cung thuc su co the cuon toi).
    const scrollBtn = document.createElement('button');
    scrollBtn.className = 'pane-scroll-bottom icon-btn is-hidden';
    scrollBtn.title = 'Cuộn tới cuối';
    scrollBtn.innerHTML = window.icons.svg('chevron-down', { size: 14 });
    scrollBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      term.scrollToBottom();
    });
    wrapper.append(scrollBtn);
    term.onScroll(() => {
      const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
      scrollBtn.classList.toggle('is-hidden', atBottom);
    });

    // Khong dua vao su kien 'paste' cua trinh duyet - trong app nay no khong
    // bao gio ban ra du textarea dang focus dung (kiem chung rieng). Tu bat
    // Ctrl+V/Cmd+V va doc thang clipboard cua he thong thay vi cho su kien do.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const withCtrl = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (!withCtrl) return true;

      /**
       * Ctrl+Shift+C/V: sao chep/dan tuong minh, doc/ghi thang vao clipboard
       * he thong. Ctrl+C/V thuong GIU NGUYEN y nghia terminal chuan (Ctrl+C
       * ngat lenh dang chay, Ctrl+V dan qua nhanh o duoi) - khong doi, vi copy
       * qua Ctrl+C thuong (dua vao lenh "Sao chep" mac dinh cua Electron tren
       * vung chon) khong on dinh voi vung chon cua xterm (ve tren canvas,
       * khong phai vung chon DOM that).
       */
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        const selected = term.getSelection();
        if (selected) window.api.clipboard.writeText(selected);
        return false;
      }
      if (event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        this._pasteFromClipboard(pane);
        return false;
      }

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

    // Menu chuot phai: sao chep vung dang chon / dan - tuong minh va de tim
    // hon phim tat, dac biet huu ich khi Ctrl+C thuong dang ban de ngat lenh.
    wrapper.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      window.api.terminal.showContextMenu({ paneId: id, selectedText: term.getSelection() });
    });

    this._bindFileDrop(wrapper, id);

    const pane = {
      id,
      tabId: tab.id,
      cwd: cwd || null,
      sessionType,
      resumeSessionId: resumeSessionId || null,
      sshHostId: sshHostId || null,
      // Chi co khi pane nay vua duoc phuc hoi thanh shell tran nhung truoc do
      // (lan chay app truoc) la mot phien claude - dung de hien banner "Noi
      // tiep". Null hoa sau khi da noi tiep hoac bam bo qua.
      resumeHint: resumeHint && resumeHint.sessionType !== 'shell' ? resumeHint : null,
      resumeBanner: null,
      alive: false,
      element: wrapper,
      term,
      fitAddon,
      searchAddon,
      // Theo doi khoang lang de bao "co ket qua moi" - xem _trackPaneActivity.
      lastOutputAt: 0,
      notifyArmed: true,
      quietTimer: null,
      // terminal-find.js va exportActiveLog doc `title` tu pane dang focus.
      get title() {
        return tab.title;
      },
    };

    if (pane.resumeHint) this._showResumeBanner(pane);

    this.panes.set(id, pane);
    return pane;
  }

  /** Banner "Nối tiếp phiên claude" đè lên góc trên của pane vừa phục hồi thành shell trần. */
  _showResumeBanner(pane) {
    const banner = document.createElement('div');
    banner.className = 'pane-resume-banner';
    banner.innerHTML = `
      <span>Phiên claude trước đã đóng.</span>
      <button class="btn btn-primary" data-act="resume">Nối tiếp phiên claude</button>
      <button class="icon-btn" data-act="dismiss" title="Bỏ qua">${window.icons.svg('x', { size: 12 })}</button>`;

    banner.querySelector('[data-act="resume"]').addEventListener('click', (event) => {
      event.stopPropagation();
      this._resumePane(pane);
    });
    banner.querySelector('[data-act="dismiss"]').addEventListener('click', (event) => {
      event.stopPropagation();
      banner.remove();
      pane.resumeBanner = null;
      pane.resumeHint = null;
    });

    pane.element.prepend(banner);
    pane.resumeBanner = banner;
  }

  /**
   * Noi tiep dung phien claude cu cua mot pane vua phuc hoi. Uu tien
   * `resumeSessionId` da luu san (pane tung la claude-resume); neu pane tung
   * la claude thuong (khong ro id) thi tra cuu phien gan nhat cua cung thu
   * muc qua du lieu sidebar - giong het co che nut play tren sidebar.
   */
  async _resumePane(pane) {
    const hint = pane.resumeHint;
    if (!hint) return;

    let resumeSessionId = hint.resumeSessionId;
    if (!resumeSessionId) {
      const data = await window.api.projects.list();
      const match = [...data.pinned, ...data.recent].find(
        (p) => String(p.cwd).toLowerCase() === String(pane.cwd).toLowerCase(),
      );
      resumeSessionId = match?.lastSessionId || null;
    }

    if (!resumeSessionId) {
      pane.term.write('\r\n\x1b[31mKhông tìm thấy phiên cũ để nối tiếp cho thư mục này.\x1b[0m\r\n');
      return;
    }

    pane.resumeBanner?.remove();
    pane.resumeBanner = null;
    pane.resumeHint = null;
    pane.sessionType = 'claude-resume';
    pane.resumeSessionId = resumeSessionId;

    const tab = this.tabs.get(pane.tabId);
    if (tab && tab.panes[0]?.id === pane.id && !tab.renamedManually) {
      tab.title = `resume · ${window.formatUtils.baseName(pane.cwd)}`;
    }

    pane.term.write('\r\n\x1b[90m--- đang nối tiếp phiên claude cũ ---\x1b[0m\r\n\r\n');
    await this._startPane(pane);
    this._renderStrip();
    this._persist();
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
        sshHostId: pane.sshHostId,
        cols: pane.term.cols,
        rows: pane.term.rows,
      });
      pane.cwd = info.cwd;
      pane.alive = true;
      pane.skipPermissions = Boolean(info.skipPermissions);
      this._renderStrip();
    } catch (err) {
      pane.alive = false;
      pane.term.write(`\r\n\x1b[31mKhông mở được phiên: ${err.message}\x1b[0m\r\n`);
      this._renderStrip();
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

      const paths = files.map((file) => window.api.files.pathFor(file)).filter(Boolean);
      if (!paths.length) return;

      const pane = this.panes.get(paneId);
      if (pane?.sessionType === 'ssh' && pane.sshHostId) {
        this._uploadFilesToSsh(pane, paths);
        return;
      }

      const quoted = paths.map((filePath) => (/\s/.test(filePath) ? `"${filePath}"` : filePath));
      window.api.pty.write(paneId, quoted.join(' '));
      pane?.term.focus();
    });
  }

  /**
   * Keo-tha file vao tab dang ssh thi day thang len may chu (`scp`) thay vi
   * chi chen duong dan - go tay `scp` moi khi can day 1 file la thao tac lap
   * lai pho bien voi tab ssh, khac han tab shell (duong dan da du dung).
   */
  async _uploadFilesToSsh(pane, paths) {
    for (const filePath of paths) {
      const fileName = filePath.split(/[\\/]/).pop();
      pane.term.write(`\r\n\x1b[90m--- đang tải lên ${fileName}... ---\x1b[0m\r\n`);
      const result = await window.api.ssh.uploadFile(pane.sshHostId, filePath);
      if (result.ok) {
        pane.term.write(`\x1b[32m--- đã tải lên: ${result.remotePath} ---\x1b[0m\r\n`);
      } else {
        pane.term.write(`\x1b[31m--- lỗi tải lên ${fileName}: ${result.error} ---\x1b[0m\r\n`);
      }
    }
  }

  /**
   * PTY la luong van ban thuan: anh khong the "dan" thang byte vao duoc. Uu
   * tien anh truoc - neu clipboard co anh (vi du vua chup man hinh), luu ra
   * file PNG tam roi go duong dan file do vao terminal, giong cach VS Code xu
   * ly dan anh. Khong co anh thi dan van ban binh thuong.
   *
   * Dung term.paste() thay vi ghi thang qua pty.write(): paste() boc du lieu
   * trong chuoi bracketed-paste (ESC[200~...ESC[201~) khi CLI dang chay da bat
   * che do nay, giup no phan biet day la noi dung DAN chu khong phai go phim.
   *
   * Tab SSH: duong dan file tam chi ton tai tren may Windows cuc bo, tien
   * trinh Claude Code chay tren may chu remote khong doc duoc - phai scp file
   * len truoc (giong het co che keo-tha o _uploadFilesToSsh) roi dan duong
   * dan TREN MAY CHU, khong phai duong dan Windows.
   *
   * Tien to "@": Claude Code chi nhan mot chuoi la THAM CHIEU FILE (va doi
   * sang khung xem truoc anh) khi no bat dau bang "@" (cu phap @mention cua
   * chinh no) - mot duong dan tho, du hop le, van chi la text thuong. Vi
   * duong dan tam do app tu dat ten (khong co khoang trang) nen luon an toan
   * de gan "@" thang vao truoc, khong can bao ngoac kep.
   */
  async _pasteFromClipboard(pane) {
    const filePath = await window.api.clipboard.pasteImage();
    if (filePath) {
      if (pane.sessionType === 'ssh' && pane.sshHostId) {
        const fileName = filePath.split(/[\\/]/).pop();
        pane.term.write(`\r\n\x1b[90m--- đang tải ảnh lên ${fileName}... ---\x1b[0m\r\n`);
        const result = await window.api.ssh.uploadFile(pane.sshHostId, filePath);
        if (result.ok) {
          pane.term.paste(`@${result.remotePath}`);
        } else {
          pane.term.write(`\x1b[31m--- lỗi tải ảnh lên: ${result.error} ---\x1b[0m\r\n`);
        }
        return;
      }

      const reference = /\s/.test(filePath) ? `"${filePath}"` : `@${filePath}`;
      pane.term.paste(reference);
      return;
    }

    const text = await window.api.clipboard.readText();
    if (text) pane.term.paste(text);
  }

  /** Dan tu clipboard he thong vao dung pane theo id - dung cho muc "Dán" tren menu chuot phai. */
  pasteToPane(paneId) {
    const pane = this.panes.get(paneId);
    if (pane) this._pasteFromClipboard(pane);
  }

  // --- Tao tab -------------------------------------------------------------

  /**
   * `restoredScrollback` la noi dung cua phien truoc. Ve lai truoc khi spawn PTY
   * moi de nguoi dung thay lich su nam tren, phien moi noi tiep ben duoi.
   */
  async createTab({
    cwd,
    sessionType = 'shell',
    resumeSessionId = null,
    sshHostId = null,
    title = null,
    id = null,
    restoredScrollback = null,
    resumeHint = null,
  }) {
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
    const pane = this._createPane(tab, { id: tabId, cwd, sessionType, resumeSessionId, sshHostId, resumeHint });
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
    if (sessionType === 'ssh') return 'ssh';
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

  /**
   * Dong mot tab. `skipConfirm` dung khi loi goi da tu xac nhan (vi du dong
   * hang loat tu menu danh sach tab).
   *
   * Tab dang chay claude (song, sessionType claude/claude-resume) hoi lai truoc
   * khi dong - nham nut x tren tab claude dang lam do la mat het du dinh chua
   * luu vao lich su phien, khac voi tab shell tran it thiet hai hon.
   */
  async closeTab(tabId, { skipConfirm = false } = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const alivePane = tab.panes.find(
      (p) => p.alive && (p.sessionType === 'claude' || p.sessionType === 'claude-resume' || p.sessionType === 'ssh'),
    );
    if (alivePane && !skipConfirm) {
      const what = alivePane.sessionType === 'ssh' ? 'đang kết nối SSH' : 'đang chạy Claude';
      const ok = window.confirm(`Tab "${tab.title}" ${what}. Đóng tab này?`);
      if (!ok) return;
    }

    // Luu lai de hoan tac (Ctrl+Shift+K) truoc khi giet PTY - scrollback phai
    // doc luc pane van con song trong bo nho main.
    const closedSnapshot = {
      title: tab.title,
      panes: await Promise.all(
        tab.panes.map(async (pane) => {
          const persisted = this._persistedSession(pane);
          return {
            cwd: pane.cwd,
            sessionType: persisted.sessionType,
            sshHostId: persisted.sshHostId || null,
            scrollback: await window.api.scrollback.full(pane.id).catch(() => ''),
          };
        }),
      ),
      splitRatio: tab.splitRatio,
    };
    this.closedHistory.push(closedSnapshot);
    if (this.closedHistory.length > MAX_CLOSED_HISTORY) this.closedHistory.shift();

    for (const pane of tab.panes) {
      await window.api.pty.kill(pane.id);
      await window.api.scrollback.remove(pane.id);
      pane.term.dispose();
      clearTimeout(pane.quietTimer);
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
   * Mo lai tab vua dong gan nhat (Ctrl+Shift+K). PTY that su da bi giet luc
   * dong nen day la phien SHELL moi, chi noi lai dung thu muc + dan lai
   * scrollback cu len tren - giong het co che restore() sau khi khoi dong lai
   * app, khong tu dong chay `claude` de khong ton token ngoai y muon.
   */
  async reopenClosedTab() {
    const snapshot = this.closedHistory.pop();
    if (!snapshot) return null;

    const [first, ...restPanes] = snapshot.panes;
    if (!first) return null;

    const firstIsSsh = first.sessionType === 'ssh';
    const tab = await this.createTab({
      cwd: first.cwd,
      sessionType: firstIsSsh ? 'ssh' : 'shell',
      sshHostId: firstIsSsh ? first.sshHostId : null,
      title: snapshot.title,
      restoredScrollback: first.scrollback,
      resumeHint:
        !firstIsSsh && first.sessionType !== 'shell'
          ? { sessionType: first.sessionType, resumeSessionId: null }
          : null,
    });
    tab.renamedManually = true;

    if (restPanes.length && tab) {
      if (typeof snapshot.splitRatio === 'number') tab.splitRatio = snapshot.splitRatio;
      for (const second of restPanes) {
        const secondIsSsh = second.sessionType === 'ssh';
        const pane = this._createPane(tab, {
          id: crypto.randomUUID(),
          cwd: second.cwd,
          sessionType: secondIsSsh ? 'ssh' : 'shell',
          resumeSessionId: null,
          sshHostId: secondIsSsh ? second.sshHostId : null,
          resumeHint:
            !secondIsSsh && second.sessionType !== 'shell'
              ? { sessionType: second.sessionType, resumeSessionId: null }
              : null,
        });
        tab.panes.push(pane);
        this._layoutTab(tab);
        await this._startPane(pane, second.scrollback);
      }
      this._renderStrip();
      this._persist();
    }
    return tab;
  }

  /**
   * Danh sach tab hien tai, rut gon de luu thanh mot khong gian lam viec.
   * Chi lay pane DAU cua moi tab (bo qua pane thu hai neu dang chia doi) -
   * du de mo lai dung bo du an dang lam, khong can tai dung ca layout chia doi.
   */
  snapshotForPreset() {
    return [...this.tabs.values()].map((tab) => {
      const pane = tab.panes[0];
      return {
        cwd: pane?.cwd || null,
        sessionType: pane?.sessionType === 'claude-resume' ? 'claude' : pane?.sessionType || 'shell',
        sshHostId: pane?.sshHostId || null,
      };
    });
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
      const isSshTab = tab.panes.some((p) => p.sessionType === 'ssh');
      button.classList.toggle('is-broadcast-target', this.broadcastMode && isSshTab);
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

      // Nhay dup vao nhan de doi ten tab thu cong - tu do khong bi ghi de nua
      // (xem _defaultTitle/_persist: tab da doi ten thu cong khong con doi theo
      // sessionType khi nap phien khac).
      const label = button.querySelector('.tab-label');
      label.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        this._startRenameTab(tab, label);
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

  /** Thay nhan tab bang mot o nhap tai cho, luu ten khi Enter/mat focus. */
  _startRenameTab(tab, labelEl) {
    const input = document.createElement('input');
    input.className = 'tab-label-input';
    input.value = tab.title;
    input.maxLength = 80;
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const value = input.value.trim();
      if (value) {
        tab.title = value;
        tab.renamedManually = true;
      }
      this._renderStrip();
      this._persist();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = tab.title;
        input.blur();
      }
      event.stopPropagation();
    });
    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('click', (event) => event.stopPropagation());
  }

  /**
   * Nut mui ten canh dai tab: mo danh sach day du de nhay nhanh khi co nhieu
   * tab hon cho hien thi - luc do dai tab chi cuon ngang mu, khong co dau hieu
   * con tab nao ngoai vung nhin thay.
   */
  _bindTabListButton() {
    this.tabListButton?.addEventListener('click', () => this._toggleTabListMenu());
  }

  _toggleTabListMenu() {
    const existing = document.querySelector('.tab-list-menu');
    if (existing) {
      existing.remove();
      return;
    }
    if (!this.tabListButton || this.tabs.size === 0) return;

    const { escapeHtml } = window.formatUtils;
    const menu = document.createElement('div');
    menu.className = 'account-menu tab-list-menu';
    menu.innerHTML = [...this.tabs.values()]
      .map((tab) => {
        const firstPane = tab.panes[0];
        const anyAlive = tab.panes.some((p) => p.alive);
        return `
          <button class="tab-list-item${tab.id === this.activeTabId ? ' is-active' : ''}" data-tab-id="${tab.id}">
            <span class="tab-dot" data-type="${escapeHtml(firstPane?.sessionType || 'shell')}"></span>
            <span class="tab-list-label${anyAlive ? '' : ' is-dead'}">${escapeHtml(tab.title)}</span>
            <span class="tab-close" role="button" aria-label="Đóng tab" data-close-tab-id="${tab.id}">${window.icons.svg('x', { size: 12 })}</span>
          </button>`;
      })
      .join('');
    document.body.append(menu);

    const rect = this.tabListButton.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 6}px`;

    menu.addEventListener('click', (event) => {
      const closeId = event.target.closest('[data-close-tab-id]')?.dataset.closeTabId;
      if (closeId) {
        this.closeTab(closeId);
        menu.remove();
        return;
      }
      const tabId = event.target.closest('[data-tab-id]')?.dataset.tabId;
      if (tabId) {
        this.activate(tabId);
        menu.remove();
      }
    });

    const closeOnOutside = (event) => {
      if (menu.contains(event.target) || this.tabListButton.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
  }

  // --- Luu / khoi phuc -----------------------------------------------------

  /**
   * Loai phien de luu cho mot pane: neu pane con `resumeHint` (vua phuc hoi
   * thanh shell tran, nguoi dung chua bam "Noi tiep") thi phai luu lai DUNG
   * gia tri hint do, khong luu 'shell' dang chay that - neu khong, lan mo app
   * ke tiep se mat dau hoan toan rang pane nay tung la phien claude.
   */
  _persistedSession(pane) {
    // Phien ssh khong co "hint noi tiep" kieu claude - luu thang sessionType
    // that va sshHostId de restore()/reopenClosedTab() ket noi lai truc tiep,
    // khong ton phi gi khi tu dong ket noi lai (khac claude ton token).
    if (pane.sessionType === 'ssh') {
      return { sessionType: 'ssh', resumeSessionId: null, sshHostId: pane.sshHostId };
    }
    if (pane.resumeHint) return pane.resumeHint;
    return { sessionType: pane.sessionType, resumeSessionId: pane.resumeSessionId };
  }

  _persist() {
    window.api.tabs.save({
      tabs: [...this.tabs.values()].map((tab) => {
        const firstPane = tab.panes[0];
        const firstSession = firstPane ? this._persistedSession(firstPane) : { sessionType: 'shell', resumeSessionId: null };

        return {
          id: tab.id,
          title: tab.title,
          createdAt: tab.createdAt,
          splitRatio: tab.splitRatio,
          // Giu nguyen cac truong cu o cap tab (doc tu pane dau) de ban cu cua
          // app - chi biet mot terminal moi tab - van doc duoc file nay.
          cwd: firstPane?.cwd || null,
          sessionType: firstSession.sessionType,
          resumeSessionId: firstSession.resumeSessionId,
          sshHostId: firstSession.sshHostId || null,
          panes: tab.panes.map((pane) => ({
            id: pane.id,
            cwd: pane.cwd,
            sessionType: this._persistedSession(pane).sessionType,
            sshHostId: this._persistedSession(pane).sshHostId || null,
          })),
        };
      }),
      activeTabId: this.activeTabId,
    });
  }

  /**
   * Suy ra resumeHint tu du lieu da luu. Uu tien `sessionType`/`resumeSessionId`
   * that; nhung ban tabs.json tu truoc khi co tinh nang nay (hoac ghi de trong
   * luc restore-thanh-shell chay o giua chung) co the da mat sach sessionType
   * that (bi ghi de thanh 'shell'). Tieu de tab thi khong bi anh huong - van
   * con giu tien to "resume ·"/"claude ·" tu luc tao - dung no lam du hieu du
   * phong de khong bo lo cac tab do.
   */
  _inferResumeHint(saved) {
    if (saved.sessionType && saved.sessionType !== 'shell') {
      return { sessionType: saved.sessionType, resumeSessionId: saved.resumeSessionId || null };
    }
    const title = String(saved.title || '');
    if (title.startsWith('resume · ') || title.startsWith('claude · ')) {
      return { sessionType: 'claude-resume', resumeSessionId: null };
    }
    return { sessionType: 'shell', resumeSessionId: null };
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
      const isSsh = saved.sessionType === 'ssh';
      const tab = await this.createTab({
        id: saved.id,
        cwd: saved.cwd,
        // Luon khoi phuc thanh shell tran, TRU ssh: tu dong chay lai `claude`
        // hay `claude --resume` khi mo app se tieu ton token ngoai y muon
        // nguoi dung (nguoi dung tu bam "Noi tiep" tren banner - xem
        // resumeHint), nhung ket noi lai ssh khong ton phi gi nen cu ket
        // thang, giong dung ky vong cua tinh nang tu dong ket noi lai.
        sessionType: isSsh ? 'ssh' : 'shell',
        sshHostId: isSsh ? saved.sshHostId : null,
        title: saved.title,
        restoredScrollback: scrollback,
        resumeHint: isSsh ? null : this._inferResumeHint(saved),
      });

      // Dung lai pane thu hai neu lan truoc tab dang chia doi.
      const savedPanes = Array.isArray(saved.panes) ? saved.panes : [];
      if (savedPanes.length > 1 && tab) {
        if (typeof saved.splitRatio === 'number') tab.splitRatio = saved.splitRatio;
        const second = savedPanes[1];
        const secondIsSsh = second.sessionType === 'ssh';
        const pane = this._createPane(tab, {
          id: second.id,
          cwd: second.cwd,
          sessionType: secondIsSsh ? 'ssh' : 'shell',
          resumeSessionId: null,
          sshHostId: secondIsSsh ? second.sshHostId : null,
          // Pane thu hai khong co tieu de rieng de suy luan du phong nhu pane
          // dau (chi co sessionType) - _resumePane tu tra cuu phien gan nhat
          // cua thu muc nay khi thieu id cu the.
          resumeHint: secondIsSsh ? null : this._inferResumeHint(second),
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
