'use strict';

/**
 * Nut tai khoan tren thanh trang thai va menu di kem.
 *
 * Nguyen tac: app KHONG tu lam viec dang nhap. Khong co o nhap email/mat khau
 * nao o day - Claude Code dang nhap bang OAuth qua trinh duyet, va mot ung dung
 * ben thu ba hoi mat khau Anthropic la mo hinh lua dao. Menu nay chi:
 *   - hien thong tin KHONG bi mat doc tu .credentials.json (goi, han muc, han token)
 *   - go `/login` hoac `/logout` xuong terminal de chinh Claude Code xu ly
 *   - doi giua cac ho so (thu muc cau hinh) bang cach khoi dong lai app
 */

/** Duoi nguong nay thi coi la sap het han, hien canh bao mau. */
const ACCESS_WARN_MINUTES = 30;

class AccountPanel {
  constructor({ button, label, usageButton, usageLabel, quickSend, onNeedTerminal }) {
    this.button = button;
    this.label = label;
    this.usageButton = usageButton;
    this.usageLabel = usageLabel;
    this.quickSend = quickSend;
    this.onNeedTerminal = onNeedTerminal || (() => {});

    this.status = { loggedIn: false };
    this.profiles = [];
    this.limits = null;
    this.local = null;

    this.button.addEventListener('click', () => this._toggleMenu());
    // Bam vao o muc dung cung mo menu tai khoan - moi chi tiet deu o do.
    this.usageButton?.addEventListener('click', () => this._toggleMenu());
  }

  async refresh() {
    this.status = await window.api.account.status();
    this._paintButton();
    await this.refreshUsage();
  }

  /**
   * Cap nhat muc su dung. Goi song song vi hai nguon doc lap nhau: han muc goi
   * ra mang, con context doc file.
   */
  async refreshUsage({ force = false } = {}) {
    if (!this.status.loggedIn) {
      this.usageButton?.classList.add('is-hidden');
      return;
    }

    const [limits, local] = await Promise.all([
      window.api.usage.limits(force),
      window.api.usage.local(force),
    ]);
    this.limits = limits;
    this.local = local;
    this._paintUsage();
  }

  _paintUsage() {
    if (!this.usageButton) return;

    const sessionPct = this.limits?.available ? this.limits.session?.pct : null;
    const contextPct = this.local?.context?.pct ?? null;

    if (sessionPct === null && contextPct === null) {
      this.usageButton.classList.add('is-hidden');
      return;
    }

    this.usageButton.classList.remove('is-hidden');

    // Hai con so khac ban chat nen ghi ro nhan, khong de nguoi doc phai doan.
    const parts = [];
    if (sessionPct !== null) parts.push(`phiên ${Math.round(sessionPct)}%`);
    if (contextPct !== null) parts.push(`ngữ cảnh ${Math.round(contextPct)}%`);
    this.usageLabel.textContent = parts.join(' · ');

    // To mau theo con so dang lo nhat trong hai.
    const worst = Math.max(sessionPct ?? 0, contextPct ?? 0);
    this.usageButton.classList.toggle('is-warning', worst >= 90);
    this.usageButton.classList.toggle('is-caution', worst >= 70 && worst < 90);

    this.usageButton.title = this.limits?.stale
      ? `Số liệu cũ (${this.limits.staleReason})`
      : 'Mức sử dụng — bấm để xem chi tiết';
  }

  _paintButton() {
    const s = this.status;

    if (!s.loggedIn) {
      this.label.textContent = 'chưa đăng nhập';
      this.button.classList.add('is-warning');
      this.button.title = 'Chưa đăng nhập Claude Code — bấm để đăng nhập';
      return;
    }

    // Nhan ngan gon: goi la thu nguoi dung quan tam nhat.
    this.label.textContent = s.subscriptionType || 'đã đăng nhập';

    // Chi canh bao khi refresh token sap het - luc do moi that su phai dang
    // nhap lai. Access token het han thi Claude Code tu lam moi duoc.
    this.button.classList.toggle('is-warning', Boolean(s.needsReloginSoon));
    this.button.title = s.needsReloginSoon
      ? `Cần đăng nhập lại trong ${s.refreshDaysLeft} ngày nữa`
      : 'Tài khoản Claude';
  }

  async _toggleMenu() {
    const existing = document.querySelector('.account-menu');
    if (existing) {
      existing.remove();
      return;
    }

    await this.refresh();
    this.profiles = await window.api.account.listProfiles();
    // Chi phi hom nay tinh nen o main; lan mo menu dau tien co the chua co.
    if (!this.local?.today) {
      window.api.usage.local().then((local) => {
        this.local = local;
        const menu = document.querySelector('.account-menu');
        if (!menu) return;
        menu.innerHTML = this._menuHtml();
        this._bindMenu(menu);
      });
    }

    const menu = document.createElement('div');
    menu.className = 'account-menu';
    menu.innerHTML = this._menuHtml();
    document.body.append(menu);

    const rect = this.button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;

    this._bindMenu(menu);

    const closeOnOutside = (event) => {
      if (menu.contains(event.target) || this.button.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
  }

  _menuHtml() {
    const { escapeHtml } = window.formatUtils;
    const s = this.status;

    const statusBlock = s.loggedIn
      ? `<div class="account-row">
           <span class="account-key">Gói</span>
           <span class="account-val">${escapeHtml(s.subscriptionType || '—')}</span>
         </div>
         <div class="account-row">
           <span class="account-key">Hạn mức</span>
           <span class="account-val">${escapeHtml(s.rateLimitTier || '—')}</span>
         </div>
         ${
           // Claude Code khong phai luc nao cung ghi organizationUuid khi lam
           // moi token, nen thieu la binh thuong - an han thay vi hien dau gach.
           s.organization
             ? `<div class="account-row">
                  <span class="account-key">Tổ chức</span>
                  <span class="account-val">${escapeHtml(s.organization)}</span>
                </div>`
             : ''
         }
         <div class="account-row">
           <span class="account-key">Phiên đăng nhập</span>
           <span class="account-val">${escapeHtml(this._refreshText(s))}</span>
         </div>`
      : `<div class="account-empty">Chưa đăng nhập. Bấm "Đăng nhập" để Claude Code mở trình duyệt xác thực.</div>`;

    const profileRows = this.profiles
      .map(
        (profile) => `
        <div class="account-profile${profile.isActive ? ' is-active' : ''}">
          <button class="account-profile-main" data-switch="${escapeHtml(profile.configDir)}"
                  title="${escapeHtml(profile.configDir)}" ${profile.isActive ? 'disabled' : ''}>
            <span class="account-profile-name">${escapeHtml(profile.name)}</span>
            <span class="account-profile-sub">${
              profile.account.loggedIn
                ? escapeHtml(profile.account.subscriptionType || 'đã đăng nhập')
                : 'chưa đăng nhập'
            }${profile.isActive ? ' · đang dùng' : ''}</span>
          </button>
          ${
            profile.builtIn
              ? ''
              : `<button class="icon-btn" data-remove="${escapeHtml(profile.id)}" title="Xoá hồ sơ khỏi danh sách (không xoá thư mục)">${window.icons.svg('x', { size: 12 })}</button>`
          }
        </div>`,
      )
      .join('');

    return `
      <div class="account-section">${statusBlock}</div>

      ${this._usageHtml()}

      <div class="account-actions">
        <button class="btn btn-primary" data-action="login">
          ${window.icons.svg('user')} ${s.loggedIn ? 'Đăng nhập lại' : 'Đăng nhập'}
        </button>
        ${s.loggedIn ? `<button class="btn" data-action="logout">Đăng xuất</button>` : ''}
      </div>

      <div class="account-divider"></div>

      <div class="account-section-title">Hồ sơ tài khoản</div>
      ${profileRows}
      <button class="btn btn-ghost account-add" data-action="add-profile">
        ${window.icons.svg('plus', { size: 12 })} Thêm hồ sơ...
      </button>
      <div class="account-note">Đổi hồ sơ sẽ khởi động lại ứng dụng để lịch sử và tài khoản khớp nhau.</div>`;
  }

  /**
   * Khoi muc su dung trong menu: han muc goi (goi API) va ngu canh (doc file).
   * Ve thanh phan tram de nhin la biet ngay, khong phai doc so.
   */
  _usageHtml() {
    const { escapeHtml, formatTokens } = window.formatUtils;
    const limits = this.limits;
    const local = this.local;
    if (!limits && !local) return '';

    const bar = (label, pct, note) => {
      if (pct === null || pct === undefined) return '';
      // Thanh cap o 100% de phan tram vuot khong tran ra ngoai khung.
      const width = Math.min(100, Math.max(0, pct));
      const level = pct >= 90 ? ' is-danger' : pct >= 70 ? ' is-caution' : '';
      return `
        <div class="usage-item">
          <div class="usage-head">
            <span class="usage-label">${escapeHtml(label)}</span>
            <span class="usage-pct${level}">${Math.round(pct)}%</span>
          </div>
          <div class="usage-track"><div class="usage-fill${level}" style="width:${width}%"></div></div>
          ${note ? `<div class="usage-note">${escapeHtml(note)}</div>` : ''}
        </div>`;
    };

    const rows = [];

    if (limits?.available) {
      rows.push(bar('Phiên 5 giờ', limits.session?.pct, this._resetText(limits.session?.resetsAt)));
      rows.push(bar('Tuần này', limits.weekly?.pct, this._resetText(limits.weekly?.resetsAt)));
      if (limits.weeklyOpus) rows.push(bar('Tuần này (Opus)', limits.weeklyOpus.pct, null));
    } else if (limits?.error) {
      rows.push(`<div class="usage-error">${escapeHtml(limits.error)}</div>`);
    }

    if (local?.context) {
      const ctx = local.context;
      // Vuot 100% la binh thuong voi phien dung cache dai - noi ro de khoi lo.
      const note =
        ctx.pct > 100
          ? `${formatTokens(ctx.tokens)} / 200K — vượt cửa sổ, nên /compact`
          : `${formatTokens(ctx.tokens)} / 200K`;
      rows.push(bar('Ngữ cảnh phiên đang chạy', ctx.pct, note));
    }

    const today = local?.today;
    const costRow = today
      ? `<div class="account-row">
           <span class="account-key">Hôm nay</span>
           <span class="account-val">${formatTokens(today.totalTokens)} token · ~$${today.costUsd.toFixed(2)}</span>
         </div>`
      : `<div class="account-row">
           <span class="account-key">Hôm nay</span>
           <span class="account-val">đang tính...</span>
         </div>`;

    if (!rows.filter(Boolean).length && !today) return '';

    return `
      <div class="account-divider"></div>
      <div class="account-section-title usage-title">
        <span>Mức sử dụng${limits?.stale ? ' · số liệu cũ' : ''}</span>
        <button class="icon-btn" data-action="refresh-usage" title="Cập nhật lại ngay">
          ${window.icons.svg('refresh', { size: 12 })}
        </button>
      </div>
      <div class="usage-list">${rows.filter(Boolean).join('')}</div>
      ${costRow}
      ${today?.truncated ? '<div class="usage-note">Phiên quá dài, số liệu có thể thiếu.</div>' : ''}`;
  }

  /** "reset lúc 19:30" - chi hien gio vi moc reset luon trong vong vai ngay. */
  _resetText(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return null;

    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const time = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return `reset lúc ${time}`;

    const day = date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    return `reset ${day} lúc ${time}`;
  }

  /** Mo ta thoi han con lai cua phien dang nhap, bang tieng Viet de doc. */
  _refreshText(status) {
    if (!status.refreshExpiresAt) return 'không rõ';
    const days = status.refreshDaysLeft;
    if (days === null) return 'không rõ';
    if (days < 0) return 'đã hết hạn';
    if (days === 0) return 'hết hạn hôm nay';
    return `còn ${days} ngày`;
  }

  _bindMenu(menu) {
    menu.querySelector('[data-action="refresh-usage"]')?.addEventListener('click', async () => {
      await this.refreshUsage({ force: true });
      menu.innerHTML = this._menuHtml();
      this._bindMenu(menu);
    });

    menu.querySelector('[data-action="login"]')?.addEventListener('click', () => {
      this._sendCommand('/login');
      menu.remove();
    });

    menu.querySelector('[data-action="logout"]')?.addEventListener('click', () => {
      this._sendCommand('/logout');
      menu.remove();
    });

    menu.querySelector('[data-action="add-profile"]')?.addEventListener('click', async () => {
      const name = window.prompt('Tên hồ sơ (ví dụ: Công việc, Cá nhân):', '');
      if (!name || !name.trim()) return;
      this.profiles = await window.api.account.addProfile(name.trim());
      menu.innerHTML = this._menuHtml();
      this._bindMenu(menu);
    });

    for (const button of menu.querySelectorAll('[data-switch]')) {
      button.addEventListener('click', async () => {
        const dir = button.dataset.switch;
        const ok = window.confirm(
          `Đổi sang hồ sơ này sẽ khởi động lại KLTERMINAL.\n\nCác phiên terminal đang chạy sẽ bị đóng. Tiếp tục?`,
        );
        if (!ok) return;
        await window.api.account.switchProfile(dir);
      });
    }

    for (const button of menu.querySelectorAll('[data-remove]')) {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        this.profiles = await window.api.account.removeProfile(button.dataset.remove);
        menu.innerHTML = this._menuHtml();
        this._bindMenu(menu);
      });
    }
  }

  /**
   * Go lenh xuong terminal dang chay. Dung lai co che cua quick-send: app chi
   * go chu, con viec xac thuc do chinh Claude Code lo.
   */
  _sendCommand(command) {
    this.onNeedTerminal();
    const sent = this.quickSend?.sendToActivePane(command);
    if (!sent) return;
    // Dang nhap/xuat xong thi trang thai doi; doc lai sau vai giay.
    setTimeout(() => this.refresh(), 4000);
  }
}

window.AccountPanel = AccountPanel;
