'use strict';

/**
 * Muc PHIEN o dau sidebar: moi tab dang mo la mot hang, kem cham trang thai
 * theo thoi gian thuc - de biet tab nao dang chay, tab nao dang CHO minh tra
 * loi ma khong phai bam qua tung tab. Day la thu thieu nhat khi mo 3-4 phien
 * Claude/SSH cung luc.
 *
 * Trang thai lay tu TerminalTabs.statusOfTab (dung chung voi cham tren tab),
 * khong tu tinh o day - hai noi khong duoc bao khac nhau.
 */

const STATUS_LABEL = {
  running: 'Đang chạy',
  danger: 'Đang chạy · Bypass',
  waiting: 'Chờ bạn trả lời',
  idle: 'Rảnh',
  dead: 'Đã kết thúc',
};

class SessionsSidebar {
  constructor({ element, getTabs, getActiveTabId, getStatus, onActivate, onClose }) {
    this.element = element;
    this.getTabs = getTabs;
    this.getStatus = getStatus;
    this.getActiveTabId = getActiveTabId;
    this.onActivate = onActivate;
    this.onClose = onClose;
    this.collapsed = false;

    this.element.innerHTML = `<div class="sidebar-section sessions-section"></div>`;
    this.section = this.element.querySelector('.sessions-section');
    this.render();
  }

  render() {
    const { escapeHtml } = window.formatUtils;
    const tabs = [...this.getTabs().values()];
    const activeId = this.getActiveTabId();
    const waitingCount = tabs.filter((t) => this.getStatus(t) === 'waiting').length;

    const rows = tabs
      .map((tab) => {
        const status = this.getStatus(tab);
        const first = tab.panes[0];
        const type = first?.sessionType || 'shell';
        const sub = first?.cwd ? window.formatUtils.baseName(first.cwd) : '';
        return `
          <div class="sess-row${tab.id === activeId ? ' is-active' : ''}" data-id="${escapeHtml(tab.id)}" data-status="${status}" title="${STATUS_LABEL[status]}">
            <span class="sess-dot" data-status="${status}" data-type="${escapeHtml(type)}"></span>
            <div class="project-info">
              <div class="project-name">${escapeHtml(tab.title)}</div>
              <div class="project-sub">${escapeHtml(status === 'idle' ? sub || STATUS_LABEL.idle : STATUS_LABEL[status])}</div>
            </div>
            <div class="project-actions">
              <button class="icon-btn" data-act="close" title="Đóng tab">${window.icons.svg('x', { size: 12 })}</button>
            </div>
          </div>`;
      })
      .join('');

    this.section.innerHTML = `
      <button class="sidebar-heading${this.collapsed ? ' is-collapsed' : ''}" data-toggle="sessions">
        <span class="chevron">${window.icons.svg('chevron-down')}</span>
        <span>Phiên đang mở</span>
        ${waitingCount ? `<span class="session-waiting-badge" title="${waitingCount} phiên đang chờ bạn">${waitingCount}</span>` : ''}
        <span class="count">${tabs.length}</span>
      </button>
      ${this.collapsed ? '' : rows || `<div class="sidebar-empty">Chưa mở phiên nào.</div>`}`;

    this.section.querySelector('[data-toggle="sessions"]').addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });

    for (const row of this.section.querySelectorAll('.sess-row')) {
      const tabId = row.dataset.id;
      row.addEventListener('click', (event) => {
        if (event.target.closest('[data-act="close"]')) {
          event.stopPropagation();
          this.onClose(tabId);
          return;
        }
        this.onActivate(tabId);
      });
    }
  }
}

window.SessionsSidebar = SessionsSidebar;
