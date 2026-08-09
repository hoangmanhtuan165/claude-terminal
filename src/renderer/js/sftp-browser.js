'use strict';

/**
 * Modal trình duyệt file SFTP cho một máy chủ SSH đã lưu.
 *
 * Kết nối SFTP hoàn toàn độc lập với tab terminal đang mở (nếu có) - tự mở
 * một phiên riêng bằng chính thông tin xác thực của hồ sơ, đóng lại khi đóng
 * modal.
 */

class SftpBrowser {
  static open(host) {
    new SftpBrowser(host)._open();
  }

  constructor(host) {
    this.host = host;
    this.connId = null;
    this.currentPath = '/';
  }

  async _open() {
    document.querySelector('.sftp-overlay')?.remove();

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay sftp-overlay';
    this.overlay.innerHTML = `
      <div class="modal-card sftp-modal">
        <div class="modal-header">
          <h3>Duyệt file — ${window.formatUtils.escapeHtml(this.host.name)}</h3>
          <button class="icon-btn" data-act="close">${window.icons.svg('x', { size: 14 })}</button>
        </div>
        <div class="sftp-toolbar">
          <div class="sftp-breadcrumb"></div>
          <div class="sftp-toolbar-actions">
            <button class="icon-btn" data-act="up" title="Lên thư mục cha">${window.icons.svg('chevron-up', { size: 14 })}</button>
            <button class="icon-btn" data-act="mkdir" title="Tạo thư mục mới">${window.icons.svg('plus', { size: 14 })}</button>
            <button class="icon-btn" data-act="upload" title="Tải lên file">${window.icons.svg('download', { size: 14 })}</button>
            <button class="icon-btn" data-act="refresh" title="Làm mới">${window.icons.svg('refresh', { size: 14 })}</button>
          </div>
        </div>
        <div class="sftp-list"><div class="sidebar-empty">Đang kết nối...</div></div>
        <div class="sftp-status"></div>
      </div>`;
    document.body.append(this.overlay);

    this.overlay.addEventListener('mousedown', (event) => {
      if (event.target === this.overlay) this._close();
    });
    this.overlay.querySelector('[data-act="close"]').addEventListener('click', () => this._close());
    this.overlay.querySelector('[data-act="up"]').addEventListener('click', () => this._navigateUp());
    this.overlay.querySelector('[data-act="mkdir"]').addEventListener('click', () => this._mkdir());
    this.overlay.querySelector('[data-act="upload"]').addEventListener('click', () => this._upload());
    this.overlay.querySelector('[data-act="refresh"]').addEventListener('click', () => this._reload());

    this._bindDrop();

    try {
      const { connId, homePath } = await window.api.sftp.connect(this.host.id);
      this.connId = connId;
      this.currentPath = homePath || '/';
      await this._reload();
    } catch (err) {
      this.overlay.querySelector('.sftp-list').innerHTML =
        `<div class="sidebar-empty">Không kết nối được: ${window.formatUtils.escapeHtml(err.message)}</div>`;
    }
  }

  _close() {
    if (this.connId) window.api.sftp.disconnect(this.connId);
    this.overlay.remove();
  }

  _setStatus(text, isError = false) {
    const el = this.overlay.querySelector('.sftp-status');
    el.textContent = text;
    el.classList.toggle('is-error', isError);
  }

  _joinPath(name) {
    return this.currentPath.endsWith('/') ? `${this.currentPath}${name}` : `${this.currentPath}/${name}`;
  }

  _navigateUp() {
    const parent = this.currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    this.currentPath = parent;
    this._reload();
  }

  async _reload() {
    const { escapeHtml, formatBytes, formatRelative } = window.formatUtils;
    const listEl = this.overlay.querySelector('.sftp-list');
    this.overlay.querySelector('.sftp-breadcrumb').textContent = this.currentPath;
    this._setStatus('Đang tải danh sách...');

    try {
      const entries = await window.api.sftp.list(this.connId, this.currentPath);
      this._setStatus(`${entries.length} mục`);

      listEl.innerHTML = entries.length
        ? entries
            .map(
              (entry) => `
        <div class="sftp-row" data-name="${escapeHtml(entry.name)}" data-dir="${entry.isDirectory}">
          <span class="sftp-row-icon">${window.icons.svg(entry.isDirectory ? 'folder' : 'sftp', { size: 14 })}</span>
          <span class="sftp-row-name">${escapeHtml(entry.name)}</span>
          <span class="sftp-row-size">${entry.isDirectory ? '' : formatBytes(entry.size)}</span>
          <span class="sftp-row-time">${formatRelative(new Date(entry.mtime).toISOString())}</span>
          <span class="sftp-row-actions">
            ${!entry.isDirectory ? `<button class="icon-btn" data-act="download" title="Tải xuống">${window.icons.svg('download', { size: 12 })}</button>` : ''}
            <button class="icon-btn" data-act="delete" title="Xoá">${window.icons.svg('x', { size: 12 })}</button>
          </span>
        </div>`,
            )
            .join('')
        : `<div class="sidebar-empty">Thư mục trống.</div>`;

      for (const row of listEl.querySelectorAll('.sftp-row')) {
        const name = row.dataset.name;
        const isDir = row.dataset.dir === 'true';

        row.addEventListener('dblclick', (event) => {
          if (event.target.closest('[data-act]')) return;
          if (isDir) {
            this.currentPath = this._joinPath(name);
            this._reload();
          } else {
            this._download(name);
          }
        });

        row.querySelector('[data-act="download"]')?.addEventListener('click', (event) => {
          event.stopPropagation();
          this._download(name);
        });
        row.querySelector('[data-act="delete"]')?.addEventListener('click', (event) => {
          event.stopPropagation();
          this._delete(name, isDir);
        });
      }
    } catch (err) {
      listEl.innerHTML = `<div class="sidebar-empty">Lỗi: ${escapeHtml(err.message)}</div>`;
      this._setStatus('');
    }
  }

  async _download(name) {
    this._setStatus(`Đang tải xuống ${name}...`);
    try {
      const result = await window.api.sftp.download(this.connId, this._joinPath(name), name);
      this._setStatus(result.ok ? `Đã lưu: ${result.filePath}` : '');
    } catch (err) {
      this._setStatus(`Lỗi tải xuống: ${err.message}`, true);
    }
  }

  async _delete(name, isDir) {
    const ok = window.confirm(`Xoá ${isDir ? 'thư mục' : 'file'} "${name}"? Không thể hoàn tác.`);
    if (!ok) return;
    try {
      const remotePath = this._joinPath(name);
      if (isDir) await window.api.sftp.rmdir(this.connId, remotePath);
      else await window.api.sftp.delete(this.connId, remotePath);
      this._reload();
    } catch (err) {
      this._setStatus(`Lỗi xoá: ${err.message}`, true);
    }
  }

  async _mkdir() {
    const name = window.prompt('Tên thư mục mới:', '');
    if (!name || !name.trim()) return;
    try {
      await window.api.sftp.mkdir(this.connId, this._joinPath(name.trim()));
      this._reload();
    } catch (err) {
      this._setStatus(`Lỗi tạo thư mục: ${err.message}`, true);
    }
  }

  async _upload(localPaths) {
    this._setStatus('Đang tải lên...');
    try {
      const result = await window.api.sftp.upload(this.connId, this.currentPath, localPaths);
      if (result.ok) this._setStatus(`Đã tải lên: ${result.uploaded.join(', ')}`);
      this._reload();
    } catch (err) {
      this._setStatus(`Lỗi tải lên: ${err.message}`, true);
    }
  }

  _bindDrop() {
    const listEl = this.overlay.querySelector('.sftp-list');
    listEl.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      listEl.classList.add('is-drop-target');
    });
    listEl.addEventListener('dragleave', () => listEl.classList.remove('is-drop-target'));
    listEl.addEventListener('drop', (event) => {
      event.preventDefault();
      listEl.classList.remove('is-drop-target');
      const paths = [...(event.dataTransfer?.files || [])]
        .map((file) => window.api.files.pathFor(file))
        .filter(Boolean);
      if (paths.length) this._upload(paths);
    });
  }
}

window.SftpBrowser = SftpBrowser;
