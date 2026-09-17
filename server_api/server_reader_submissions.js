// server_reader_submissions.js - Node.js SQLite3 Reader Contribution & Terminology Submission Service
// Zero-dependency native Node.js (Node 24) HTTP + node:sqlite + crypto server

const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.SUBMISSIONS_DB_PATH || path.join(__dirname, 'submissions.db');
const JWT_SECRET = process.env.JWT_SECRET || 'nibbanagamini-reader-secret-key-2026';

// Initialize SQLite database
const db = new DatabaseSync(DB_PATH);
try {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
} catch (e) {}

// Create tables if they do not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    display_name TEXT,
    role TEXT DEFAULT 'contributor',
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

// Migration: Ensure Google Auth columns exist in users table
try { db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN email TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`); } catch (e) {}

// Initialize default accounts if database is brand new (never hardcode cleartext passwords)
try {
  const checkDhamma = db.prepare("SELECT id FROM users WHERE username = 'dhamma'").get();
  if (!checkDhamma) {
    const initialEditorPass = process.env.INITIAL_EDITOR_PASSWORD || crypto.randomBytes(16).toString('hex');
    const dhammaSalt = crypto.randomBytes(16).toString('hex');
    const dhammaHash = crypto.pbkdf2Sync(initialEditorPass, dhammaSalt, 100000, 64, 'sha512').toString('hex');
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, display_name, role)
      VALUES (?, ?, ?, ?, 'editor')
    `).run('dhamma', dhammaHash, dhammaSalt, 'Ban Biên Tập (Editor)');
  }

  const checkAdmin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!checkAdmin) {
    const initialAdminPass = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(initialAdminPass, salt, 100000, 64, 'sha512').toString('hex');
    db.prepare(`
      INSERT INTO users (username, password_hash, salt, display_name, role)
      VALUES (?, ?, ?, ?, 'admin')
    `).run('admin', hash, salt, 'Quản Trị Viên / Admin');
  }
} catch (e) {
  console.error("Editor / Admin init check error:", e);
}

// Helpers
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
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('base64url');
  if (sig !== expectedSig) return null;
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
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return verifyToken(token);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) { // 2MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const query = Object.fromEntries(parsedUrl.searchParams);

  try {
    // ----------------------------------------------------
    // API: SUBMISSIONS
    // ----------------------------------------------------

    // POST /api/submissions (Submit term / excerpt feedback)
    if (req.method === 'POST' && pathname === '/api/submissions') {
      const data = await parseBody(req);
      const authUser = getAuthUser(req);

      const book_id = (data.book_id || 'general').trim();
      const term_or_excerpt = (data.term_or_excerpt || '').trim();
      if (!term_or_excerpt) {
        return sendJson(res, 400, { success: false, error: 'term_or_excerpt is required' });
      }

      const page_number = (data.page_number || '').trim();
      const section_id = (data.section_id || '').trim();
      const lang = (data.lang || 'vi').trim();
      const suggestion_type = (data.suggestion_type || 'term_correction').trim();
      const suggested_text = (data.suggested_text || '').trim();
      const notes = (data.notes || '').trim();
      const submitter_name = (data.submitter_name || (authUser ? authUser.display_name : 'Độc Giả Ẩn Danh')).trim();
      const submitter_email = (data.submitter_email || '').trim();
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

      return sendJson(res, 201, {
        success: true,
        message: 'Đã tiếp nhận đề xuất sửa của quý độc giả thành công! Tri ân công đức khảo đính của quý vị.',
        submission_id: result.lastInsertRowid
      });
    }

    // GET /api/submissions (List submissions with filter)
    if (req.method === 'GET' && pathname === '/api/submissions') {
      let sql = `
        SELECT s.*, u.username as user_username
        FROM submissions s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE 1=1
      `;
      const params = [];

      if (query.book_id) {
        sql += ` AND s.book_id = ?`;
        params.push(query.book_id);
      }
      if (query.lang) {
        sql += ` AND s.lang = ?`;
        params.push(query.lang);
      }
      if (query.status) {
        sql += ` AND s.status = ?`;
        params.push(query.status);
      }
      if (query.q) {
        sql += ` AND (s.term_or_excerpt LIKE ? OR s.suggested_text LIKE ? OR s.notes LIKE ?)`;
        const qPattern = `%${query.q}%`;
        params.push(qPattern, qPattern, qPattern);
      }

      sql += ` ORDER BY s.created_at DESC`;

      const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const rows = db.prepare(sql).all(...params);
      const countSql = `SELECT COUNT(*) as total FROM submissions`;
      const totalRow = db.prepare(countSql).get();

      return sendJson(res, 200, {
        success: true,
        count: rows.length,
        total: totalRow ? totalRow.total : 0,
        submissions: rows
      });
    }

    // PATCH /api/submissions/:id (Update status / review note - Editors Only)
    const matchSubId = pathname.match(/^\/api\/submissions\/(\d+)$/);
    if (req.method === 'PATCH' && matchSubId) {
      const id = parseInt(matchSubId[1], 10);
      const data = await parseBody(req);
      const authUser = getAuthUser(req);

      if (!authUser) {
        return sendJson(res, 401, {
          success: false,
          error: 'Quý vị cần đăng nhập Ban Biên Tập (Editor) để duyệt hoặc cập nhật trạng thái đề xuất sửa.'
        });
      }

      if (authUser.role !== 'admin' && authUser.role !== 'editor') {
        return sendJson(res, 403, {
          success: false,
          error: 'Quyền bị từ chối: Tài khoản người đọc (Reader) không có quyền duyệt thuật ngữ. Chỉ có Ban Biên Tập (Editor) mới có quyền duyệt.'
        });
      }

      const status = data.status;
      const review_note = data.review_note;

      const updates = [];
      const params = [];

      if (status) {
        updates.push('status = ?');
        params.push(status);
      }
      if (review_note !== undefined) {
        updates.push('review_note = ?');
        params.push(review_note);
      }
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);

      if (updates.length > 1) {
        db.prepare(`UPDATE submissions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }

      const updated = db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
      return sendJson(res, 200, { success: true, submission: updated, message: 'Cập nhật trạng thái thành công' });
    }

    // ----------------------------------------------------
    // API: AUTHENTICATION
    // ----------------------------------------------------

    // POST /api/auth/register
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const data = await parseBody(req);
      const username = (data.username || '').trim().toLowerCase();
      const password = (data.password || '').trim();
      const display_name = (data.display_name || username).trim();

      if (!username || !password) {
        return sendJson(res, 400, { success: false, error: 'Tên tài khoản và mật khẩu là bắt buộc' });
      }

      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (existing) {
        return sendJson(res, 409, { success: false, error: 'Tên tài khoản đã tồn tại' });
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = hashPassword(password, salt);

      const result = db.prepare(`
        INSERT INTO users (username, password_hash, salt, display_name, role)
        VALUES (?, ?, ?, ?, 'contributor')
      `).run(username, hash, salt, display_name);

      const newUser = { id: result.lastInsertRowid, username, display_name, role: 'contributor' };
      const token = generateToken(newUser);

      return sendJson(res, 201, {
        success: true,
        token,
        user: newUser,
        message: 'Đăng ký tài khoản cộng tác viên thành công'
      });
    }

    // POST /api/auth/login
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const data = await parseBody(req);
      const username = (data.username || '').trim().toLowerCase();
      const password = (data.password || '').trim();

      if (!username || !password) {
        return sendJson(res, 400, { success: false, error: 'Tên đăng nhập và mật khẩu là bắt buộc' });
      }

      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
      if (!user) {
        return sendJson(res, 401, { success: false, error: 'Tên tài khoản hoặc mật khẩu không chính xác' });
      }

      const hash = hashPassword(password, user.salt);
      if (hash !== user.password_hash) {
        return sendJson(res, 401, { success: false, error: 'Tên tài khoản hoặc mật khẩu không chính xác' });
      }

      const userInfo = { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
      const token = generateToken(userInfo);

      return sendJson(res, 200, {
        success: true,
        token,
        user: userInfo,
        message: 'Đăng nhập thành công'
      });
    }

    // GET /api/auth/me
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const authUser = getAuthUser(req);
      if (!authUser) {
        return sendJson(res, 401, { success: false, error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
      }
      return sendJson(res, 200, { success: true, user: authUser });
    }

    // GET /api/auth/config (Get public auth configurations like Google Client ID)
    if (req.method === 'GET' && pathname === '/api/auth/config') {
      return sendJson(res, 200, {
        success: true,
        google_client_id: process.env.GOOGLE_CLIENT_ID || '1047648398418-demo-google-oauth.apps.googleusercontent.com'
      });
    }

    // POST /api/auth/google & /api/auth/reader (Reader Sign-in)
    if (req.method === 'POST' && (pathname === '/api/auth/google' || pathname === '/api/auth/reader')) {
      const data = await parseBody(req);
      let googleEmail = '';
      let googleName = '';
      let googleId = '';
      let googlePic = '';

      if (data.credential) {
        // Attempt verification via Google's tokeninfo endpoint
        try {
          const gRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(data.credential)}`);
          if (gRes.ok) {
            const gData = await gRes.json();
            googleEmail = (gData.email || '').trim().toLowerCase();
            googleName = gData.name || gData.given_name || (googleEmail ? googleEmail.split('@')[0] : 'Độc Giả');
            googleId = gData.sub || '';
            googlePic = gData.picture || '';
          } else {
            // Fallback decode base64url payload
            const parts = data.credential.split('.');
            if (parts.length >= 2) {
              const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
              googleEmail = (payload.email || '').trim().toLowerCase();
              googleName = payload.name || payload.given_name || (googleEmail ? googleEmail.split('@')[0] : 'Độc Giả');
              googleId = payload.sub || '';
              googlePic = payload.picture || '';
            }
          }
        } catch (err) {
          const parts = data.credential.split('.');
          if (parts.length >= 2) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            googleEmail = (payload.email || '').trim().toLowerCase();
            googleName = payload.name || payload.given_name || (googleEmail ? googleEmail.split('@')[0] : 'Độc Giả');
            googleId = payload.sub || '';
            googlePic = payload.picture || '';
          }
        }
      } else if (data.email) {
        // Direct email / reader sign-in
        googleEmail = (data.email || '').trim().toLowerCase();
        googleName = (data.name || googleEmail.split('@')[0]).trim();
        googleId = data.google_id || `r_${Date.now()}`;
        googlePic = data.picture || '';
      }

      if (!googleEmail && !googleId) {
        return sendJson(res, 400, { success: false, error: 'Vui lòng nhập địa chỉ email người đọc hợp lệ' });
      }

      // Find user in SQLite by google_id, email, or username
      let user = null;
      if (googleId) {
        user = db.prepare("SELECT * FROM users WHERE google_id = ?").get(googleId);
      }
      if (!user && googleEmail) {
        user = db.prepare("SELECT * FROM users WHERE email = ? OR username = ?").get(googleEmail, googleEmail);
      }

      if (!user) {
        // Create new user record
        const username = googleEmail || `reader_${googleId.slice(0, 10)}`;
        const salt = crypto.randomBytes(16).toString('hex');
        const dummyPass = crypto.randomBytes(32).toString('hex');
        const hash = hashPassword(dummyPass, salt);
        const role = (googleEmail && (googleEmail.includes('admin') || googleEmail.includes('phuctue'))) ? 'admin' : 'reader';

        const stmt = db.prepare(`
          INSERT INTO users (username, password_hash, salt, display_name, role, google_id, email, avatar_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const resInsert = stmt.run(username, hash, salt, googleName, role, googleId, googleEmail, googlePic);
        user = {
          id: resInsert.lastInsertRowid,
          username,
          display_name: googleName,
          role,
          google_id: googleId,
          email: googleEmail,
          avatar_url: googlePic
        };
      } else {
        // Update user with latest info (preserve admin or editor roles)
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

      return sendJson(res, 200, {
        success: true,
        token,
        user: userInfo,
        message: 'Đăng nhập người đọc thành công'
      });
    }

    // GET /api/stats
    if (req.method === 'GET' && pathname === '/api/stats') {
      const byBook = db.prepare(`SELECT book_id, COUNT(*) as count FROM submissions GROUP BY book_id`).all();
      const byLang = db.prepare(`SELECT lang, COUNT(*) as count FROM submissions GROUP BY lang`).all();
      const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM submissions GROUP BY status`).all();
      const total = db.prepare(`SELECT COUNT(*) as total FROM submissions`).get().total;

      return sendJson(res, 200, {
        success: true,
        total,
        by_book: byBook,
        by_lang: byLang,
        by_status: byStatus
      });
    }

    // Static dashboard serving: GET/HEAD /submissions, /submissions.html, /admin, or /submissions_dashboard.html
    if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/submissions' || pathname === '/submissions.html' || pathname === '/admin' || pathname === '/submissions_dashboard.html')) {
      const dashboardPath = path.join(__dirname, 'submissions_dashboard.html');
      if (fs.existsSync(dashboardPath)) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(dashboardPath).pipe(res);
      }
    }

    // 404 for unknown endpoints
    sendJson(res, 404, { success: false, error: 'Endpoint not found' });
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { success: false, error: 'Internal Server Error', details: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`Reader Submissions & Terminology Service running on:`);
  console.log(`http://${HOST}:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`=======================================================`);
});
