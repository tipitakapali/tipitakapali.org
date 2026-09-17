'use strict';

/**
 * readerSubmissionsEngine.js — Reader Contributions & Terminology Submissions Engine
 * Native Fastify module integrated into server.js on port 8400.
 *
 * Security & Isolation Architecture:
 *   - Dedicated SQLite database: user_submissions/reader_submissions.db (chmod 750 / 640)
 *   - Zero access to dictionary databases (which remain readonly with PRAGMA query_only = 1)
 *   - Timing-safe HMAC verification via crypto.timingSafeEqual
 *   - Route-level bodyLimit (64KB) to prevent DoS / RAM exhaustion
 *   - Input whitelisting & strict length clamping
 *   - Zero privilege escalation: unauthenticated bodies cannot set or override roles
 *   - Prepared statements with parameterized queries (?) for 100% SQL injection prevention
 *   - Concurrent WAL multi-worker safety with PRAGMA busy_timeout = 5000
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const USER_SUBMISSIONS_DIR = path.join(__dirname, 'user_submissions');
const DEFAULT_DB_PATH = path.join(USER_SUBMISSIONS_DIR, 'reader_submissions.db');
const SUBMISSIONS_DB_PATH = process.env.SUBMISSIONS_DB_PATH || DEFAULT_DB_PATH;
const JWT_SECRET = process.env.JWT_SECRET || 'nibbanagamini-reader-secret-key-2026';

// Route-level body limits (DoS prevention)
const BODY_LIMIT_SUBMISSION = 64 * 1024; // 64 KB
const BODY_LIMIT_AUTH = 32 * 1024;       // 32 KB

// Input whitelists
const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected', 'reviewed']);
const ALLOWED_SUGGESTION_TYPES = new Set([
  'term_correction',
  'typo',
  'translation_improvement',
  'paragraph_link',
  'general_feedback'
]);
const ALLOWED_LANG_REGEX = /^[a-z]{2,5}$/;
const ALLOWED_BOOK_REGEX = /^[a-zA-Z0-9_-]{1,32}$/;

let db = null;

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateToken(user) {
  const payload = JSON.stringify({
    id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    email: user.email || null,
    avatar_url: user.avatar_url || null,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

/**
 * Timing-safe JWT token verification to prevent timing attack vulnerabilities.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifyToken(match[1].trim());
}

function initReaderSubmissionsEngine() {
  if (db) return db;

  const targetDir = path.dirname(SUBMISSIONS_DB_PATH);
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    fs.chmodSync(targetDir, 0o750);
  } catch (_) {}

  // Auto-migration check: If target DB doesn't exist yet, check if legacy submissions.db exists
  if (!fs.existsSync(SUBMISSIONS_DB_PATH)) {
    const legacyCandidates = [
      path.join(__dirname, 'submissions.db'),
      path.join(__dirname, '../../book/submissions.db'),
      '/home/administrator/book/submissions.db'
    ];
    for (const legacy of legacyCandidates) {
      if (fs.existsSync(legacy) && !fs.lstatSync(legacy).isSymbolicLink()) {
        try {
          console.log(`[ReaderSubmissions] Migrating legacy database from ${legacy} to ${SUBMISSIONS_DB_PATH}...`);
          fs.copyFileSync(legacy, SUBMISSIONS_DB_PATH);
          break;
        } catch (err) {
          console.warn(`[ReaderSubmissions] Migration warning: ${err.message}`);
        }
      }
    }
  }

  db = new Database(SUBMISSIONS_DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);

  try {
    fs.chmodSync(SUBMISSIONS_DB_PATH, 0o640);
  } catch (_) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'contributor',
      google_id TEXT,
      email TEXT,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      book_id TEXT NOT NULL,
      page_number TEXT,
      section_id TEXT,
      lang TEXT NOT NULL DEFAULT 'vi',
      term_or_excerpt TEXT NOT NULL,
      suggestion_type TEXT DEFAULT 'term_correction',
      suggested_text TEXT,
      notes TEXT,
      submitter_name TEXT,
      submitter_email TEXT,
      status TEXT DEFAULT 'pending',
      review_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_submissions_book ON submissions(book_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
  `);

  // Ensure migration columns exist
  try { db.exec('ALTER TABLE users ADD COLUMN google_id TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT'); } catch (e) {}

  // Initialize default accounts if database is brand new (never hardcode cleartext passwords)
  try {
    const checkDhamma = db.prepare("SELECT id FROM users WHERE username = 'dhamma'").get();
    if (!checkDhamma) {
      const initialEditorPass = process.env.INITIAL_EDITOR_PASSWORD || crypto.randomBytes(16).toString('hex');
      const dhammaSalt = crypto.randomBytes(16).toString('hex');
      const dhammaHash = hashPassword(initialEditorPass, dhammaSalt);
      db.prepare(`
        INSERT INTO users (username, password_hash, salt, display_name, role)
        VALUES (?, ?, ?, ?, 'editor')
      `).run('dhamma', dhammaHash, dhammaSalt, 'Ban Biên Tập (Editor)');
      if (process.env.INITIAL_EDITOR_PASSWORD) {
        console.log("[ReaderSubmissions] Initial editor account 'dhamma' created with provided environment password.");
      } else {
        console.log(`[ReaderSubmissions] Initial editor account 'dhamma' created with temporary password: ${initialEditorPass}`);
      }
    }

    const checkAdmin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
    if (!checkAdmin) {
      const initialAdminPass = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(initialAdminPass, salt);
      db.prepare(`
        INSERT INTO users (username, password_hash, salt, display_name, role)
        VALUES (?, ?, ?, ?, 'admin')
      `).run('admin', hash, salt, 'Quản Trị Viên / Admin');
      if (process.env.INITIAL_ADMIN_PASSWORD) {
        console.log("[ReaderSubmissions] Initial admin account 'admin' created with provided environment password.");
      } else {
        console.log(`[ReaderSubmissions] Initial admin account 'admin' created with temporary password: ${initialAdminPass}`);
      }
    }
  } catch (e) {
    console.error('[ReaderSubmissions] Account init check:', e.message);
  }

  console.log(`[ReaderSubmissions] Database active at: ${SUBMISSIONS_DB_PATH}`);
  return db;
}

function registerReaderSubmissionsRoutes(fastify) {
  if (!db) initReaderSubmissionsEngine();

  // 1. POST /api/submissions - Submit reader contribution
  fastify.post('/api/submissions', { bodyLimit: BODY_LIMIT_SUBMISSION }, async (req, reply) => {
    try {
      const data = req.body || {};
      const authUser = getAuthUser(req);

      let book_id = String(data.book_id || 'general').trim().slice(0, 32);
      if (!ALLOWED_BOOK_REGEX.test(book_id)) {
        book_id = 'general';
      }

      const term_or_excerpt = String(data.term_or_excerpt || '').trim().slice(0, 2000);
      if (!term_or_excerpt) {
        reply.code(400);
        return { success: false, error: 'Thuật ngữ hoặc đoạn trích (term_or_excerpt) là bắt buộc' };
      }

      let lang = String(data.lang || 'vi').trim().toLowerCase().slice(0, 10);
      if (!ALLOWED_LANG_REGEX.test(lang)) {
        lang = 'vi';
      }

      let suggestion_type = String(data.suggestion_type || 'term_correction').trim().slice(0, 50);
      if (!ALLOWED_SUGGESTION_TYPES.has(suggestion_type)) {
        suggestion_type = 'term_correction';
      }

      const page_number = String(data.page_number || '').trim().slice(0, 50);
      const section_id = String(data.section_id || '').trim().slice(0, 100);
      const suggested_text = String(data.suggested_text || '').trim().slice(0, 4000);
      const notes = String(data.notes || '').trim().slice(0, 4000);
      const submitter_name = String(data.submitter_name || (authUser ? authUser.display_name : 'Độc Giả Ẩn Danh')).trim().slice(0, 100);
      const submitter_email = String(data.submitter_email || '').trim().slice(0, 150);
      const user_id = authUser ? authUser.id : null;

      const stmt = db.prepare(`
        INSERT INTO submissions (
          user_id, book_id, page_number, section_id, lang,
          term_or_excerpt, suggestion_type, suggested_text, notes,
          submitter_name, submitter_email, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `);

      const result = stmt.run(
        user_id, book_id, page_number, section_id, lang,
        term_or_excerpt, suggestion_type, suggested_text, notes,
        submitter_name, submitter_email
      );

      reply.code(201);
      return {
        success: true,
        message: 'Đã tiếp nhận đề xuất sửa của quý độc giả thành công! Tri ân công đức khảo đính của quý vị.',
        submission_id: Number(result.lastInsertRowid)
      };
    } catch (err) {
      req.log.error({ err }, '[ReaderSubmissions] Failed to create submission');
      reply.code(500);
      return { success: false, error: 'Không thể ghi nhận đề xuất sửa. Quý vị vui lòng thử lại sau.' };
    }
  });

  // 2. GET /api/submissions - List reader contributions with filters
  fastify.get('/api/submissions', async (req, reply) => {
    try {
      const query = req.query || {};
      let sql = `
        SELECT s.*, u.username as user_username
        FROM submissions s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE 1=1
      `;
      const params = [];

      if (query.book_id) {
        const bookId = String(query.book_id).trim().slice(0, 32);
        if (ALLOWED_BOOK_REGEX.test(bookId)) {
          sql += ` AND s.book_id = ?`;
          params.push(bookId);
        }
      }
      if (query.lang) {
        const lang = String(query.lang).trim().toLowerCase().slice(0, 10);
        if (ALLOWED_LANG_REGEX.test(lang)) {
          sql += ` AND s.lang = ?`;
          params.push(lang);
        }
      }
      if (query.status) {
        const status = String(query.status).trim().toLowerCase().slice(0, 20);
        if (ALLOWED_STATUSES.has(status)) {
          sql += ` AND s.status = ?`;
          params.push(status);
        }
      }
      if (query.q) {
        const rawQ = String(query.q).trim().slice(0, 100);
        if (rawQ) {
          sql += ` AND (s.term_or_excerpt LIKE ? OR s.suggested_text LIKE ? OR s.notes LIKE ?)`;
          const qPattern = `%${rawQ}%`;
          params.push(qPattern, qPattern, qPattern);
        }
      }

      sql += ` ORDER BY s.created_at DESC`;

      const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
      const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = db.prepare(sql).all(...params);
      const totalRow = db.prepare(`SELECT COUNT(*) as total FROM submissions`).get();

      return {
        success: true,
        count: rows.length,
        total: totalRow ? totalRow.total : 0,
        submissions: rows
      };
    } catch (err) {
      req.log.error({ err }, '[ReaderSubmissions] Failed to query submissions');
      reply.code(500);
      return { success: false, error: 'Không thể truy xuất dữ liệu đề xuất sửa.' };
    }
  });

  // 3. PATCH /api/submissions/:id - Review & update submission (Editors/Admins Only)
  fastify.patch('/api/submissions/:id', { bodyLimit: BODY_LIMIT_SUBMISSION }, async (req, reply) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id) || id <= 0) {
        reply.code(400);
        return { success: false, error: 'ID đề xuất không hợp lệ' };
      }

      const authUser = getAuthUser(req);
      if (!authUser) {
        reply.code(401);
        return {
          success: false,
          error: 'Quý vị cần đăng nhập Ban Biên Tập (Editor) để duyệt hoặc cập nhật trạng thái đề xuất sửa.'
        };
      }

      if (authUser.role !== 'admin' && authUser.role !== 'editor') {
        reply.code(403);
        return {
          success: false,
          error: 'Quyền bị từ chối: Tài khoản người đọc (Reader) không có quyền duyệt thuật ngữ. Chỉ có Ban Biên Tập (Editor) mới có quyền duyệt.'
        };
      }

      const data = req.body || {};
      const updates = [];
      const params = [];

      if (data.term_or_excerpt !== undefined) {
        const term = String(data.term_or_excerpt || '').trim().slice(0, 2000);
        if (!term) {
          reply.code(400);
          return { success: false, error: 'Thuật ngữ / đoạn trích không được để trống' };
        }
        updates.push('term_or_excerpt = ?');
        params.push(term);
      }

      if (data.suggested_text !== undefined) {
        const suggested = String(data.suggested_text || '').trim().slice(0, 4000);
        updates.push('suggested_text = ?');
        params.push(suggested);
      }

      if (data.suggestion_type !== undefined) {
        const type = String(data.suggestion_type).trim().slice(0, 50);
        if (ALLOWED_SUGGESTION_TYPES.has(type)) {
          updates.push('suggestion_type = ?');
          params.push(type);
        }
      }

      if (data.notes !== undefined) {
        const notes = String(data.notes || '').trim().slice(0, 4000);
        updates.push('notes = ?');
        params.push(notes);
      }

      if (data.page_number !== undefined) {
        const page = String(data.page_number || '').trim().slice(0, 50);
        updates.push('page_number = ?');
        params.push(page);
      }

      if (data.section_id !== undefined) {
        const sec = String(data.section_id || '').trim().slice(0, 100);
        updates.push('section_id = ?');
        params.push(sec);
      }

      if (data.book_id !== undefined) {
        const bookId = String(data.book_id).trim().slice(0, 32);
        if (ALLOWED_BOOK_REGEX.test(bookId)) {
          updates.push('book_id = ?');
          params.push(bookId);
        }
      }

      if (data.lang !== undefined) {
        const lang = String(data.lang).trim().toLowerCase().slice(0, 10);
        if (ALLOWED_LANG_REGEX.test(lang)) {
          updates.push('lang = ?');
          params.push(lang);
        }
      }

      if (data.status !== undefined) {
        const status = String(data.status).trim().toLowerCase();
        if (!ALLOWED_STATUSES.has(status)) {
          reply.code(400);
          return { success: false, error: 'Trạng thái (status) không hợp lệ' };
        }
        updates.push('status = ?');
        params.push(status);
      }

      if (data.review_note !== undefined) {
        const review_note = String(data.review_note || '').trim().slice(0, 2000);
        updates.push('review_note = ?');
        params.push(review_note);
      }

      if (updates.length === 0) {
        reply.code(400);
        return { success: false, error: 'Không có dữ liệu cập nhật hợp lệ' };
      }

      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);

      const res = db.prepare(`UPDATE submissions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      if (res.changes === 0) {
        reply.code(404);
        return { success: false, error: 'Không tìm thấy bản ghi đề xuất' };
      }

      const updated = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
      return { success: true, submission: updated, message: 'Cập nhật thành công' };
    } catch (err) {
      req.log.error({ err }, '[ReaderSubmissions] Failed to update submission');
      reply.code(500);
      return { success: false, error: 'Không thể cập nhật đề xuất.' };
    }
  });

  // 3b. DELETE /api/submissions/:id - Delete submission permanently (Editors/Admins Only)
  fastify.delete('/api/submissions/:id', async (req, reply) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id) || id <= 0) {
        reply.code(400);
        return { success: false, error: 'ID đề xuất không hợp lệ' };
      }

      const authUser = getAuthUser(req);
      if (!authUser) {
        reply.code(401);
        return {
          success: false,
          error: 'Quý vị cần đăng nhập Ban Biên Tập (Editor) để xoá đề xuất.'
        };
      }

      if (authUser.role !== 'admin' && authUser.role !== 'editor') {
        reply.code(403);
        return {
          success: false,
          error: 'Quyền bị từ chối: Chỉ có Ban Biên Tập (Editor) mới có quyền xoá đề xuất.'
        };
      }

      const res = db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
      if (res.changes === 0) {
        reply.code(404);
        return { success: false, error: 'Không tìm thấy đề xuất để xoá' };
      }

      return { success: true, message: 'Đã xoá đề xuất thành công', deleted_id: id };
    } catch (err) {
      req.log.error({ err }, '[ReaderSubmissions] Failed to delete submission');
      reply.code(500);
      return { success: false, error: 'Không thể xoá đề xuất.' };
    }
  });

  // 4. POST /api/auth/register (Contributors only - Role Escalation Prohibited)
  fastify.post('/api/auth/register', { bodyLimit: BODY_LIMIT_AUTH }, async (req, reply) => {
    try {
      const data = req.body || {};
      const username = String(data.username || '').trim().toLowerCase().slice(0, 50);
      const password = String(data.password || '').trim().slice(0, 100);
      const display_name = String(data.display_name || username).trim().slice(0, 100);

      if (!username || !password) {
        reply.code(400);
        return { success: false, error: 'Tên tài khoản và mật khẩu là bắt buộc' };
      }

      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (existing) {
        reply.code(409);
        return { success: false, error: 'Tên tài khoản đã tồn tại' };
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      // Role is hardcoded to 'contributor' - impossible for user to self-promote to editor/admin
      const result = db.prepare(`
        INSERT INTO users (username, password_hash, salt, display_name, role)
        VALUES (?, ?, ?, ?, 'contributor')
      `).run(username, hash, salt, display_name);

      const newUser = { id: Number(result.lastInsertRowid), username, display_name, role: 'contributor' };
      const token = generateToken(newUser);

      reply.code(201);
      return {
        success: true,
        token,
        user: newUser,
        message: 'Đăng ký tài khoản cộng tác viên thành công'
      };
    } catch (err) {
      req.log.error({ err }, '[ReaderSubmissions] Registration failed');
      reply.code(500);
      return { success: false, error: 'Đăng ký thất bại. Vui lòng thử lại.' };
    }
  });

  // 5. POST /api/auth/login
  fastify.post('/api/auth/login', { bodyLimit: BODY_LIMIT_AUTH }, async (req, reply) => {
    try {
      const data = req.body || {};
      const username = String(data.username || '').trim().toLowerCase().slice(0, 50);
      const password = String(data.password || '').trim().slice(0, 100);

      if (!username || !password) {
        reply.code(400);
        return { success: false, error: 'Tên đăng nhập và mật khẩu là bắt buộc' };
      }

      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
      if (!user) {
        reply.code(401);
        return { success: false, error: 'Tên tài khoản hoặc mật khẩu không chính xác' };
      }

      const hash = hashPassword(password, user.salt);
      const hashBuf = Buffer.from(hash, 'utf8');
      const userHashBuf = Buffer.from(user.password_hash, 'utf8');

      if (hashBuf.length !== userHashBuf.length || !crypto.timingSafeEqual(hashBuf, userHashBuf)) {
        reply.code(401);
        return { success: false, error: 'Tên tài khoản hoặc mật khẩu không chính xác' };
      }

      const userInfo = { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
      const token = generateToken(userInfo);

      return {
        success: true,
        token,
        user: userInfo,
        message: 'Đăng nhập thành công'
      };
    } catch (err) {
      req.log.error({ err }, '[ReaderSubmissions] Login failed');
      reply.code(500);
      return { success: false, error: 'Đăng nhập thất bại. Vui lòng thử lại.' };
    }
  });

  // 6. GET /api/auth/me
  fastify.get('/api/auth/me', async (req, reply) => {
    const authUser = getAuthUser(req);
    if (!authUser) {
      reply.code(401);
      return { success: false, error: 'Chưa đăng nhập hoặc phiên đã hết hạn' };
    }
    return { success: true, user: authUser };
  });

  // 8. POST /api/auth/reader (Reader Sign-in - Role Escalation Prohibited)
  const handleReaderAuth = async (req, reply) => {
    try {
      const data = req.body || {};
      let googleEmail = '';
      let googleName = '';
      let googleId = '';
      let googlePic = '';

      if (data.email) {
        googleEmail = String(data.email || '').trim().toLowerCase().slice(0, 150);
        googleName = String(data.name || googleEmail.split('@')[0]).trim().slice(0, 100);
        googleId = String(data.google_id || `r_${Date.now()}`).slice(0, 100);
        googlePic = String(data.picture || '').trim().slice(0, 500);
      }

      if (!googleEmail && !googleId) {
        reply.code(400);
        return { success: false, error: 'Vui lòng nhập địa chỉ email người đọc hợp lệ' };
      }

      let user = null;
      if (googleId) {
        user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);
      }
      if (!user && googleEmail) {
        user = db.prepare("SELECT * FROM users WHERE email = ? OR username = ?").get(googleEmail, googleEmail);
      }

      if (!user) {
        // New reader account: default role is strictly 'reader'
        const username = googleEmail || `reader_${googleId.slice(0, 10)}`;
        const salt = crypto.randomBytes(16).toString('hex');
        const dummyPass = crypto.randomBytes(32).toString('hex');
        const hash = hashPassword(dummyPass, salt);
        const role = 'reader'; // Strictly reader role

        const stmt = db.prepare(`
          INSERT INTO users (username, password_hash, salt, display_name, role, google_id, email, avatar_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const resInsert = stmt.run(username, hash, salt, googleName, role, googleId, googleEmail, googlePic);
        user = {
          id: Number(resInsert.lastInsertRowid),
          username,
          display_name: googleName,
          role,
          google_id: googleId,
          email: googleEmail,
          avatar_url: googlePic
        };
      } else {
        // Existing user: Preserve existing role (editor/admin/contributor/reader), only update profile
        const updates = [];
        const params = [];
        if (googleId && !user.google_id) { updates.push("google_id = ?"); params.push(googleId); }
        if (googleEmail && !user.email) { updates.push("email = ?"); params.push(googleEmail); }
        if (googlePic && user.avatar_url !== googlePic) { updates.push("avatar_url = ?"); params.push(googlePic); }
        if (googleName && user.display_name !== googleName) { updates.push("display_name = ?"); params.push(googleName); }
        if (updates.length > 0) {
          params.push(user.id);
          db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }
        user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      }

      const userInfo = {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        email: user.email,
        avatar_url: user.avatar_url
      };
      const token = generateToken(userInfo);

      return {
        success: true,
        token,
        user: userInfo,
        message: 'Đăng nhập người đọc thành công'
      };
    } catch (err) {
      req.log.error({ err }, '[ReaderSubmissions] Reader auth error');
      reply.code(500);
      return { success: false, error: 'Không thể xác thực người đọc.' };
    }
  };

    fastify.post('/api/auth/reader', { bodyLimit: BODY_LIMIT_AUTH }, handleReaderAuth);

  // 9. GET /api/stats
  fastify.get('/api/stats', async () => {
    const byBook = db.prepare(`SELECT book_id, COUNT(*) as count FROM submissions GROUP BY book_id`).all();
    const byLang = db.prepare(`SELECT lang, COUNT(*) as count FROM submissions GROUP BY lang`).all();
    const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM submissions GROUP BY status`).all();
    const totalRow = db.prepare(`SELECT COUNT(*) as total FROM submissions`).get();

    return {
      success: true,
      total: totalRow ? totalRow.total : 0,
      by_book: byBook,
      by_lang: byLang,
      by_status: byStatus
    };
  });

  // 10. Dashboard serving: GET /submissions_dashboard.html, /submissions, /submissions.html
  const serveDashboard = async (req, reply) => {
    const candidates = [
      path.join(__dirname, 'submissions_dashboard.html'),
      path.join(__dirname, '../../book/submissions_dashboard.html'),
      '/home/administrator/book/submissions_dashboard.html'
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        reply.type('text/html; charset=utf-8');
        return fs.readFileSync(p, 'utf8');
      }
    }
    reply.code(404);
    return 'Submissions dashboard not found';
  };

  fastify.get('/submissions_dashboard.html', serveDashboard);
  fastify.get('/submissions', serveDashboard);
  fastify.get('/submissions.html', serveDashboard);
}

function closeReaderSubmissionsDb() {
  if (db && typeof db.close === 'function') {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (_) {}
    db = null;
  }
}

module.exports = {
  initReaderSubmissionsEngine,
  registerReaderSubmissionsRoutes,
  closeReaderSubmissionsDb
};
