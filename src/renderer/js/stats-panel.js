'use strict';

/**
 * Màn hình Thống kê: tổng quan số phiên/token/chi phí, biểu đồ hoạt động 30
 * ngày gần nhất, và top dự án theo token. Toàn bộ số liệu đọc một lần qua
 * `history:usageStats` (đã tổng hợp sẵn ở main từ cache history-index).
 */

class StatsPanel {
  constructor({ element }) {
    this.element = element;
    this.stats = null;
  }

  async show() {
    if (!this.stats) this.element.innerHTML = this._skeletonHtml();
    this.stats = await window.api.history.usageStats();
    this.render();
  }

  _skeletonHtml() {
    return `<div class="stats-loading">Đang tính...</div>`;
  }

  render() {
    if (!this.stats) return;
    const { escapeHtml, formatTokens } = window.formatUtils;
    const s = this.stats;

    const cards = [
      { label: 'Tổng số phiên', value: s.sessionCount.toLocaleString('vi-VN') },
      { label: 'Số dự án', value: s.projectCount.toLocaleString('vi-VN') },
      { label: 'Tổng token', value: formatTokens(s.totalTokens) },
      { label: 'Tổng chi phí ước tính', value: `$${s.totalCostUsd.toFixed(2)}` },
      { label: 'Phiên có lỗi', value: s.errorSessions.toLocaleString('vi-VN') },
    ];

    this.element.innerHTML = `
      <div class="stats-cards">
        ${cards.map((c) => `
          <div class="stats-card">
            <div class="stats-card-value">${escapeHtml(c.value)}</div>
            <div class="stats-card-label">${escapeHtml(c.label)}</div>
          </div>`).join('')}
      </div>

      <div class="stats-section">
        <div class="stats-section-title">Hoạt động 30 ngày gần nhất</div>
        ${this._dailyChartHtml()}
      </div>

      <div class="stats-section">
        <div class="stats-section-title">Top dự án theo token</div>
        ${this._topProjectsHtml()}
      </div>`;
  }

  _dailyChartHtml() {
    const { escapeHtml } = window.formatUtils;
    const daily = this.stats.daily;
    if (!daily.length) return `<div class="sidebar-empty">Chưa có dữ liệu.</div>`;

    const max = Math.max(...daily.map((d) => d.sessionCount), 1);
    return `
      <div class="stats-chart">
        ${daily
          .map((d) => {
            const height = Math.max(4, Math.round((d.sessionCount / max) * 100));
            const label = d.day.slice(5).replace('-', '/');
            return `
              <div class="stats-bar" title="${escapeHtml(d.day)}: ${d.sessionCount} phiên">
                <div class="stats-bar-fill" style="height:${height}%"></div>
                <div class="stats-bar-label">${escapeHtml(label)}</div>
              </div>`;
          })
          .join('')}
      </div>`;
  }

  _topProjectsHtml() {
    const { escapeHtml, baseName, formatTokens } = window.formatUtils;
    const projects = this.stats.topProjects.filter((p) => p.totalTokens > 0);
    if (!projects.length) return `<div class="sidebar-empty">Chưa có dữ liệu.</div>`;

    const max = Math.max(...projects.map((p) => p.totalTokens), 1);
    return `
      <div class="stats-project-list">
        ${projects
          .map((p) => {
            const width = Math.max(2, Math.round((p.totalTokens / max) * 100));
            return `
              <div class="stats-project-row" title="${escapeHtml(p.cwd)}">
                <span class="stats-project-name">${escapeHtml(baseName(p.cwd) || p.name)}</span>
                <div class="stats-project-track"><div class="stats-project-fill" style="width:${width}%"></div></div>
                <span class="stats-project-value">${escapeHtml(formatTokens(p.totalTokens))}${p.costUsd >= 0.01 ? ` · $${p.costUsd.toFixed(2)}` : ''}</span>
              </div>`;
          })
          .join('')}
      </div>`;
  }
}

window.StatsPanel = StatsPanel;
