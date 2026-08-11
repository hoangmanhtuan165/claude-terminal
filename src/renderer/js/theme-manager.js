'use strict';

/**
 * Quan ly theme sang/toi.
 *
 * xterm khong doc bien CSS - no nhan mau qua doi tuong JavaScript va tu ve len
 * canvas. Nen khi doi theme phai doc lai bien tu CSS roi dua sang cho tung
 * instance terminal, neu khong terminal se van den giua giao dien sang.
 */

const CYCLE = ['system', 'light', 'dark'];

const LABEL = {
  system: 'Theo hệ thống',
  light: 'Sáng',
  dark: 'Tối',
};

const ICON = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

class ThemeManager {
  constructor({ toggleButton }) {
    this.toggleButton = toggleButton;
    this.preference = 'system';
    this.theme = 'dark';
    this.listeners = new Set();
  }

  async init() {
    const state = await window.api.theme.get();
    this._apply(state.preference, state.theme);

    // Windows doi sang/toi trong luc app dang chay.
    window.api.theme.onChanged(({ theme }) => this._apply(this.preference, theme));

    this.toggleButton?.addEventListener('click', () => this.cycle());
  }

  async cycle() {
    const next = CYCLE[(CYCLE.indexOf(this.preference) + 1) % CYCLE.length];
    const state = await window.api.theme.set(next);
    this._apply(state.preference, state.theme);
  }

  _apply(preference, theme) {
    this.preference = preference;
    this.theme = theme;
    document.documentElement.dataset.theme = theme;

    if (this.toggleButton) {
      this.toggleButton.textContent = ICON[preference];
      this.toggleButton.title = `Giao diện: ${LABEL[preference]} — bấm để đổi`;
    }

    // getComputedStyle() doc bien CSS moi ngay lap tuc, khong can cho frame
    // ve nao ca - tung boc trong requestAnimationFrame() nhung callback do
    // khong dang tin cay chay dung luc trong app nay (xac nhan qua debug: cua
    // so khong lien tuc ve lai thi rAF co the bi hoan vo thoi han), khien
    // terminal dang mo giu nguyen mau theme cu sau khi doi sang/toi.
    const palette = this.terminalTheme();
    for (const listener of this.listeners) listener(palette, theme);
  }

  /** Bang mau cho xterm, lay thang tu bien CSS de hai ben khong lech nhau. */
  terminalTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();

    return {
      background: v('--term-bg'),
      foreground: v('--term-fg'),
      cursor: v('--term-cursor'),
      cursorAccent: v('--term-bg'),
      selectionBackground: v('--term-selection'),
      black: v('--term-black'),
      red: v('--term-red'),
      green: v('--term-green'),
      yellow: v('--term-yellow'),
      blue: v('--term-blue'),
      magenta: v('--term-magenta'),
      cyan: v('--term-cyan'),
      white: v('--term-white'),
      brightBlack: v('--term-bright-black'),
      brightRed: v('--term-bright-red'),
      brightGreen: v('--term-bright-green'),
      brightYellow: v('--term-bright-yellow'),
      brightBlue: v('--term-bright-blue'),
      brightMagenta: v('--term-bright-magenta'),
      brightCyan: v('--term-bright-cyan'),
      brightWhite: v('--term-bright-white'),
    };
  }

  /** Dang ky nhan bang mau moi moi khi theme doi. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

window.ThemeManager = ThemeManager;
