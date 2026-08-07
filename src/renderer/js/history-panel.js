'use strict';

/**
 * Màn hình lịch sử: danh sách phiên bên trái, nội dung phiên bên phải.
 *
 * Có hai chế độ tìm:
 * - "tiêu đề": lọc tức thời trên metadata đã index, không chạm vào đĩa.
 * - "toàn văn": đẩy yêu cầu xuống worker để quét nội dung thật của transcript,
 *   kết quả về dần theo từng đợt.
 */

const MAX_LIST_ROWS = 400;

/**
 * Ngưỡng coi một phiên là "vụn": mở ra rồi bỏ ngay, hoặc phiên do công cụ khác
 * tự sinh để kiểm tra (health-check).
 *
 * Đo trên 151 phiên thật: 55 phiên dưới 200KB, và **không phiên nào** trong số
 * đó kéo dài quá 2 phút — tức dung lượng và thời lượng cho cùng một kết quả,
 * nên chỉ cần một tiêu chí. Nhóm này gồm những tiêu đề như "Reply with exactly:
 * OK", "Tra loi dung mot tu: xong", hay "(phiên không có prompt)".
 *
 * Chúng chiếm hơn một phần ba danh sách nên lọc đi giúp phần việc thật nổi lên,
 * nhưng vẫn phải bật/tắt được vì đôi khi cần tìm lại đúng một phiên ngắn.
 */
const SMALL_SESSION_BYTES = 200 * 1024;

/**
 * Mốc chia nhóm thời gian.
 * Đo trên dữ liệu thật: 17 phiên hôm nay, 60 trong 7 ngày, 73 trong 30 ngày —
 * chia theo ba mốc này cho ra các nhóm cỡ tương đương, dễ quét mắt.
 */
const TIME_GROUPS = [
  { label: 'Hôm nay', maxDays: 1 },
  { label: '7 ngày qua', maxDays: 7 },
  { label: '30 ngày qua', maxDays: 30 },
  { label: 'Cũ hơn', maxDays: Infinity },
];

function timeGroupOf(isoString) {
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return TIME_GROUPS[TIME_GROUPS.length - 1].label;

  const days = (Date.now() - time) / 86400000;
  return TIME_GROUPS.find((group) => days < group.maxDays).label;
}

/**
 * Nhãn nhóm khi đang xem một dự án: gom theo đúng ngày thay vì các mốc tương
 * đối "7 ngày qua".
 *
 * Lý do: đo trên dữ liệu thật, làm việc dồn theo ngày chứ không rải đều —
 * escbase_template có 9 phiên trong cùng một ngày, video-marketing cũng 9. Xem
 * riêng một dự án thì câu hỏi luôn là "hôm đó tôi làm tới đâu", nên ranh giới
 * ngày mới là thứ đáng chia, còn "7 ngày qua" thì gộp tất cả thành một khối vô
 * dụng.
 */
function dayGroupOf(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Không rõ thời gian';

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysApart = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);

  if (daysApart === 0) return 'Hôm nay';
  if (daysApart === 1) return 'Hôm qua';

  const weekday = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][
    date.getDay()
  ];
  const dayMonth = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  // Trong vòng một năm thì không cần năm; xa hơn thì phải có để khỏi lẫn.
  const year = daysApart > 330 ? `/${date.getFullYear()}` : '';
  return `${weekday}, ${dayMonth}${year}`;
}

class HistoryPanel {
  constructor({ elements, transcriptView, onOpenSession }) {
    this.el = elements;
    this.transcriptView = transcriptView;
    this.onOpenSession = onOpenSession || (() => {});

    this.sessions = [];
    this.cwdFilter = null;
    this.hideSmallSessions = true;
    /** sessionId -> { starred, note } */
    this.notes = {};
    this.searchMode = 'title';
    this.searchHits = [];
    this.activeSearchId = null;
    this.activeWorkerId = null;
    this.selectedSessionId = null;
    /** Vị trí con trỏ bàn phím trong danh sách đang hiển thị. */
    this.cursor = -1;
    this.visibleRows = [];

    this._bindEvents();
  }

  _bindEvents() {
    this.el.searchInput.addEventListener('input', () => {
      if (this.searchMode === 'title') this.renderList();
    });

    this.el.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && this.searchMode === 'fulltext') {
        this.runFullTextSearch();
      } else if (event.key === 'Escape') {
        this.el.searchInput.value = '';
        this.cancelSearch();
        this.renderList();
      } else if (event.key === 'ArrowDown') {
        // Từ ô tìm bấm mũi tên xuống là nhảy thẳng vào danh sách.
        event.preventDefault();
        this.el.list.focus();
        this.moveCursor(this.cursor < 0 ? 1 : 0);
      }
    });

    this.el.list.addEventListener('keydown', (event) => this._handleListKey(event));

    for (const button of this.el.modeButtons) {
      button.addEventListener('click', () => {
        this.searchMode = button.dataset.mode;
        for (const other of this.el.modeButtons) {
          other.classList.toggle('is-active', other === button);
        }
        this.cancelSearch();
        this._rerun();
        this.el.searchInput.focus();
      });
    }

    this.el.refreshButton.addEventListener('click', () => this.refreshIndex());

    this.el.scopeSelect.addEventListener('change', () => {
      this.cwdFilter = this.el.scopeSelect.value || null;
      this._rerun();
    });

    this.el.hideSmallCheckbox.addEventListener('change', () => {
      this.hideSmallSessions = this.el.hideSmallCheckbox.checked;
      window.api.prefs.set({ hideSmallSessions: this.hideSmallSessions });
      this._rerun();
    });

    window.api.history.onSearchHits(({ requestId, hits }) => {
      if (requestId !== this.activeSearchId) return;
      this.searchHits.push(...hits);
      this.renderSearchResults();
    });

    window.api.history.onSearchProgress(({ requestId, scanned, total }) => {
      if (requestId !== this.activeSearchId) return;
      this.setStatus(`Đang quét ${scanned}/${total} phiên...`);
    });

    window.api.history.onSearchDone(({ requestId, totalHits, scanned, truncated }) => {
      if (requestId !== this.activeSearchId) return;
      this.activeSearchId = null;
      const limitNote = truncated ? ' (đã đạt giới hạn kết quả)' : '';
      this.setStatus(`${totalHits} kết quả trong ${scanned} phiên${limitNote}`);
      this.renderSearchResults();
    });

    window.api.history.onSearchError(({ requestId, message }) => {
      if (requestId !== this.activeSearchId) return;
      this.activeSearchId = null;
      this.setStatus(message, true);
    });

    window.api.history.onIndexProgress(({ phase, processed, total }) => {
      if (phase === 'content') {
        this.setStatus(`Đang rút gọn nội dung để tìm nhanh: ${processed}/${total} phiên...`);
      } else if (phase === 'metadata') {
        this.setStatus(`Đang đọc thông tin phiên: ${processed}/${total}...`);
      }
    });
  }

  _rerun() {
    if (this.searchMode === 'fulltext' && this.el.searchInput.value.trim()) {
      this.runFullTextSearch();
    } else {
      this.renderList();
    }
  }

  /** Đọc tuỳ chọn đã lưu và áp lên ô đánh dấu trước khi vẽ danh sách lần đầu. */
  async loadPrefs() {
    const prefs = await window.api.prefs.get();
    this.hideSmallSessions = prefs.hideSmallSessions !== false;
    this.el.hideSmallCheckbox.checked = this.hideSmallSessions;
  }

  setStatus(text, isError = false) {
    this.el.status.textContent = text;
    this.el.status.classList.toggle('is-error', isError);
  }

  // --- Dữ liệu -------------------------------------------------------------

  async refreshIndex() {
    this.setStatus('Đang quét thư mục transcript...');
    if (this.sessions.length === 0) this._renderSkeleton();

    const result = await window.api.history.refresh();
    await this.reload();
    this.setStatus(
      result.rescanned
        ? `${result.total} phiên, đã rút gọn lại ${result.rescanned} phiên`
        : `${result.total} phiên, chỉ mục đã mới`,
    );
  }

  async reload() {
    const [sessions, notes] = await Promise.all([
      window.api.history.listSessions(),
      window.api.notes.list(),
    ]);
    this.sessions = sessions;
    this.notes = notes || {};
    this._renderScopeOptions();
    this.renderList();
  }

  /** Transcript view vừa đổi sao/ghi chú — cập nhật và vẽ lại danh sách. */
  applyNoteChange(sessionId, note) {
    if (note) this.notes[sessionId] = note;
    else delete this.notes[sessionId];
    this.renderList();
  }

  _renderScopeOptions() {
    const { escapeHtml, baseName } = window.formatUtils;

    const counts = new Map();
    for (const session of this.sessions) {
      const cwd = session.cwd || '';
      if (!cwd) continue;
      counts.set(cwd, (counts.get(cwd) || 0) + 1);
    }

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const previous = this.cwdFilter;

    this.el.scopeSelect.innerHTML = [
      `<option value="">Tất cả dự án (${this.sessions.length})</option>`,
      ...sorted.map(
        ([cwd, count]) =>
          `<option value="${escapeHtml(cwd)}">${escapeHtml(baseName(cwd))} (${count})</option>`,
      ),
    ].join('');

    if (previous) this.el.scopeSelect.value = previous;
  }

  /** Cho sidebar chọn dự án và đồng bộ ngược lại ô chọn phạm vi. */
  setProjectFilter(cwd) {
    this.cwdFilter = cwd || null;
    this.el.scopeSelect.value = cwd || '';
    this._rerun();
  }

  _filteredSessions() {
    let list = this.sessions;

    if (this.cwdFilter) {
      const target = this.cwdFilter.toLowerCase();
      list = list.filter((s) => String(s.cwd || '').toLowerCase() === target);
    }

    if (this.hideSmallSessions) {
      // Hai ngoại lệ không bao giờ bị giấu: phiên đang mở (nó bắt đầu từ 0 byte
      // nên sẽ biến mất đúng lúc cần thấy nhất) và phiên đã đánh dấu/ghi chú —
      // người dùng đã chủ động nói rằng nó đáng giữ.
      list = list.filter(
        (s) =>
          s.sizeBytes >= SMALL_SESSION_BYTES ||
          s.sessionId === this.selectedSessionId ||
          this.notes[s.sessionId],
      );
    }

    if (this.searchMode === 'title') {
      const query = this.el.searchInput.value.trim().toLowerCase();
      if (query) {
        list = list.filter(
          (s) =>
            String(s.title).toLowerCase().includes(query) ||
            String(s.slug || '').toLowerCase().includes(query) ||
            String(s.gitBranch || '').toLowerCase().includes(query) ||
            // Ghi chú do người dùng tự viết chính là từ khoá họ sẽ nhớ nhất.
            String(this.notes[s.sessionId]?.note || '').toLowerCase().includes(query),
        );
      }
    }

    return list;
  }

  // --- Vẽ danh sách --------------------------------------------------------

  _renderSkeleton() {
    this.el.list.innerHTML = Array.from({ length: 7 })
      .map(
        (_, i) =>
          `<div class="skeleton-row">
             <div class="skeleton-bar" style="width:${88 - i * 6}%"></div>
             <div class="skeleton-bar" style="width:34%;height:7px"></div>
           </div>`,
      )
      .join('');
    this.visibleRows = [];
  }

  _sessionRowHtml(session, query, index) {
    const { escapeHtml, highlightHtml, formatRelative, baseName, formatBytes } = window.formatUtils;
    const isActive = session.sessionId === this.selectedSessionId;
    const note = this.notes[session.sessionId];

    return `
      <button class="session-row${isActive ? ' is-active' : ''}${index === this.cursor ? ' is-cursor' : ''}"
              data-session-id="${escapeHtml(session.sessionId)}" data-index="${index}">
        <div class="session-title">
          ${note?.starred ? `<span class="row-star">${window.icons.svg('star', { size: 12, filled: true })}</span>` : ''}
          ${highlightHtml(session.title, query)}
        </div>
        ${note?.note ? `<div class="session-note">${highlightHtml(note.note, query)}</div>` : ''}
        <div class="session-meta">
          <span class="session-project">${escapeHtml(baseName(session.cwd) || 'không rõ')}</span>
          ${session.gitBranch ? `<span class="branch-chip">⑂ ${escapeHtml(session.gitBranch)}</span>` : ''}
          <span>${escapeHtml(formatRelative(session.endedAt))}</span>
          <span>${escapeHtml(formatBytes(session.sizeBytes))}</span>
        </div>
      </button>`;
  }

  renderList() {
    const { escapeHtml } = window.formatUtils;
    const list = this._filteredSessions();
    const query = this.searchMode === 'title' ? this.el.searchInput.value.trim() : '';

    if (list.length === 0) {
      this.el.list.innerHTML = this._emptyStateHtml(query);
      this.visibleRows = [];
      this.setStatus(this._countLabel(0));
      return;
    }

    const shown = list.slice(0, MAX_LIST_ROWS);
    this.visibleRows = shown;

    // Xem cả kho thì gom theo mốc tương đối; xem riêng một dự án thì gom theo
    // ngày, vì làm việc dồn theo ngày (xem dayGroupOf).
    const groupOf = this.cwdFilter ? dayGroupOf : timeGroupOf;

    // Đếm trước số phiên mỗi ngày để hiện ngay trên tiêu đề nhóm.
    const groupCounts = new Map();
    for (const session of shown) {
      const key = groupOf(session.endedAt);
      groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
    }

    let html = '';
    let lastGroup = null;
    shown.forEach((session, index) => {
      const group = groupOf(session.endedAt);
      if (group !== lastGroup) {
        const count = groupCounts.get(group);
        html += `<div class="group-heading">
            <span>${escapeHtml(group)}</span>
            ${this.cwdFilter ? `<span class="group-count">${count} phiên</span>` : ''}
          </div>`;
        lastGroup = group;
      }
      html += this._sessionRowHtml(session, query, index);
    });

    if (list.length > MAX_LIST_ROWS) {
      html += `<div class="sidebar-empty">Còn ${list.length - MAX_LIST_ROWS} phiên nữa, hãy lọc thêm.</div>`;
    }

    this.el.list.innerHTML = html;
    this.setStatus(this._countLabel(list.length));
    this._bindRowClicks();
  }

  /**
   * Dòng đếm dưới ô tìm. Khi bộ lọc "phiên vụn" đang bật thì nói rõ đã giấu bao
   * nhiêu — phiên biến mất mà không giải thích sẽ làm người dùng tưởng mất dữ
   * liệu.
   */
  _countLabel(shownCount) {
    const total = this.sessions.length;
    if (!this.hideSmallSessions) return `${shownCount}/${total} phiên`;

    // Đếm đúng những phiên thật sự bị giấu: phiên đã đánh dấu/ghi chú vẫn hiện
    // dù nhỏ, nên không tính vào đây.
    const hidden = this.sessions.filter(
      (s) => s.sizeBytes < SMALL_SESSION_BYTES && !this.notes[s.sessionId],
    ).length;
    if (hidden === 0) return `${shownCount}/${total} phiên`;
    return `${shownCount}/${total} phiên · đã ẩn ${hidden} phiên vụn`;
  }

  _emptyStateHtml(query) {
    const { escapeHtml } = window.formatUtils;
    if (query) {
      return `<div class="empty-state">
          <div class="empty-icon">⌕</div>
          <div class="empty-title">Không phiên nào khớp "${escapeHtml(query)}"</div>
          <div class="empty-hint">Thử chuyển sang chế độ "Toàn văn" để tìm trong nội dung hội thoại thay vì chỉ tiêu đề.</div>
        </div>`;
    }
    // Có phiên thật, chỉ là bộ lọc giấu hết — nói rõ để khỏi tưởng mất dữ liệu.
    if (this.hideSmallSessions && this.sessions.length > 0) {
      return `<div class="empty-state">
          <div class="empty-icon">🕘</div>
          <div class="empty-title">Mọi phiên ở đây đều là phiên vụn</div>
          <div class="empty-hint">Bỏ chọn "Ẩn phiên vụn" ở trên để xem các phiên ngắn dưới 200KB.</div>
        </div>`;
    }

    return `<div class="empty-state">
        <div class="empty-icon">🕘</div>
        <div class="empty-title">Chưa có phiên nào</div>
        <div class="empty-hint">Mở một tab Claude từ cột dự án bên trái. Phiên sẽ tự xuất hiện ở đây sau khi bấm "Quét lại".</div>
      </div>`;
  }

  renderSearchResults() {
    const { escapeHtml, highlightHtml, formatRelative, baseName } = window.formatUtils;

    if (this.searchHits.length === 0) {
      if (this.activeSearchId) {
        this._renderSkeleton();
      } else {
        this.el.list.innerHTML = `<div class="empty-state">
            <div class="empty-icon">⌕</div>
            <div class="empty-title">Không tìm thấy kết quả</div>
            <div class="empty-hint">Bật "Quét sâu (chậm)" để tìm cả trong lệnh đã chạy và kết quả công cụ.</div>
          </div>`;
        this.visibleRows = [];
      }
      return;
    }

    const sessionById = new Map(this.sessions.map((s) => [s.sessionId, s]));
    this.visibleRows = this.searchHits;

    this.el.list.innerHTML = this.searchHits
      .map((hit, index) => {
        const session = sessionById.get(hit.sessionId);
        const title = session ? session.title : hit.sessionId;
        return `
          <button class="session-row is-hit${index === this.cursor ? ' is-cursor' : ''}"
                  data-hit-index="${index}" data-index="${index}">
            <div class="hit-snippet">${highlightHtml(hit.snippet, hit.highlight)}</div>
            <div class="session-meta">
              <span class="session-role">${escapeHtml(hit.role)}</span>
              <span class="session-project">${escapeHtml(baseName(hit.cwd) || 'không rõ')}</span>
              <span>${escapeHtml(formatRelative(hit.timestamp))}</span>
            </div>
            <div class="hit-session">${escapeHtml(title)}</div>
          </button>`;
      })
      .join('');

    this._bindHitClicks();
  }

  // --- Điều hướng bàn phím -------------------------------------------------

  _handleListKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveCursor(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.cursor <= 0) {
        this.cursor = -1;
        this._paintCursor();
        this.el.searchInput.focus();
      } else {
        this.moveCursor(-1);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this._activateCursor();
    } else if (event.key === 'Escape') {
      this.el.searchInput.focus();
    }
  }

  moveCursor(delta) {
    if (this.visibleRows.length === 0) return;

    const next = Math.max(0, Math.min(this.visibleRows.length - 1, this.cursor + delta));
    if (next === this.cursor && delta !== 0) return;
    this.cursor = next;
    this._paintCursor();

    this.el.list.querySelector(`[data-index="${this.cursor}"]`)?.scrollIntoView({ block: 'nearest' });
    // Mở luôn phiên đang trỏ tới: duyệt bằng phím thì thấy nội dung ngay.
    this._activateCursor();
  }

  _paintCursor() {
    for (const row of this.el.list.querySelectorAll('[data-index]')) {
      row.classList.toggle('is-cursor', Number(row.dataset.index) === this.cursor);
    }
  }

  async _activateCursor() {
    const entry = this.visibleRows[this.cursor];
    if (!entry) return;

    // Ở chế độ toàn văn, mỗi dòng là một kết quả chứ không phải một phiên.
    if (entry.sessionId && entry.snippet !== undefined) {
      let session = this.sessions.find((s) => s.sessionId === entry.sessionId);
      if (!session) session = await window.api.history.findSession(entry.sessionId);
      if (session) this.openSession(session);
      return;
    }
    this.openSession(entry);
  }

  _bindRowClicks() {
    for (const row of this.el.list.querySelectorAll('[data-session-id]')) {
      row.addEventListener('click', () => {
        this.cursor = Number(row.dataset.index);
        this._paintCursor();
        const session = this.sessions.find((s) => s.sessionId === row.dataset.sessionId);
        if (session) this.openSession(session);
      });
    }
  }

  _bindHitClicks() {
    for (const row of this.el.list.querySelectorAll('[data-hit-index]')) {
      row.addEventListener('click', async () => {
        this.cursor = Number(row.dataset.index);
        this._paintCursor();

        const hit = this.searchHits[Number(row.dataset.hitIndex)];
        if (!hit) return;
        let session = this.sessions.find((s) => s.sessionId === hit.sessionId);
        // Phiên vừa tạo có thể chưa có trong index cache.
        if (!session) session = await window.api.history.findSession(hit.sessionId);
        if (session) this.openSession(session);
      });
    }
  }

  openSession(session) {
    this.selectedSessionId = session.sessionId;
    for (const row of this.el.list.querySelectorAll('[data-session-id]')) {
      row.classList.toggle('is-active', row.dataset.sessionId === session.sessionId);
    }
    this.transcriptView.load(session, this.notes[session.sessionId] || null);
  }

  // --- Tìm toàn văn --------------------------------------------------------

  async runFullTextSearch() {
    const query = this.el.searchInput.value.trim();
    if (!query) {
      this.renderList();
      return;
    }

    this.cancelSearch();
    this.searchHits = [];
    this.cursor = -1;

    // Gán id trước khi gọi, không đợi kết quả trả về: một lượt tìm trên cache
    // có thể xong trước cả hồi đáp IPC.
    const requestId = crypto.randomUUID();
    this.activeSearchId = requestId;

    const isDeep = this.el.includeToolsCheckbox.checked;
    this.setStatus(isDeep ? 'Đang quét sâu toàn bộ transcript...' : 'Đang tìm...');
    this._renderSkeleton();

    this.activeWorkerId = await window.api.history.search({
      clientRequestId: requestId,
      query,
      cwdFilter: this.cwdFilter,
      includeToolCalls: isDeep,
      includeSidechain: this.el.includeSidechainCheckbox.checked,
      caseSensitive: false,
      limit: 300,
    });
  }

  cancelSearch() {
    if (!this.activeSearchId) return;
    // activeWorkerId có thể chưa về nếu người dùng huỷ thật nhanh; khi đó chỉ
    // cần bỏ id hiện tại là đủ để mọi kết quả đến sau bị phớt lờ.
    if (this.activeWorkerId) window.api.history.cancelSearch(this.activeWorkerId);
    this.activeSearchId = null;
    this.activeWorkerId = null;
  }

  focusSearch() {
    this.el.searchInput.focus();
    this.el.searchInput.select();
  }
}

window.HistoryPanel = HistoryPanel;
