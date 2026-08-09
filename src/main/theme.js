'use strict';

const { nativeTheme } = require('electron');

/**
 * Nguon su that ve theme, dung chung cho main va renderer.
 *
 * Nut thu/phong/dong tren Windows do he dieu hanh ve chu khong phai CSS, nen
 * mau cua chung phai duoc bao rieng qua `setTitleBarOverlay`. Neu khong, o
 * theme sang se thanh nut trang tren nen trang.
 */

/** Mau thanh tieu de phai khop bien --surface-titlebar trong app.css. */
const TITLE_BAR_COLORS = {
  dark: { color: '#15161d', symbolColor: '#9aa0b4' },
  light: { color: '#f4f5f8', symbolColor: '#5a6072' },
};

const TITLE_BAR_HEIGHT = 40;

/**
 * macOS dung `trafficLightPosition` de dat lai vi tri nut do/vang/xanh trong
 * thanh tieu de an, khong dung `titleBarOverlay` (chi co tac dung tren
 * Windows/Linux). Mau cua nut do he thong tu ve theo theme sang/toi, khong
 * can bao rieng nhu Windows.
 */
const TRAFFIC_LIGHT_POSITION = { x: 12, y: Math.round((TITLE_BAR_HEIGHT - 16) / 2) };

/**
 * Doi tuy chon nguoi dung thanh theme thuc te.
 * 'system' bam theo cai dat cua Windows.
 */
function resolveTheme(preference) {
  if (preference === 'dark' || preference === 'light') return preference;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function titleBarOverlayFor(theme) {
  return { ...TITLE_BAR_COLORS[theme === 'light' ? 'light' : 'dark'], height: TITLE_BAR_HEIGHT };
}

module.exports = { resolveTheme, titleBarOverlayFor, TITLE_BAR_HEIGHT, TRAFFIC_LIGHT_POSITION };
