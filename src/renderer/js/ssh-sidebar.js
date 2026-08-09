'use strict';

/**
 * Sidebar may chu SSH: danh sach ho so da luu (khong luu mat khau, xem
 * ssh-store.js phia main), ket noi/sua/xoa, va form them/sua trong modal.
 *
 * Danh sach phang, sap theo lan dung gan nhat - so luong may chu thuc te nho
 * (vai chuc la nhieu), khong can chia muc pin/hay-dung nhu sidebar du an.
 */

class SshSidebar {
  constructor({ element, onConnect, getOpenHostIds }) {
    this.element = element;
    this.onConnect = onConnect;
    this.getOpenHostIds = getOpenHostIds || (() => new Set());
    this.hosts = [];

    this._buildChrome();
  }

  _buildChrome() {
    this.element.innerHTML = `<div class="sidebar-list"></div>`;
    this.listElement = this.element.querySelector('.sidebar-list');
    this.listElement.innerHTML = `<div class="sidebar-empty">Đang tải...</div>`;
  }

  async reload() {
    this.hosts = await window.api.ssh.list();
    this.render();
  }

  render() {
    const { escapeHtml, formatRelative } = window.formatUtils;
    const openIds = this.getOpenHostIds();

    const sorted = [...this.hosts].sort((a, b) =>
      String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')),
    );

    const renderRow = (host) => {
      const isOpen = openIds.has(host.id);
      const target = [host.username, host.host].filter(Boolean).join('@') + (host.port !== 22 ? `:${host.port}` : '');
      const subtitle = host.lastUsedAt ? `${target} · dùng ${formatRelative(host.lastUsedAt)}` : target;

      return `
        <div class="project-row" data-id="${escapeHtml(host.id)}" title="${escapeHtml(target)}">
          <span class="project-dot${isOpen ? ' is-open' : ''}" title="${isOpen ? 'Đang có tab mở' : ''}"></span>
          <div class="project-info">
            <div class="project-name">${escapeHtml(host.name)}</div>
            <div class="project-sub">${escapeHtml(subtitle)}</div>
          </div>
          <div class="project-actions">
            <button class="icon-btn" data-act="connect" title="Kết nối">${window.icons.svg('play')}</button>
            <button class="icon-btn" data-act="sftp" title="Duyệt file (SFTP)">${window.icons.svg('sftp', { size: 13 })}</button>
            <button class="icon-btn" data-act="edit" title="Sửa">${window.icons.svg('pencil', { size: 13 })}</button>
            <button class="icon-btn" data-act="remove" title="Xoá">${window.icons.svg('x', { size: 12 })}</button>
          </div>
        </div>`;
    };

    this.listElement.innerHTML = [
      `<div class="sidebar-section">
         ${
           sorted.length
             ? sorted.map(renderRow).join('')
             : `<div class="sidebar-empty">Chưa lưu máy chủ SSH nào.</div>`
         }
       </div>`,
      `<div class="sidebar-section">
         <button class="btn btn-ghost" data-act="add-host" style="margin:0 var(--sp-2);width:calc(100% - var(--sp-4))">
           + Thêm máy chủ
         </button>
       </div>`,
    ].join('');

    this._bindListEvents();
  }

  _bindListEvents() {
    this.listElement.querySelector('[data-act="add-host"]')?.addEventListener('click', () => {
      this._openForm(null);
    });

    for (const row of this.listElement.querySelectorAll('.project-row')) {
      const id = row.dataset.id;
      const host = this.hosts.find((h) => h.id === id);
      if (!host) continue;

      row.addEventListener('click', (event) => {
        const action = event.target.closest('[data-act]')?.dataset.act;
        if (!action) return this._openForm(host);
        event.stopPropagation();

        if (action === 'connect') this.onConnect(host);
        else if (action === 'sftp') window.SftpBrowser.open(host);
        else if (action === 'edit') this._openForm(host);
        else if (action === 'remove') this._removeHost(host);
      });
    }
  }

  async _removeHost(host) {
    const ok = window.confirm(`Xoá hồ sơ máy chủ "${host.name}"? Không ảnh hưởng gì tới máy chủ thật, chỉ xoá khỏi danh sách này.`);
    if (!ok) return;
    this.hosts = await window.api.ssh.remove(host.id);
    this.render();
  }

  // --- Form them/sua ---------------------------------------------------------

  _openForm(host) {
    document.querySelector('.ssh-form-overlay')?.remove();
    const { escapeHtml } = window.formatUtils;
    const isEdit = Boolean(host);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay ssh-form-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <h3>${isEdit ? 'Sửa máy chủ' : 'Thêm máy chủ SSH'}</h3>
          <button class="icon-btn" data-act="close">${window.icons.svg('x', { size: 14 })}</button>
        </div>
        <div class="modal-body">
          <label class="field-label">Tên gợi nhớ
            <input class="field-input" data-f="name" value="${escapeHtml(host?.name || '')}" placeholder="VPS deploy" />
          </label>
          <label class="field-label">Host
            <input class="field-input" data-f="host" value="${escapeHtml(host?.host || '')}" placeholder="1.2.3.4 hoặc domain" />
          </label>
          <div class="field-row">
            <label class="field-label">Cổng
              <input class="field-input" data-f="port" type="number" min="1" max="65535" value="${host?.port || 22}" />
            </label>
            <label class="field-label">Người dùng
              <input class="field-input" data-f="username" value="${escapeHtml(host?.username || '')}" placeholder="root" />
            </label>
          </div>
          <label class="field-label">Khoá riêng (tuỳ chọn - không có thì gõ mật khẩu trong terminal)
            <div class="field-key-row">
              <input class="field-input" data-f="keyPath" readonly value="${escapeHtml(host?.keyPath || '')}" placeholder="Chưa chọn" />
              <button class="btn btn-ghost" data-act="browse-key">${window.icons.svg('key', { size: 13 })} Chọn tệp...</button>
              <button class="icon-btn" data-act="clear-key" title="Bỏ chọn khoá">${window.icons.svg('x', { size: 12 })}</button>
            </div>
          </label>
          <label class="toggle">
            <input type="checkbox" data-f="autoReconnect" ${host?.autoReconnect ? 'checked' : ''} /> Tự động kết nối lại khi mất mạng
          </label>
          <div class="ssh-forwards">
            <div class="ssh-forwards-header">
              <span>Chuyển tiếp cổng (tuỳ chọn)</span>
              <button class="icon-btn" data-act="add-forward" title="Thêm quy tắc">${window.icons.svg('plus', { size: 13 })}</button>
            </div>
            <div class="ssh-forwards-list"></div>
          </div>
          <div class="ssh-forwards">
            <div class="ssh-forwards-header">
              <span>Lệnh nhanh (hiện trong hàng gõ nhanh khi mở tab máy chủ này)</span>
              <button class="icon-btn" data-act="add-command" title="Thêm lệnh">${window.icons.svg('plus', { size: 13 })}</button>
            </div>
            <div class="ssh-commands-list"></div>
          </div>
        </div>
        <div class="modal-footer">
          ${isEdit ? '<button class="btn btn-ghost" data-act="delete" style="margin-right:auto;color:var(--danger)">Xoá máy chủ</button>' : ''}
          <button class="btn btn-ghost" data-act="cancel">Huỷ</button>
          <button class="btn btn-primary" data-act="save">Lưu</button>
        </div>
      </div>`;

    document.body.append(overlay);

    const forwardsList = overlay.querySelector('.ssh-forwards-list');
    const addForwardRow = (fwd = { type: 'L', localPort: '', remoteHost: 'localhost', remotePort: '' }) => {
      const row = document.createElement('div');
      row.className = 'ssh-forward-row';
      row.innerHTML = `
        <select class="field-input fwd-type">
          <option value="L" ${fwd.type === 'L' ? 'selected' : ''}>Local (-L)</option>
          <option value="R" ${fwd.type === 'R' ? 'selected' : ''}>Remote (-R)</option>
        </select>
        <input class="field-input fwd-local" type="number" placeholder="cổng local" value="${fwd.localPort || ''}" />
        <input class="field-input fwd-rhost" placeholder="host đích" value="${escapeHtml(fwd.remoteHost || 'localhost')}" />
        <input class="field-input fwd-rport" type="number" placeholder="cổng đích" value="${fwd.remotePort || ''}" />
        <button class="icon-btn" data-act="remove-forward">${window.icons.svg('x', { size: 12 })}</button>`;
      row.querySelector('[data-act="remove-forward"]').addEventListener('click', () => row.remove());
      forwardsList.append(row);
    };
    for (const fwd of host?.forwards || []) addForwardRow(fwd);

    const commandsList = overlay.querySelector('.ssh-commands-list');
    const addCommandRow = (command = { label: '', cmd: '' }) => {
      const row = document.createElement('div');
      row.className = 'ssh-command-row';
      row.innerHTML = `
        <input class="field-input cmd-label" placeholder="Tên (vd: Khởi động lại nginx)" value="${escapeHtml(command.label || '')}" />
        <input class="field-input cmd-cmd" placeholder="systemctl restart nginx" value="${escapeHtml(command.cmd || '')}" />
        <button class="icon-btn" data-act="remove-command">${window.icons.svg('x', { size: 12 })}</button>`;
      row.querySelector('[data-act="remove-command"]').addEventListener('click', () => row.remove());
      commandsList.append(row);
    };
    for (const command of host?.commands || []) addCommandRow(command);
    overlay.querySelector('[data-act="add-command"]').addEventListener('click', () => addCommandRow());

    const close = () => overlay.remove();
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('[data-act="close"]').addEventListener('click', close);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-act="add-forward"]').addEventListener('click', () => addForwardRow());

    overlay.querySelector('[data-act="browse-key"]').addEventListener('click', async () => {
      const filePath = await window.api.ssh.browseKey();
      if (filePath) overlay.querySelector('[data-f="keyPath"]').value = filePath;
    });
    overlay.querySelector('[data-act="clear-key"]').addEventListener('click', () => {
      overlay.querySelector('[data-f="keyPath"]').value = '';
    });

    if (isEdit) {
      overlay.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        close();
        await this._removeHost(host);
      });
    }

    overlay.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const get = (name) => overlay.querySelector(`[data-f="${name}"]`).value;
      const input = {
        name: get('name'),
        host: get('host'),
        port: Number(get('port')) || 22,
        username: get('username'),
        keyPath: get('keyPath') || null,
        autoReconnect: overlay.querySelector('[data-f="autoReconnect"]').checked,
        forwards: [...forwardsList.querySelectorAll('.ssh-forward-row')].map((row) => ({
          type: row.querySelector('.fwd-type').value,
          localPort: Number(row.querySelector('.fwd-local').value),
          remoteHost: row.querySelector('.fwd-rhost').value,
          remotePort: Number(row.querySelector('.fwd-rport').value),
        })),
        commands: [...commandsList.querySelectorAll('.ssh-command-row')].map((row) => ({
          label: row.querySelector('.cmd-label').value,
          cmd: row.querySelector('.cmd-cmd').value,
        })),
      };
      if (!input.host.trim()) {
        overlay.querySelector('[data-f="host"]').focus();
        return;
      }

      this.hosts = isEdit
        ? [...this.hosts.filter((h) => h.id !== host.id), await window.api.ssh.update(host.id, input)]
        : [...this.hosts, await window.api.ssh.add(input)];
      close();
      this.render();
    });
  }
}

window.SshSidebar = SshSidebar;
