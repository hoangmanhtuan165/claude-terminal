'use strict';

const path = require('node:path');
const { readJson } = require('./json-store');
const { claudeConfigDir } = require('../app-paths');

/**
 * Doc trang thai dang nhap Claude Code de hien len giao dien.
 *
 * QUY TAC AN TOAN QUAN TRONG NHAT CUA FILE NAY:
 * `.credentials.json` chua `accessToken` va `refreshToken` that. Ham o day
 * TUYET DOI khong duoc tra hai truong do (hay bat ky doan nao cua chung) ve
 * renderer. Renderer hien thi noi dung transcript - la du lieu khong tin cay -
 * nen coi no nhu moi truong co the bi chen script; token lot xuong day la ro ri.
 *
 * Chi tra ve nhung thu vo hai va du de hien thi:
 *   - loai goi dang dung (`subscriptionType`), bac han muc (`rateLimitTier`)
 *   - moc het han cua token (con bao lau) - de canh bao truoc khi phien gay
 *   - to chuc dang dung, da che bot
 *
 * App KHONG bao gio tu ghi vao file nay. Moi thao tac dang nhap/dang xuat deu
 * do chinh `claude /login` va `/logout` lam - app chi go lenh do xuong terminal.
 */

/** Con duoi nguong nay thi nhac nguoi dung dang nhap lai. */
const REFRESH_WARN_DAYS = 3;

function credentialsPath(configDir = claudeConfigDir) {
  return path.join(configDir, '.credentials.json');
}

/** Che bot uuid: du de phan biet hai tai khoan, khong lo tron ven dinh danh. */
function maskUuid(value) {
  const text = String(value || '');
  if (text.length < 8) return null;
  return `${text.slice(0, 8)}…`;
}

/**
 * Trang thai tai khoan cua mot thu muc cau hinh.
 * Tra ve `{ loggedIn: false }` khi chua dang nhap hoac file khong doc duoc.
 */
function read(configDir = claudeConfigDir) {
  const data = readJson(credentialsPath(configDir), null);
  const oauth = data?.claudeAiOauth;
  if (!oauth) return { loggedIn: false };

  const now = Date.now();
  const expiresAt = Number(oauth.expiresAt) || 0;
  const refreshExpiresAt = Number(oauth.refreshTokenExpiresAt) || 0;

  // Het han refresh token moi that su phai dang nhap lai; access token het han
  // thi Claude Code tu lam moi duoc, khong can lam phien nguoi dung.
  const refreshMsLeft = refreshExpiresAt - now;
  const needsReloginSoon =
    refreshExpiresAt > 0 && refreshMsLeft < REFRESH_WARN_DAYS * 86400000;

  return {
    loggedIn: true,
    subscriptionType: oauth.subscriptionType || null,
    rateLimitTier: oauth.rateLimitTier || null,
    scopeCount: Array.isArray(oauth.scopes) ? oauth.scopes.length : 0,
    organization: maskUuid(data.organizationUuid),
    accessExpiresAt: expiresAt || null,
    refreshExpiresAt: refreshExpiresAt || null,
    accessExpired: expiresAt > 0 && expiresAt <= now,
    needsReloginSoon,
    refreshDaysLeft: refreshExpiresAt > 0 ? Math.floor(refreshMsLeft / 86400000) : null,
  };
}

module.exports = { read, credentialsPath, REFRESH_WARN_DAYS };
