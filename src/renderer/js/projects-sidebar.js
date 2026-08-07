'use strict';

/**
 * Sidebar dự án.
 *
 * Danh sách dự án suy ra từ chính transcript đã lưu (trường `cwd`), nên mọi thư
 * mục từng chạy claude đều tự xuất hiện — không cần khai báo tay.
 *
 * Chia làm ba mục vì đo trên dữ liệu thật cho thấy 65/80 dự án chỉ có đúng một
 * phiên: để chung một danh sách thì 15 dự án thực sự hay dùng bị chìm mất.
 */

const FREQUENT_MIN_SESSIONS = 2;
const MAX_ONE_OFF_SHOWN = 40;

class ProjectsSidebar {
  constructor({ element, onOpenTerminal, onSelectProject }) {
    this.element = element;
    this.onOpenTerminal = onOpenTerminal;
    this.onSelectProject = onSelectProject;

    this.pinned = [];
    this.recent = [];
    this.selectedCwd = null;
    // Mục dự án dùng một lần thu gọn sẵn để không lấp mất phần hay dùng.
    this.collapsed = { oneOff: true };
  }

  async reload() {
    const data = await window.api.projects.list();
    this.pinned = data.pinned;
    this.recent = data.recent;
    this.render();
  }

  render() {
    const { escapeHtml, baseName, shortenPath, formatRelative } = window.formatUtils;

    const pinnedCwds = new Set(this.pinned.map((p) => p.cwd.toLowerCase()));
    const rest = this.recent.filter((p) => !pinnedCwds.has(String(p.cwd).toLowerCase()));

    const frequent = rest.filter((p) => (p.sessionCount || 0) >= FREQUENT_MIN_SESSIONS);
    const oneOff = rest.filter((p) => (p.sessionCount || 0) < FREQUENT_MIN_SESSIONS);

    const renderRow = (project, isPinned) => {
      const cwd = project.cwd;
      const isActive = this.selectedCwd && cwd.toLowerCase() === this.selectedCwd.toLowerCase();
      // `exists` vắng mặt (dữ liệu cũ trước khi có cờ này) thì coi như còn,
      // tránh cả sidebar xám đi vì một API cũ chưa kịp cập nhật.
      const isMissing = project.exists === false;

      const subtitle = isMissing
        ? 'Thư mục không còn tồn tại'
        : project.sessionCount
          ? `${project.sessionCount} phiên · ${formatRelative(project.lastUsedAt)}`
          : shortenPath(cwd, 34);

      return `
        <div class="project-row${isActive ? ' is-active' : ''}${isMissing ? ' is-missing' : ''}" data-cwd="${escapeHtml(cwd)}" title="${escapeHtml(cwd)}">
          <span class="project-dot"></span>
          <div class="project-info">
            <div class="project-name">${escapeHtml(baseName(cwd) || cwd)}</div>
            <div class="project-sub">${escapeHtml(subtitle)}</div>
          </div>
          <div class="project-actions">
            ${
              isMissing
                ? `<button class="icon-btn" data-act="hide" title="Ẩn khỏi danh sách (không xoá lịch sử)">${window.icons.svg('x', { size: 12 })}</button>`
                : `<button class="icon-btn" data-act="claude" title="Mở tab Claude ở đây">${window.icons.svg('play')}</button>
                   <button class="icon-btn${project.skipPermissions ? ' is-skip-on' : ''}" data-act="toggle-skip" title="${project.skipPermissions ? 'Đang bỏ qua xin quyền (--dangerously-skip-permissions) - bấm để tắt' : 'Bật bỏ qua xin quyền (--dangerously-skip-permissions) cho dự án này'}">${window.icons.svg('bolt', { size: 13, filled: Boolean(project.skipPermissions) })}</button>
                   <button class="icon-btn${isPinned ? ' is-pinned' : ''}" data-act="${isPinned ? 'unpin' : 'pin'}" title="${isPinned ? 'Bỏ ghim' : 'Ghim dự án'}">${window.icons.svg('pin', { filled: isPinned })}</button>`
            }
          </div>
        </div>`;
    };

    const section = ({ key, label, projects, isPinned, action, emptyText }) => {
      const isCollapsed = Boolean(this.collapsed[key]);
      const rows = isCollapsed
        ? ''
        : projects.length
          ? projects.map((p) => renderRow(p, isPinned)).join('')
          : `<div class="sidebar-empty">${escapeHtml(emptyText)}</div>`;

      return `
        <div class="sidebar-section">
          <button class="sidebar-heading${isCollapsed ? ' is-collapsed' : ''}" data-toggle="${key}">
            <span class="chevron">${window.icons.svg('chevron-down')}</span>
            <span>${escapeHtml(label)}</span>
            <span class="count">${projects.length}</span>
            ${action || ''}
          </button>
          ${rows}
        </div>`;
    };

    const missingCount = [...this.pinned, ...this.recent].filter((p) => p.exists === false).length;

    this.element.innerHTML = [
      section({
        key: 'pinned',
        label: 'Dự án ghim',
        projects: this.pinned,
        isPinned: true,
        emptyText: 'Chưa ghim dự án nào.',
      }),
      section({
        key: 'frequent',
        label: 'Hay dùng',
        projects: frequent,
        isPinned: false,
        emptyText: 'Chưa có dự án nào từ 2 phiên trở lên.',
      }),
      section({
        key: 'oneOff',
        label: 'Dùng một lần',
        projects: oneOff.slice(0, MAX_ONE_OFF_SHOWN),
        isPinned: false,
        emptyText: 'Không có.',
      }),
      `<div class="sidebar-section">
         <button class="btn btn-ghost" data-act="browse" style="margin:0 var(--sp-2);width:calc(100% - var(--sp-4))">
           + Thêm thư mục dự án
         </button>
         ${
           missingCount > 0
             ? `<button class="btn btn-ghost" data-act="prune-missing" style="margin:var(--sp-1) var(--sp-2) 0;width:calc(100% - var(--sp-4))">
                  Dọn ${missingCount} dự án đã mất
                </button>`
             : ''
         }
       </div>`,
    ].join('');

    this._bindEvents();
  }

  _bindEvents() {
    for (const heading of this.element.querySelectorAll('[data-toggle]')) {
      heading.addEventListener('click', () => {
        const key = heading.dataset.toggle;
        this.collapsed[key] = !this.collapsed[key];
        this.render();
      });
    }

    this.element.querySelector('[data-act="browse"]')?.addEventListener('click', async () => {
      const cwd = await window.api.projects.browse();
      if (!cwd) return;
      await window.api.projects.pin(cwd);
      await this.reload();
    });

    this.element.querySelector('[data-act="prune-missing"]')?.addEventListener('click', async () => {
      await window.api.projects.pruneMissing();
      await this.reload();
    });

    for (const row of this.element.querySelectorAll('.project-row')) {
      const cwd = row.dataset.cwd;

      row.addEventListener('click', (event) => {
        const action = event.target.dataset?.act;
        if (!action) {
          this.selectedCwd = cwd;
          this.render();
          this.onSelectProject(cwd);
          return;
        }
        event.stopPropagation();

        if (action === 'claude') {
          this.onOpenTerminal({ cwd, sessionType: 'claude' });
        } else if (action === 'pin') {
          window.api.projects.pin(cwd).then(() => this.reload());
        } else if (action === 'unpin') {
          window.api.projects.unpin(cwd).then(() => this.reload());
        } else if (action === 'hide') {
          window.api.projects.hide(cwd).then(() => this.reload());
        } else if (action === 'toggle-skip') {
          this._toggleSkipPermissions(cwd);
        }
      });

      // Du an da mat chi co mot hanh dong (an) qua nut x - khong can menu rieng.
      if (row.classList.contains('is-missing')) continue;

      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const isPinned = this.pinned.some((p) => String(p.cwd).toLowerCase() === cwd.toLowerCase());
        const project = [...this.pinned, ...this.recent].find(
          (p) => String(p.cwd).toLowerCase() === cwd.toLowerCase(),
        );
        window.api.projects.showContextMenu({
          cwd,
          isPinned,
          skipPermissions: Boolean(project?.skipPermissions),
        });
      });
    }
  }

  /**
   * Bật/tắt --dangerously-skip-permissions cho một dự án. Bật lên cần cảnh báo
   * trước - Claude sẽ tự sửa file/chạy lệnh không hỏi lại nữa, khác với các
   * nút khác (pin/hide) chỉ đổi cách hiển thị chứ không đổi hành vi thực thi.
   */
  async _toggleSkipPermissions(cwd) {
    const project = [...this.pinned, ...this.recent].find(
      (p) => String(p.cwd).toLowerCase() === String(cwd).toLowerCase(),
    );
    const isOn = Boolean(project?.skipPermissions);

    if (!isOn) {
      const ok = window.confirm(
        `Bật --dangerously-skip-permissions cho dự án này?\n\nClaude sẽ tự động sửa file, chạy lệnh và thao tác khác mà KHÔNG hỏi xin quyền nữa, cho mọi tab Claude mở mới trong thư mục này. Chỉ bật nếu bạn thực sự tin tưởng dự án này.`,
      );
      if (!ok) return;
    }

    await window.api.projects.toggleSkipPermissions(cwd);
    await this.reload();
  }

  /** Danh sách phẳng cho bảng lệnh, ưu tiên dự án ghim rồi tới hay dùng. */
  allProjects() {
    const seen = new Set();
    const result = [];
    for (const project of [...this.pinned, ...this.recent]) {
      const key = String(project.cwd).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(project);
    }
    return result;
  }
}

window.ProjectsSidebar = ProjectsSidebar;
