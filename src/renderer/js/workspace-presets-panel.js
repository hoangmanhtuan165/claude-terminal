'use strict';

/**
 * Menu "Không gian làm việc": lưu bộ tab hiện tại thành một tên, mở lại hàng
 * loạt sau này. Dùng mẫu popup giống tab-list-menu/account-menu đã có.
 */

class WorkspacePresetsPanel {
  constructor({ button, getTabsSnapshot, onRestore }) {
    this.button = button;
    this.getTabsSnapshot = getTabsSnapshot;
    this.onRestore = onRestore;
    this.presets = [];

    this.button?.addEventListener('click', () => this._toggleMenu());
  }

  async _toggleMenu() {
    const existing = document.querySelector('.workspace-presets-menu');
    if (existing) {
      existing.remove();
      return;
    }

    this.presets = await window.api.workspace.listPresets();
    const { escapeHtml } = window.formatUtils;

    const menu = document.createElement('div');
    menu.className = 'account-menu tab-list-menu workspace-presets-menu';
    menu.innerHTML = `
      <div class="account-key">Không gian làm việc</div>
      ${
        this.presets.length
          ? this.presets
              .map(
                (preset) => `
        <div class="tab-list-item" data-id="${escapeHtml(preset.id)}">
          <span class="tab-list-label">${escapeHtml(preset.name)}</span>
          <span class="account-key">${preset.tabs.length} tab</span>
          <span class="tab-close" role="button" data-act="delete" title="Xoá">${window.icons.svg('x', { size: 12 })}</span>
        </div>`,
              )
              .join('')
          : `<div class="sidebar-empty">Chưa lưu không gian nào.</div>`
      }
      <button class="btn btn-primary" data-action="save-current" style="width:100%;justify-content:center;margin-top:var(--sp-2)">
        + Lưu không gian hiện tại
      </button>`;
    document.body.append(menu);

    const rect = this.button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${rect.bottom + 6}px`;

    for (const row of menu.querySelectorAll('.tab-list-item')) {
      row.addEventListener('click', async (event) => {
        const id = row.dataset.id;
        if (event.target.closest('[data-act="delete"]')) {
          this.presets = await window.api.workspace.removePreset(id);
          row.remove();
          return;
        }
        const preset = this.presets.find((p) => p.id === id);
        menu.remove();
        if (preset) this.onRestore(preset);
      });
    }

    menu.querySelector('[data-action="save-current"]').addEventListener('click', () => {
      menu.remove();
      this._promptSaveCurrent();
    });

    const closeOnOutside = (event) => {
      if (menu.contains(event.target) || this.button.contains(event.target)) return;
      menu.remove();
      document.removeEventListener('mousedown', closeOnOutside, true);
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside, true), 0);
  }

  _promptSaveCurrent() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card" style="width:320px">
        <div class="modal-header"><h3>Lưu không gian làm việc</h3></div>
        <div class="modal-body">
          <input class="field-input" id="workspace-preset-name" placeholder="Tên (vd: Dự án X)" maxlength="60" />
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" data-action="cancel">Huỷ</button>
          <button class="btn btn-primary" data-action="save">Lưu</button>
        </div>
      </div>`;
    document.body.append(overlay);

    const input = overlay.querySelector('#workspace-preset-name');
    input.focus();

    const close = () => overlay.remove();
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('[data-action="cancel"]').addEventListener('click', close);

    const save = async () => {
      const name = input.value.trim();
      if (!name) return;
      await window.api.workspace.savePreset(name, this.getTabsSnapshot());
      close();
    };
    overlay.querySelector('[data-action="save"]').addEventListener('click', save);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
      else if (event.key === 'Escape') close();
    });
  }
}

window.WorkspacePresetsPanel = WorkspacePresetsPanel;
