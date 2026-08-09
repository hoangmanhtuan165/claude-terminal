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
const RECENTLY_USED_SHOWN = 5;

class ProjectsSidebar {
  constructor({ element, onOpenTerminal, onSelectProject, getOpenCwds }) {
    this.element = element;
    this.onOpenTerminal = onOpenTerminal;
    this.onSelectProject = onSelectProject;
    // Tra ve tap cwd (chu thuong) dang co it nhat mot tab mo - dung ve cham
    // xanh "dang mo" tren tung hang, khong bat buoc (sidebar van chay duoc
    // khi thieu, chi khong co cham).
    this.getOpenCwds = getOpenCwds || (() => new Set());

    this.pinned = [];
    this.recent = [];
    this.selectedCwd = null;
    // Mục dự án dùng một lần thu gọn sẵn để không lấp mất phần hay dùng.
    this.collapsed = { oneOff: true };
    this.searchQuery = '';

    this._buildChrome();
  }

  /**
   * Dựng khung một lần duy nhất: ô tìm kiếm phải là node DOM cố định, không
   * được tạo lại mỗi lần render() (khác với phần danh sách bên dưới) - nếu
   * không con trỏ gõ và tiêu điểm sẽ mất ngay sau ký tự đầu tiên gõ vào.
   */
  _buildChrome() {
    this.element.innerHTML = `
      <div class="sidebar-search">
        <div class="search-field">
          <span class="search-icon">${window.icons.svg('search', { size: 13 })}</span>
          <input type="text" class="sidebar-search-input" placeholder="Tìm dự án..." autocomplete="off" />
        </div>
      </div>
      <div class="sidebar-list"></div>`;

    this.searchInput = this.element.querySelector('.sidebar-search-input');
    this.listElement = this.element.querySelector('.sidebar-list');
    // Trang thai cho tan cho den lan reload() dau tien - lan mo dau sau khi
    // INDEX_VERSION doi phai quet lai toan bo transcript (co the mat vai chuc
    // giay tren hang tram phien), khong de sidebar trong tron gay hieu lam da mat du an.
    this.listElement.innerHTML = `<div class="sidebar-empty">Đang tải danh sách dự án...</div>`;

    this.searchInput.addEventListener('input', () => {
      this.searchQuery = this.searchInput.value.trim();
      this.render();
    });

    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.searchQuery) {
        event.preventDefault();
        this.searchInput.value = '';
        this.searchQuery = '';
        this.render();
      }
    });

    // Trong luc dang quet (lan mo dau sau khi doi cau truc index, hoac bam
    // "Quet lai" thu cong), cap nhat trang thai cho de nguoi dung biet danh
    // sach chua trong hen - khong phai da mat du an.
    window.api.history.onIndexProgress(({ phase, processed, total }) => {
      // Da co du lieu that (tu lan reload() thanh cong dau tien) thi khong
      // ghi de sidebar nua - cac lan "Quet lai" sau chi cap nhat ngam, sidebar
      // van giu du lieu cu de nguoi dung thao tac binh thuong trong luc cho.
      if (this.recent.length > 0 || this.pinned.length > 0) return;
      const label = phase === 'content' ? 'Đang rút gọn nội dung' : 'Đang đọc thông tin phiên';
      this.listElement.innerHTML = `<div class="sidebar-empty">${label}: ${processed}/${total}...</div>`;
    });
  }

  async reload() {
    const data = await window.api.projects.list();
    this.pinned = data.pinned;
    this.recent = data.recent;
    this.render();
  }

  render() {
    const { escapeHtml, baseName, shortenPath, formatRelative, highlightHtml, fuzzyScore, formatTokens } =
      window.formatUtils;

    const pinnedCwds = new Set(this.pinned.map((p) => p.cwd.toLowerCase()));
    const rest = this.recent.filter((p) => !pinnedCwds.has(String(p.cwd).toLowerCase()));
    const openCwds = this.getOpenCwds();

    const renderRow = (project, isPinned, highlightQuery = '') => {
      const cwd = project.cwd;
      const isActive = this.selectedCwd && cwd.toLowerCase() === this.selectedCwd.toLowerCase();
      // `exists` vắng mặt (dữ liệu cũ trước khi có cờ này) thì coi như còn,
      // tránh cả sidebar xám đi vì một API cũ chưa kịp cập nhật.
      const isMissing = project.exists === false;
      const isOpen = openCwds.has(String(cwd).toLowerCase());

      // `· 1.2M · $3.40` chi hien khi co so dang ke - trach lam ron doi voi
      // du an moi/it dung, va tranh "$0.00" khong noi len gi.
      const stats = project.totalTokens
        ? ` · ${formatTokens(project.totalTokens)}${project.costUsd >= 0.01 ? ` · $${project.costUsd.toFixed(2)}` : ''}`
        : '';
      const subtitle = isMissing
        ? 'Thư mục không còn tồn tại'
        : project.sessionCount
          ? `${project.sessionCount} phiên · ${formatRelative(project.lastUsedAt)}${stats}`
          : shortenPath(cwd, 34);

      const name = baseName(cwd) || cwd;
      const nameHtml = highlightQuery ? highlightHtml(name, highlightQuery) : escapeHtml(name);

      return `
        <div class="project-row${isActive ? ' is-active' : ''}${isMissing ? ' is-missing' : ''}${isPinned ? ' is-pinned-row' : ''}" data-cwd="${escapeHtml(cwd)}" title="${escapeHtml(cwd)}"${isPinned ? ' draggable="true"' : ''}>
          <span class="project-dot${isOpen ? ' is-open' : ''}" title="${isOpen ? 'Đang có tab mở' : ''}"></span>
          <div class="project-info">
            <div class="project-name">${nameHtml}</div>
            <div class="project-sub">${escapeHtml(subtitle)}</div>
          </div>
          <div class="project-actions">
            ${
              isMissing
                ? `<button class="icon-btn" data-act="hide" title="Ẩn khỏi danh sách (không xoá lịch sử)">${window.icons.svg('x', { size: 12 })}</button>`
                : `<button class="icon-btn" data-act="claude" title="${project.lastSessionId ? 'Nối tiếp phiên gần nhất ở đây' : 'Mở tab Claude ở đây'}">${window.icons.svg('play')}</button>
                   <button class="icon-btn${project.skipPermissions ? ' is-skip-on' : ''}" data-act="toggle-skip" title="${project.skipPermissions ? 'Đang bỏ qua xin quyền (--dangerously-skip-permissions) - bấm để tắt' : 'Bật bỏ qua xin quyền (--dangerously-skip-permissions) cho dự án này'}">${window.icons.svg('bolt', { size: 13, filled: Boolean(project.skipPermissions) })}</button>
                   <button class="icon-btn${isPinned ? ' is-pinned' : ''}" data-act="${isPinned ? 'unpin' : 'pin'}" title="${isPinned ? 'Bỏ ghim' : 'Ghim dự án'}">${window.icons.svg('pin', { filled: isPinned })}</button>`
            }
          </div>
        </div>`;
    };

    const section = ({ key, label, projects, isPinned, action, emptyText, alwaysOpen }) => {
      const isCollapsed = !alwaysOpen && Boolean(this.collapsed[key]);
      const rows = isCollapsed
        ? ''
        : projects.length
          ? projects.map((p) => renderRow(p, isPinned)).join('')
          : `<div class="sidebar-empty">${escapeHtml(emptyText)}</div>`;

      return `
        <div class="sidebar-section">
          <button class="sidebar-heading${isCollapsed ? ' is-collapsed' : ''}${alwaysOpen ? ' is-static' : ''}"${alwaysOpen ? '' : ` data-toggle="${key}"`}>
            ${alwaysOpen ? '' : `<span class="chevron">${window.icons.svg('chevron-down')}</span>`}
            <span>${escapeHtml(label)}</span>
            <span class="count">${projects.length}</span>
            ${action || ''}
          </button>
          ${rows}
        </div>`;
    };

    const missingCount = [...this.pinned, ...this.recent].filter((p) => p.exists === false).length;

    // --- Dang tim kiem: thay toan bo danh muc bang mot danh sach phang, xep
    // theo do khop (khong quan tam pin/tan suat) - go la thay ngay. ---
    if (this.searchQuery) {
      const pool = [...this.pinned, ...this.recent];
      const seen = new Set();
      const scored = [];
      for (const project of pool) {
        const key = String(project.cwd).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const score = fuzzyScore(`${baseName(project.cwd)} ${project.cwd}`, this.searchQuery);
        if (score >= 0) scored.push({ project, score, isPinned: pinnedCwds.has(key) });
      }
      scored.sort((a, b) => b.score - a.score);

      this.listElement.innerHTML = scored.length
        ? `<div class="sidebar-section">
             ${scored.map(({ project, isPinned }) => renderRow(project, isPinned, this.searchQuery)).join('')}
           </div>`
        : `<div class="sidebar-empty">Không tìm thấy dự án nào khớp “${escapeHtml(this.searchQuery)}”.</div>`;

      this._bindListEvents();
      return;
    }

    const frequent = rest.filter((p) => (p.sessionCount || 0) >= FREQUENT_MIN_SESSIONS);
    const oneOff = rest.filter((p) => (p.sessionCount || 0) < FREQUENT_MIN_SESSIONS);
    // Truy cap nhanh: N du an dung gan day nhat, tru du an da ghim (da co
    // rieng o muc Ghim) va du an da mat (khong bam vao mo lai duoc nua).
    const recentlyUsed = rest.filter((p) => p.exists !== false).slice(0, RECENTLY_USED_SHOWN);

    this.listElement.innerHTML = [
      recentlyUsed.length
        ? section({
            key: 'recentlyUsed',
            label: 'Vừa dùng',
            projects: recentlyUsed,
            isPinned: false,
            alwaysOpen: true,
          })
        : '',
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

    this._bindListEvents();
  }

  _bindListEvents() {
    for (const heading of this.listElement.querySelectorAll('[data-toggle]')) {
      heading.addEventListener('click', () => {
        const key = heading.dataset.toggle;
        this.collapsed[key] = !this.collapsed[key];
        this.render();
      });
    }

    this.listElement.querySelector('[data-act="browse"]')?.addEventListener('click', async () => {
      const cwd = await window.api.projects.browse();
      if (!cwd) return;
      await window.api.projects.pin(cwd);
      await this.reload();
    });

    this.listElement.querySelector('[data-act="prune-missing"]')?.addEventListener('click', async () => {
      await window.api.projects.pruneMissing();
      await this.reload();
    });

    for (const row of this.listElement.querySelectorAll('.project-row')) {
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
          const project = [...this.pinned, ...this.recent].find(
            (p) => String(p.cwd).toLowerCase() === cwd.toLowerCase(),
          );
          if (project?.lastSessionId) {
            this.onOpenTerminal({
              cwd,
              sessionType: 'claude-resume',
              resumeSessionId: project.lastSessionId,
              title: `resume · ${window.formatUtils.baseName(cwd)}`,
            });
          } else {
            this.onOpenTerminal({ cwd, sessionType: 'claude' });
          }
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

      if (row.classList.contains('is-pinned-row')) this._bindPinnedDrag(row);

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

  /** Kéo-thả một hàng trong mục "Dự án ghim" để đổi thứ tự. */
  _bindPinnedDrag(row) {
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.dataset.cwd);
      row.classList.add('is-dragging');
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      this.listElement
        .querySelectorAll('.is-pinned-row.is-drop-before, .is-pinned-row.is-drop-after')
        .forEach((el) => el.classList.remove('is-drop-before', 'is-drop-after'));
    });

    row.addEventListener('dragover', (event) => {
      if (!row.parentElement?.contains(document.querySelector('.is-dragging'))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.classList.toggle('is-drop-before', before);
      row.classList.toggle('is-drop-after', !before);
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('is-drop-before', 'is-drop-after');
    });

    row.addEventListener('drop', async (event) => {
      event.preventDefault();
      const draggedCwd = event.dataTransfer.getData('text/plain');
      const targetCwd = row.dataset.cwd;
      row.classList.remove('is-drop-before', 'is-drop-after');
      if (!draggedCwd || draggedCwd === targetCwd) return;

      const order = this.pinned.map((p) => p.cwd);
      const fromIndex = order.findIndex((c) => c === draggedCwd);
      if (fromIndex === -1) return;
      order.splice(fromIndex, 1);

      const before = event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
      let toIndex = order.findIndex((c) => c === targetCwd);
      if (toIndex === -1) toIndex = order.length;
      else if (!before) toIndex += 1;
      order.splice(toIndex, 0, draggedCwd);

      this.pinned = await window.api.projects.reorderPinned(order);
      this.render();
    });
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
