const crypto = require('crypto');
const db = require('./db');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = db.readAll('sessions');
  sessions.push({
    id: sessions.length ? Math.max(...sessions.map((s) => s.id)) + 1 : 1,
    token,
    userId,
    createdAt: Date.now(),
    expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  });
  db.writeAll('sessions', sessions);
  return token;
}

function getUserFromToken(token) {
  if (!token) return null;
  const sessions = db.readAll('sessions');
  const session = sessions.find((s) => s.token === token);
  if (!session) return null;
  if (session.expires < Date.now()) return null;
  const user = db.findById('users', session.userId);
  return user;
}

function destroySession(token) {
  const sessions = db.readAll('sessions');
  const filtered = sessions.filter((s) => s.token !== token);
  db.writeAll('sessions', filtered);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getUserFromToken,
  destroySession,
  parseCookies,
};
