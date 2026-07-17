const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const db = require('./lib/db');
const auth = require('./lib/auth');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || config.port || 3000;
// On Railway/Render (or any host behind HTTPS), set COOKIE_SECURE=true so
// session cookies are only sent over HTTPS. Leave unset for local http testing.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
function cookieFlags(maxAgeSeconds) {
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${COOKIE_SECURE ? '; Secure' : ''}`;
}

// ---------- bootstrap default admin ----------
function bootstrap() {
  db.ensureFile('users', []);
  db.ensureFile('products', []);
  db.ensureFile('orders', []);
  db.ensureFile('sessions', []);

  const users = db.readAll('users');
  if (!users.find((u) => u.role === 'admin')) {
    const { salt, hash } = auth.hashPassword('admin123');
    db.insert('users', {
      username: 'admin',
      email: 'admin@trustlink.local',
      salt,
      hash,
      role: 'admin',
      createdAt: Date.now(),
    });
    console.log('>>> Default admin created: username="admin" password="admin123" (change this!)');
  }
}
bootstrap();

// ---------- helpers ----------
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 15 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function getCurrentUser(req) {
  const cookies = auth.parseCookies(req);
  return auth.getUserFromToken(cookies.token);
}

function safeUser(u) {
  if (!u) return null;
  const { salt, hash, ...rest } = u;
  return rest;
}

function safeProduct(p, viewer) {
  const canSeeCode = viewer && (viewer.role === 'admin' || viewer.id === p.sellerId);
  const { deliveryCode, ...rest } = p;
  return canSeeCode ? p : rest;
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------- API handlers ----------
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const parts = r.pattern.split('/').filter(Boolean);
    const uparts = pathname.split('/').filter(Boolean);
    if (parts.length !== uparts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) {
        params[parts[i].slice(1)] = decodeURIComponent(uparts[i]);
      } else if (parts[i] !== uparts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

// ---- Auth ----
route('POST', '/api/register', async (req, res) => {
  const body = await readBody(req);
  const { username, email, password, role } = body;
  if (!username || !password || !['buyer', 'seller'].includes(role)) {
    return sendJSON(res, 400, { error: 'username, password, role(buyer/seller) required' });
  }
  const users = db.readAll('users');
  if (users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return sendJSON(res, 400, { error: 'Username already taken' });
  }
  const { salt, hash } = auth.hashPassword(password);
  const user = db.insert('users', {
    username,
    email: email || '',
    salt,
    hash,
    role,
    createdAt: Date.now(),
  });
  const token = auth.createSession(user.id);
  res.setHeader('Set-Cookie', `token=${token}; ${cookieFlags(60 * 60 * 24 * 7)}`);
  sendJSON(res, 200, { user: safeUser(user) });
});

route('POST', '/api/login', async (req, res) => {
  const body = await readBody(req);
  const { username, password } = body;
  const users = db.readAll('users');
  const user = users.find((u) => u.username.toLowerCase() === (username || '').toLowerCase());
  if (!user || !auth.verifyPassword(password || '', user.salt, user.hash)) {
    return sendJSON(res, 401, { error: 'Invalid username or password' });
  }
  const token = auth.createSession(user.id);
  res.setHeader('Set-Cookie', `token=${token}; ${cookieFlags(60 * 60 * 24 * 7)}`);
  sendJSON(res, 200, { user: safeUser(user) });
});

route('POST', '/api/logout', async (req, res) => {
  const cookies = auth.parseCookies(req);
  if (cookies.token) auth.destroySession(cookies.token);
  res.setHeader('Set-Cookie', `token=; ${cookieFlags(0)}`);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res) => {
  const user = getCurrentUser(req);
  sendJSON(res, 200, { user: safeUser(user) });
});

route('GET', '/api/config', async (req, res) => {
  sendJSON(res, 200, { payment: config.payment, siteName: config.siteName });
});

// ---- Products ----
route('GET', '/api/products', async (req, res) => {
  const viewer = getCurrentUser(req);
  const products = db.readAll('products').filter((p) => p.status === 'active');
  sendJSON(res, 200, { products: products.map((p) => safeProduct(p, viewer)) });
});

route('GET', '/api/products/:id', async (req, res, params) => {
  const viewer = getCurrentUser(req);
  const p = db.findById('products', Number(params.id));
  if (!p) return sendJSON(res, 404, { error: 'Not found' });
  sendJSON(res, 200, { product: safeProduct(p, viewer) });
});

route('POST', '/api/products', async (req, res) => {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'seller') return sendJSON(res, 403, { error: 'Seller login required' });
  const body = await readBody(req);
  const { title, description, category, price, deliveryCode } = body;
  if (!title || !price || !deliveryCode) {
    return sendJSON(res, 400, { error: 'title, price, deliveryCode required' });
  }
  const product = db.insert('products', {
    sellerId: user.id,
    sellerUsername: user.username,
    title,
    description: description || '',
    category: category || 'Other',
    price: Number(price),
    deliveryCode,
    status: 'active',
    createdAt: Date.now(),
  });
  sendJSON(res, 200, { product });
});

route('PUT', '/api/products/:id', async (req, res, params) => {
  const user = getCurrentUser(req);
  const p = db.findById('products', Number(params.id));
  if (!p) return sendJSON(res, 404, { error: 'Not found' });
  if (!user || (user.role !== 'admin' && user.id !== p.sellerId)) {
    return sendJSON(res, 403, { error: 'Not allowed' });
  }
  const body = await readBody(req);
  const patch = {};
  ['title', 'description', 'category', 'price', 'deliveryCode', 'status'].forEach((k) => {
    if (body[k] !== undefined) patch[k] = k === 'price' ? Number(body[k]) : body[k];
  });
  const updated = db.update('products', p.id, patch);
  sendJSON(res, 200, { product: updated });
});

route('DELETE', '/api/products/:id', async (req, res, params) => {
  const user = getCurrentUser(req);
  const p = db.findById('products', Number(params.id));
  if (!p) return sendJSON(res, 404, { error: 'Not found' });
  if (!user || (user.role !== 'admin' && user.id !== p.sellerId)) {
    return sendJSON(res, 403, { error: 'Not allowed' });
  }
  db.remove('products', p.id);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/seller/products', async (req, res) => {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'seller') return sendJSON(res, 403, { error: 'Seller login required' });
  const products = db.readAll('products').filter((p) => p.sellerId === user.id);
  sendJSON(res, 200, { products });
});

// ---- Orders ----
route('POST', '/api/orders', async (req, res) => {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'buyer') return sendJSON(res, 403, { error: 'Buyer login required' });
  const body = await readBody(req);
  const product = db.findById('products', Number(body.productId));
  if (!product || product.status !== 'active') {
    return sendJSON(res, 400, { error: 'Product not available' });
  }
  const order = db.insert('orders', {
    productId: product.id,
    productTitle: product.title,
    buyerId: user.id,
    buyerUsername: user.username,
    sellerId: product.sellerId,
    sellerUsername: product.sellerUsername,
    amount: product.price,
    status: 'pending_payment',
    txnId: null,
    screenshot: null,
    deliveredCode: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  db.update('products', product.id, { status: 'reserved' });
  sendJSON(res, 200, { order, payment: config.payment });
});

route('GET', '/api/orders', async (req, res) => {
  const user = getCurrentUser(req);
  if (!user) return sendJSON(res, 403, { error: 'Login required' });
  let orders = db.readAll('orders');
  if (user.role === 'buyer') orders = orders.filter((o) => o.buyerId === user.id);
  else if (user.role === 'seller') orders = orders.filter((o) => o.sellerId === user.id);
  // admin sees all
  // hide delivered code from anyone except buyer/admin after approval (already fine since only set on approval)
  sendJSON(res, 200, { orders });
});

route('POST', '/api/orders/:id/submit-payment', async (req, res, params) => {
  const user = getCurrentUser(req);
  const order = db.findById('orders', Number(params.id));
  if (!order) return sendJSON(res, 404, { error: 'Not found' });
  if (!user || user.id !== order.buyerId) return sendJSON(res, 403, { error: 'Not allowed' });
  if (order.status !== 'pending_payment') return sendJSON(res, 400, { error: 'Order not awaiting payment' });
  const body = await readBody(req);
  if (!body.txnId) return sendJSON(res, 400, { error: 'Transaction ID required' });
  const updated = db.update('orders', order.id, {
    txnId: body.txnId,
    screenshot: body.screenshot || null,
    status: 'submitted',
    updatedAt: Date.now(),
  });
  sendJSON(res, 200, { order: updated });
});

route('POST', '/api/orders/:id/approve', async (req, res, params) => {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
  const order = db.findById('orders', Number(params.id));
  if (!order) return sendJSON(res, 404, { error: 'Not found' });
  if (order.status !== 'submitted') return sendJSON(res, 400, { error: 'Order not in submitted state' });
  const product = db.findById('products', order.productId);
  const updated = db.update('orders', order.id, {
    status: 'completed',
    deliveredCode: product ? product.deliveryCode : null,
    updatedAt: Date.now(),
  });
  if (product) db.update('products', product.id, { status: 'sold' });
  sendJSON(res, 200, { order: updated });
});

route('POST', '/api/orders/:id/reject', async (req, res, params) => {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'admin') return sendJSON(res, 403, { error: 'Admin only' });
  const order = db.findById('orders', Number(params.id));
  if (!order) return sendJSON(res, 404, { error: 'Not found' });
  const body = await readBody(req);
  const updated = db.update('orders', order.id, {
    status: 'rejected',
    rejectReason: body.reason || 'Payment not verified',
    updatedAt: Date.now(),
  });
  const product = db.findById('products', order.productId);
  if (product && product.status === 'reserved') db.update('products', product.id, { status: 'active' });
  sendJSON(res, 200, { order: updated });
});

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    const match = matchRoute(req.method, pathname);
    if (!match) return sendJSON(res, 404, { error: 'No such API route' });
    try {
      await match.handler(req, res, match.params);
    } catch (e) {
      console.error(e);
      sendJSON(res, 500, { error: 'Server error' });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`TrustLink Market running at http://localhost:${PORT}`);
});
