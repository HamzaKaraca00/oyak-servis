const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const webpush = require('web-push');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const app = express();

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'payogum-local-development-secret-change-me');
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set and contain at least 32 characters.');
}
const AUTH_COOKIE = IS_PRODUCTION ? '__Host-payogum_session' : 'payogum_session';
const CSRF_COOKIE = IS_PRODUCTION ? '__Host-payogum_csrf' : 'payogum_csrf';
const SESSION_TTL = process.env.SESSION_TTL || '8h';
const PUBLIC_PATH = path.join(__dirname, 'public');
const DB_KEY = 'payogum-db';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (IS_PRODUCTION && (VAPID_PUBLIC_KEY || VAPID_PRIVATE_KEY) && !PUSH_ENABLED) {
  throw new Error('Production push configuration requires both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
}

if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@payogum.local',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

// ---- Local fallback (used only when no KV env vars are configured, e.g. plain `npm start`) ----
const fs = require('fs');
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'db.json');
const useKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
if (IS_PRODUCTION && !useKv) {
  throw new Error('Production requires KV_REST_API_URL and KV_REST_API_TOKEN. Local JSON storage is disabled in production.');
}
// Vercel KV (the native product) was sunset; Vercel's Storage tab now provisions Upstash Redis
// via the Marketplace, but injects the same KV_REST_API_URL / KV_REST_API_TOKEN env var names.
const kv = useKv
  ? new (require('@upstash/redis').Redis)({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN
    })
  : null;

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readDbLocal() {
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    ensureDirectory(path.dirname(LOCAL_DB_PATH));
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify({ users: [], services: [], logs: [], notifications: [], pushSubscriptions: [] }, null, 2));
  }
  const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { users: [], services: [], logs: [], notifications: [], pushSubscriptions: [] };
  }
}

function writeDbLocal(db) {
  ensureDirectory(path.dirname(LOCAL_DB_PATH));
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2));
}

// ---- Storage layer: Vercel KV in production, local JSON file for local dev ----
async function readDb() {
  if (!useKv) {
    return readDbLocal();
  }

  const raw = await kv.get(DB_KEY);
  if (!raw) {
    const empty = { users: [], services: [], logs: [], notifications: [], pushSubscriptions: [] };
    await kv.set(DB_KEY, JSON.stringify(empty));
    return empty;
  }
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function writeDb(db) {
  if (!useKv) {
    writeDbLocal(db);
    return;
  }
  await kv.set(DB_KEY, JSON.stringify(db));
}

async function ensureSeedData() {
  const db = await readDb();
  const wantedCodes = Array.from({ length: 99 }, (_, index) => String(index + 1).padStart(2, '0'));
  const existingMap = new Map();

  for (const service of db.services || []) {
    const code = String(service.code || '').padStart(2, '0');
    if (code) {
      existingMap.set(code, service);
    }
  }

  const services = Array.isArray(db.services) ? db.services : [];
  for (const code of wantedCodes) {
    if (!existingMap.has(code)) {
      services.push({
        id: `service-${code}`,
        code,
        name: code,
        route: '',
        createdAt: new Date().toISOString()
      });
      existingMap.set(code, true);
    }
  }

  db.services = services.filter((service) => {
    const code = String(service.code || '').padStart(2, '0');
    return !code || wantedCodes.includes(code);
  });

  db.users = Array.isArray(db.users) ? db.users : [];
  db.users.forEach((user) => {
    if (!user.sicilNo) user.sicilNo = user.phone;
  });
  db.logs = Array.isArray(db.logs) ? db.logs : [];
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  db.pushSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];

  const adminExists = db.users.some((user) => user.role === 'admin');
  // Never create a known/default admin credential. Provision an initial admin only when
  // an explicit environment password is supplied by the deployer.
  if (!adminExists && process.env.ADMIN_INITIAL_PASSWORD) {
    if (String(process.env.ADMIN_INITIAL_PASSWORD).length < 12) {
      throw new Error('ADMIN_INITIAL_PASSWORD must contain at least 12 characters.');
    }
    db.users.push({
      id: randomUUID(),
      name: process.env.ADMIN_INITIAL_NAME || 'Yönetici',
      phone: 'admin',
      sicilNo: process.env.ADMIN_INITIAL_SICIL || '0001',
      passwordHash: await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD, 12),
      role: 'admin',
      serviceId: null,
      createdAt: new Date().toISOString()
    });
  }

  const adminUser = db.users.find((user) => user.role === 'admin');
  if (adminUser && !/^\d{3,20}$/.test(String(adminUser.sicilNo || ''))) {
    adminUser.sicilNo = '0001';
  }
  if (adminUser && process.env.ADMIN_PASSWORD) {
    if (String(process.env.ADMIN_PASSWORD).length < 12) {
      throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
    }
    adminUser.passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  }

  await writeDb(db);
}

// Run seeding once per server instance, and let concurrent requests await the same promise
// (important on serverless, where several requests can hit a fresh cold start at once).
let seedPromise = null;
function ensureSeedDataOnce() {
  if (!seedPromise) {
    seedPromise = ensureSeedData().catch((error) => {
      seedPromise = null; // allow retry on next request if seeding failed
      throw error;
    });
  }
  return seedPromise;
}

function createToken(user, rememberMe = false) {
  // Keep personal data out of the JWT. The server resolves the current user from the ID.
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, {
    expiresIn: rememberMe ? '30d' : SESSION_TTL
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  res.append('Set-Cookie', parts.join('; '));
}

function clearAuthCookies(res) {
  setCookie(res, AUTH_COOKIE, '', { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'Lax', maxAge: 0 });
  setCookie(res, CSRF_COOKIE, '', { secure: IS_PRODUCTION, sameSite: 'Lax', maxAge: 0 });
}

function issueAuthCookies(res, token, rememberMe = false) {
  const csrfToken = randomUUID();
  const cookieOptions = { secure: IS_PRODUCTION, sameSite: 'Lax' };
  if (rememberMe) cookieOptions.maxAge = 30 * 24 * 60 * 60 * 1000;
  setCookie(res, AUTH_COOKIE, token, { ...cookieOptions, httpOnly: true });
  setCookie(res, CSRF_COOKIE, csrfToken, cookieOptions);
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

function getAuthToken(req) {
  return getBearerToken(req) || parseCookies(req)[AUTH_COOKIE] || null;
}

function validateCsrf(req) {
  // Bearer authentication is retained for API clients/tests. Browser sessions use an HttpOnly
  // cookie and therefore require the double-submit CSRF token on state-changing requests.
  if (getBearerToken(req)) return true;
  const cookies = parseCookies(req);
  const header = req.headers['x-csrf-token'];
  // Accept both cookie names to handle environment switching
  const csrfToken = cookies[CSRF_COOKIE] || cookies[IS_PRODUCTION ? 'payogum_csrf' : '__Host-payogum_csrf'];
  return Boolean(csrfToken && header && csrfToken === header);
}

function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!validateCsrf(req)) return res.status(403).json({ message: 'CSRF validation failed.' });
  next();
}

const rateBuckets = new Map();

async function incrementRateCounter(key, windowMs) {
  const now = Date.now();
  if (useKv) {
    const redisKey = `ratelimit:${key}`;
    const count = await kv.incr(redisKey);
    if (count === 1) await kv.expire(redisKey, Math.ceil(windowMs / 1000));
    const ttl = await kv.ttl(redisKey);
    return { count, resetAt: now + Math.max(1, ttl) * 1000 };
  }

  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [entryKey, entry] of rateBuckets) if (entry.resetAt <= now) rateBuckets.delete(entryKey);
  }
  return bucket;
}

function rateLimit({ windowMs, max, keyPrefix }) {
  return async (req, res, next) => {
    try {
      const ip = String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 100);
      const key = `${keyPrefix}:${ip}`;
      const bucket = await incrementRateCounter(key, windowMs);
      if (bucket.count > max) {
        res.setHeader('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000)));
        return res.status(429).json({ message: 'Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.' });
      }
      next();
    } catch (error) {
      console.error('Rate limit storage error:', error);
      // Fail closed for security-sensitive endpoints when durable rate limiting is unavailable.
      if (useKv) return res.status(503).json({ message: 'Güvenlik servisi geçici olarak kullanılamıyor.' });
      next();
    }
  };
}

function isValidText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function normalizeTurkishPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const normalized = digits.startsWith('90') ? `0${digits.slice(2)}` : digits;
  return /^05\d{9}$/.test(normalized) ? normalized : null;
}

function requireAuth(req, res, next) {
  const token = getAuthToken(req);
  if (!token) return res.status(401).json({ message: 'Authentication required' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

async function getUserById(userId) {
  const db = await readDb();
  return db.users.find((user) => user.id === userId) || null;
}

async function requireRole(req, res, roles) {
  const user = await getUserById(req.user.id);
  if (!user || !roles.includes(user.role)) {
    res.status(403).json({ message: 'Bu işlem için yetkiniz yok.' });
    return null;
  }
  return user;
}

async function pushLog(logEntry) {
  const db = await readDb();
  db.logs.unshift(logEntry);
  await writeDb(db);
}

async function createNotification(logEntry) {
  const db = await readDb();
  db.logs.unshift(logEntry);
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];

  const recipients = db.users.filter((user) => user.serviceId === logEntry.serviceId && user.id !== logEntry.senderId);
  recipients.forEach((user) => {
    db.notifications.unshift({
      ...logEntry,
      userId: user.id,
      readAt: null
    });
  });

  await writeDb(db);
  return recipients.map((user) => user.id);
}

async function createAdminNotifications(logEntry, serviceIds) {
  const db = await readDb();
  db.logs = Array.isArray(db.logs) ? db.logs : [];
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  const recipientIds = [];

  serviceIds.forEach((serviceId) => {
    const serviceLog = { ...logEntry, id: randomUUID(), serviceId };
    db.logs.unshift(serviceLog);
    db.users
      .filter((user) => user.serviceId === serviceId && user.id !== logEntry.senderId)
      .forEach((user) => {
        db.notifications.unshift({ ...serviceLog, userId: user.id, readAt: null });
        recipientIds.push(user.id);
      });
  });

  await writeDb(db);
  return recipientIds;
}

async function sendPushNotifications(userIds, notification) {
  if (!PUSH_ENABLED || !userIds.length) return;

  const db = await readDb();
  const subscriptions = db.pushSubscriptions || [];
  const staleEndpoints = new Set();
  await Promise.all(subscriptions
    .filter((entry) => userIds.includes(entry.userId))
    .map(async (entry) => {
      try {
        await webpush.sendNotification(entry.subscription, JSON.stringify({
          title: notification.label,
          body: notification.message,
          notificationId: notification.id,
          url: '/'
        }));
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) staleEndpoints.add(entry.subscription.endpoint);
      }
    }));

  if (staleEndpoints.size) {
    db.pushSubscriptions = subscriptions.filter((entry) => !staleEndpoints.has(entry.subscription.endpoint));
    await writeDb(db);
  }
}

// Basic request hardening. The app does not expose a public cross-origin API.
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.openstreetmap.org https://tile.openstreetmap.org; connect-src 'self' https://nominatim.openstreetmap.org https://*.openstreetmap.org; font-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'self' https://www.openstreetmap.org https://*.openstreetmap.org; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'");
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use((req, res, next) => {
  const cookies = parseCookies(req);
  if (!cookies[CSRF_COOKIE]) {
    setCookie(res, CSRF_COOKIE, randomUUID(), { secure: IS_PRODUCTION, sameSite: 'Lax' });
  }
  next();
});

app.use(express.static(PUBLIC_PATH, { dotfiles: 'deny', index: 'index.html' }));

// Make sure seed data exists before any API route runs.
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300, keyPrefix: 'api' }));
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api', async (_req, res, next) => {
  try {
    await ensureSeedDataOnce();
    next();
  } catch (error) {
    console.error('Seed data error:', error);
    res.status(500).json({ message: 'Server storage is not available.' });
  }
});

app.use('/api', requireCsrf);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'Payogum server is running', storage: useKv ? 'upstash-redis' : 'local-file' });
});

app.get('/api/services', requireAuth, async (_req, res) => {
  const db = await readDb();
  res.json(db.services || []);
});

app.post('/api/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: 'register' }), async (req, res) => {
  const { name, phone, sicilNo, password, role = 'personel' } = req.body || {};

  if (!name || !phone || !sicilNo || !password) {
    return res.status(400).json({ message: 'Ad soyad, telefon, sicil no ve şifre zorunludur.' });
  }

  const normalizedPhone = normalizeTurkishPhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ message: 'Geçerli bir Türkiye cep telefonu girin: 05XXXXXXXXX.' });
  }
  const normalizedSicilNo = String(sicilNo).trim().toUpperCase();
    if (!/^\d{3,20}$/.test(normalizedSicilNo)) {
    return res.status(400).json({ message: 'Sicil no 3-20 rakamdan oluşmalıdır.' });
  }
  const normalizedRole = role === 'driver' ? 'driver' : 'personel';
  if (String(password).length < 8 || String(password).length > 128) {
    return res.status(400).json({ message: 'Şifre 8-128 karakter arasında olmalıdır.' });
  }
  if (!isValidText(String(name), 100)) {
    return res.status(400).json({ message: 'Ad soyad geçerli değil.' });
  }

  try {
    const db = await readDb();
    const isDuplicate = db.users.some((user) => user.phone === normalizedPhone);
    if (isDuplicate) {
      return res.status(409).json({ message: 'This phone number is already registered.' });
    }
    if (db.users.some((user) => String(user.sicilNo || '').toUpperCase() === normalizedSicilNo)) {
      return res.status(409).json({ message: 'Bu sicil no zaten kayıtlı.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = {
      id: randomUUID(),
      name: String(name).trim(),
      phone: normalizedPhone,
      sicilNo: normalizedSicilNo,
      passwordHash,
      role: normalizedRole,
      serviceId: null,
      createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    await writeDb(db);

    const token = createToken(newUser);
    issueAuthCookies(res, token);
    return res.status(201).json({ user: sanitizeUser(newUser) });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Registration failed due to a server storage error.' });
  }
});

app.post('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'login' }), async (req, res) => {
  const { sicilNo, password, rememberMe } = req.body || {};

  if (!sicilNo || !password) {
    return res.status(400).json({ message: 'Sicil no ve şifre zorunludur.' });
  }

  const db = await readDb();
  const loginSicilNo = String(sicilNo).trim().toUpperCase();
  const user = db.users.find((entry) => String(entry.sicilNo || '').toUpperCase() === loginSicilNo);
  if (!user) {
    return res.status(401).json({ message: 'Sicil numarası veya şifre hatalı.' });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash || '');
  if (!isValid) {
    return res.status(401).json({ message: 'Sicil numarası veya şifre hatalı.' });
  }

  const token = createToken(user, rememberMe === true);
  issueAuthCookies(res, token, rememberMe === true);
  return res.json({ user: sanitizeUser(user) });
});

app.post('/api/logout', requireAuth, (_req, res) => {
  clearAuthCookies(res);
  return res.json({ loggedOut: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  return res.json(sanitizeUser(user));
});

app.post('/api/join-service', requireAuth, async (req, res) => {
  const { serviceId } = req.body || {};
  const db = await readDb();
  const service = db.services.find((entry) => entry.id === serviceId);

  if (!service) {
    return res.status(404).json({ message: 'Service not found.' });
  }

  const userIndex = db.users.findIndex((entry) => entry.id === req.user.id);
  if (userIndex === -1) {
    return res.status(404).json({ message: 'User not found.' });
  }
  if (!['personel', 'driver'].includes(db.users[userIndex].role)) {
    return res.status(403).json({ message: 'Bu hesap servis kanalına bağlanamaz.' });
  }

  db.users[userIndex].serviceId = serviceId;
  await writeDb(db);

  const updatedUser = db.users[userIndex];
  return res.json({ message: 'Service joined successfully.', user: sanitizeUser(updatedUser) });
});

app.post('/api/services', requireAuth, async (req, res) => {
  const { name, code, route } = req.body || {};
  const user = await getUserById(req.user.id);

  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const rawCode = String(code ?? name ?? '').trim();
  if (!rawCode) {
    return res.status(400).json({ message: 'Service code is required.' });
  }

  const normalizedCode = rawCode.replace(/\D/g, '').padStart(2, '0');
  if (!/^\d{1,2}$/.test(rawCode) || Number(normalizedCode) < 1 || Number(normalizedCode) > 99) {
    return res.status(400).json({ message: 'Service code must be a number between 01 and 99.' });
  }

  const db = await readDb();
  const existing = db.services.find((service) => String(service.code).padStart(2, '0') === normalizedCode);
  if (existing) {
    return res.status(409).json({ message: 'This service number already exists.' });
  }

  const service = {
    id: randomUUID(),
    name: normalizedCode,
    code: normalizedCode,
    route: String(route || '').trim(),
    createdAt: new Date().toISOString()
  };

  db.services.push(service);
  await writeDb(db);
  return res.status(201).json(service);
});

app.put('/api/services/:id', requireAuth, async (req, res) => {
  const { code, route } = req.body || {};
  const user = await getUserById(req.user.id);

  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const index = db.services.findIndex((service) => service.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Service not found.' });
  }

  const rawCode = String(code ?? db.services[index].code ?? '').trim();
  if (!rawCode) {
    return res.status(400).json({ message: 'Service code is required.' });
  }

  const normalizedCode = rawCode.replace(/\D/g, '').padStart(2, '0');
  if (!/^\d{1,2}$/.test(rawCode) || Number(normalizedCode) < 1 || Number(normalizedCode) > 99) {
    return res.status(400).json({ message: 'Service code must be a number between 01 and 99.' });
  }

  const duplicate = db.services.find((service) => service.id !== req.params.id && String(service.code).padStart(2, '0') === normalizedCode);
  if (duplicate) {
    return res.status(409).json({ message: 'This service number already exists.' });
  }

  db.services[index].code = normalizedCode;
  db.services[index].name = normalizedCode;
  db.services[index].route = String(route ?? db.services[index].route ?? '').trim();
  await writeDb(db);

  return res.json(db.services[index]);
});

app.delete('/api/services/:id', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);

  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const index = db.services.findIndex((service) => service.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Service not found.' });
  }

  const [deleted] = db.services.splice(index, 1);
  await writeDb(db);
  return res.json({ deleted: true, service: deleted });
});

app.get('/api/logs', requireAuth, async (req, res) => {
  const db = await readDb();
  const user = await getUserById(req.user.id);

  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  return res.json(db.logs || []);
});

app.get('/api/admin/services/:id/history', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const service = (db.services || []).find((entry) => entry.id === req.params.id);
  if (!service) {
    return res.status(404).json({ message: 'Service not found.' });
  }

  const history = (db.logs || [])
    .filter((entry) => entry.serviceId === service.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);

  return res.json({ service, history });
});

app.get('/api/admin/services/:id/details', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const service = (db.services || []).find((entry) => entry.id === req.params.id);
  if (!service) {
    return res.status(404).json({ message: 'Service not found.' });
  }

  const members = (db.users || [])
    .filter((entry) => entry.serviceId === service.id && ['personel', 'driver'].includes(entry.role))
    .map((entry) => ({ id: entry.id, name: entry.name, phone: entry.phone, sicilNo: entry.sicilNo, role: entry.role, serviceId: entry.serviceId }));
  const memberIds = new Set(members.map((entry) => entry.id));
  const unreadNotifications = (db.notifications || [])
    .filter((entry) => memberIds.has(entry.userId) && !entry.readAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);

  return res.json({ service, members, unreadNotifications });
});

app.patch('/api/admin/users/:id', requireAuth, async (req, res) => {
  const admin = await requireRole(req, res, ['admin']);
  if (!admin) return;

  const { name, phone, sicilNo, role, serviceId, password } = req.body || {};
  const db = await readDb();
  const user = (db.users || []).find((entry) => entry.id === req.params.id && entry.role !== 'admin');
  if (!user) return res.status(404).json({ message: 'Üye bulunamadı.' });

  if (!isValidText(String(name || '').trim(), 100)) {
    return res.status(400).json({ message: 'Geçerli bir ad soyad girin.' });
  }
  const normalizedPhone = normalizeTurkishPhone(phone);
  if (!normalizedPhone) return res.status(400).json({ message: 'Geçerli bir telefon numarası girin.' });
  const normalizedSicilNo = String(sicilNo || '').trim();
  if (!/^\d{3,20}$/.test(normalizedSicilNo)) {
    return res.status(400).json({ message: 'Sicil no 3-20 rakamdan oluşmalıdır.' });
  }
  if ((db.users || []).some((entry) => entry.id !== user.id && (entry.phone === normalizedPhone || String(entry.sicilNo) === normalizedSicilNo))) {
    return res.status(409).json({ message: 'Telefon veya sicil no zaten kayıtlı.' });
  }
  if (role != null && !['personel', 'driver'].includes(role)) {
    return res.status(400).json({ message: 'Geçersiz üye rolü.' });
  }
  if (serviceId != null && !(db.services || []).some((entry) => entry.id === serviceId)) {
    return res.status(400).json({ message: 'Geçersiz servis.' });
  }
  if (password && (String(password).length < 8 || String(password).length > 128)) {
    return res.status(400).json({ message: 'Şifre 8-128 karakter arasında olmalıdır.' });
  }

  user.name = String(name).trim();
  user.phone = normalizedPhone;
  user.sicilNo = normalizedSicilNo;
  if (role != null) user.role = role;
  if (serviceId != null) user.serviceId = serviceId;
  if (password) user.passwordHash = await bcrypt.hash(password, 12);
  await writeDb(db);
  return res.json({ user: sanitizeUser(user) });
});

app.delete('/api/admin/users/:id', requireAuth, async (req, res) => {
  const admin = await requireRole(req, res, ['admin']);
  if (!admin) return;

  const db = await readDb();
  const index = (db.users || []).findIndex((entry) => entry.id === req.params.id && entry.role !== 'admin');
  if (index === -1) return res.status(404).json({ message: 'Üye bulunamadı.' });

  const [deleted] = db.users.splice(index, 1);
  db.notifications = (db.notifications || []).filter((entry) => entry.userId !== deleted.id);
  db.pushSubscriptions = (db.pushSubscriptions || []).filter((entry) => entry.userId !== deleted.id);
  await writeDb(db);
  return res.json({ deleted: true, user: sanitizeUser(deleted) });
});

app.patch('/api/admin/notifications/:id/read', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const notifications = (db.notifications || []).filter((entry) => entry.id === req.params.id);
  if (!notifications.length) {
    return res.status(404).json({ message: 'Notification not found.' });
  }

  const readAt = new Date().toISOString();
  notifications.forEach((notification) => {
    notification.readAt = readAt;
  });
  await writeDb(db);
  return res.json({ ...notifications[0], updatedCount: notifications.length });
});

app.get('/api/admin/summary', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const summary = {
    totalUsers: db.users.length,
    totalDrivers: db.users.filter((entry) => entry.role === 'driver').length,
    totalStaff: db.users.filter((entry) => entry.role === 'personel').length,
    totalServices: db.services.length,
    totalNotifications: db.logs.length
  };

  return res.json(summary);
});

app.get('/api/admin/reports', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const unreadByUser = new Map();
  (db.notifications || []).filter((entry) => !entry.readAt).forEach((entry) => {
    unreadByUser.set(entry.userId, (unreadByUser.get(entry.userId) || 0) + 1);
  });
  const reports = (db.services || []).map((service) => {
    const serviceLogs = (db.logs || []).filter((entry) => entry.serviceId === service.id);
    const serviceUsers = (db.users || []).filter((entry) => entry.serviceId === service.id && entry.role === 'personel');
    const actionCounts = {};
    serviceLogs.forEach((entry) => {
      actionCounts[entry.type] = (actionCounts[entry.type] || 0) + 1;
    });
    return {
      serviceId: service.id,
      serviceCode: service.code,
      notificationCount: serviceLogs.length,
      unreadCount: serviceUsers.reduce((total, member) => total + (unreadByUser.get(member.id) || 0), 0),
      memberCount: serviceUsers.length,
      lastNotificationAt: serviceLogs[0]?.createdAt || null,
      actionCounts
    };
  });

  return res.json({ generatedAt: new Date().toISOString(), reports });
});

app.get('/api/admin/reports/service/:serviceId/export/excel', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const service = (db.services || []).find((entry) => entry.id === req.params.serviceId);
  if (!service) {
    return res.status(404).json({ message: 'Service not found.' });
  }

  const members = (db.users || [])
    .filter((entry) => entry.serviceId === service.id && entry.role === 'personel')
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      phone: entry.phone,
      sicilNo: entry.sicilNo,
      role: entry.role
    }));

  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sefer Raporu');

    worksheet.columns = [
      { header: 'Tarih', key: 'date', width: 22 },
      { header: 'Servis', key: 'service', width: 12 },
      { header: 'İşlem', key: 'type', width: 20 },
      { header: 'Başlık', key: 'label', width: 30 },
      { header: 'Mesaj', key: 'message', width: 55 },
      { header: 'Gönderen', key: 'senderName', width: 25 }
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE30613' }
    };
    (db.logs || [])
      .filter((entry) => entry.serviceId === service.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .forEach((entry) => worksheet.addRow({
        date: new Date(entry.createdAt).toLocaleString('tr-TR'),
        service: service.code,
        type: entry.type,
        label: entry.label,
        message: entry.message,
        senderName: entry.senderName
      }));

    const memberWorksheet = workbook.addWorksheet('Yolcular');
    memberWorksheet.columns = [
      { header: 'Ad Soyad', key: 'name', width: 30 },
      { header: 'Sicil No', key: 'sicilNo', width: 15 },
      { header: 'Telefon', key: 'phone', width: 15 },
      { header: 'Rol', key: 'role', width: 15 }
    ];
    memberWorksheet.getRow(1).font = { bold: true };
    memberWorksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE30613' }
    };
    members.forEach((member) => {
      memberWorksheet.addRow({
        name: member.name,
        sicilNo: member.sicilNo,
        phone: member.phone,
        role: member.role
      });
    });

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const fileName = `Oyak_Servis_Raporu_${service.code}_${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel export error:', error);
    return res.status(500).json({ message: 'Excel dosyası oluşturulurken hata oluştu.' });
  }
});

app.get('/api/admin/reports/service/:serviceId/export/pdf', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access is required.' });
  }

  const db = await readDb();
  const service = (db.services || []).find((entry) => entry.id === req.params.serviceId);
  if (!service) {
    return res.status(404).json({ message: 'Service not found.' });
  }

  const members = (db.users || [])
    .filter((entry) => entry.serviceId === service.id && entry.role === 'personel')
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      phone: entry.phone,
      sicilNo: entry.sicilNo,
      role: entry.role
    }));

  if (!members.length) {
    return res.status(404).json({ message: 'Bu servise bağlı personel bulunamadı.' });
  }

  try {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const now = new Date();
    const dateStr = now.toLocaleDateString('tr-TR');
    const fileName = `Oyak_Servis_Raporu_${service.code}_${dateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    doc.pipe(res);

    doc.fontSize(20).font('Helvetica-Bold').fillColor('#E30613')
       .text('OYAK Servis Raporu', { align: 'center' });
    
    doc.fontSize(14).font('Helvetica').fillColor('#333333')
       .text(`Servis No: ${service.code}`, { align: 'center' });
    
    doc.fontSize(12).fillColor('#666666')
       .text(`Tarih: ${dateStr}`, { align: 'center' });
    
    doc.moveDown(2);

    const tableTop = doc.y;
    const headers = ['Ad Soyad', 'Sicil No', 'Telefon', 'Rol'];
    const columnWidths = [200, 100, 100, 80];
    const rowHeight = 30;
    const startX = 50;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#FFFFFF');

    headers.forEach((header, i) => {
      const x = startX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);
      doc.rect(x, tableTop, columnWidths[i], rowHeight).fill('#E30613');
      doc.text(header, x + 5, tableTop + 10, { width: columnWidths[i] - 10, align: 'left' });
    });

    doc.fontSize(10).font('Helvetica').fillColor('#333333');

    members.forEach((member, rowIndex) => {
      const y = tableTop + rowHeight + (rowIndex * rowHeight);
      
      if (y > 750) {
        doc.addPage();
        return;
      }

      const rowData = [member.name, member.sicilNo, member.phone, member.role];
      
      rowData.forEach((data, i) => {
        const x = startX + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.rect(x, y, columnWidths[i], rowHeight).stroke();
        doc.text(String(data || ''), x + 5, y + 10, { width: columnWidths[i] - 10, align: 'left' });
      });
    });

    doc.end();
  } catch (error) {
    console.error('PDF export error:', error);
    return res.status(500).json({ message: 'PDF dosyası oluşturulurken hata oluştu.' });
  }
});

// Real-time-ish notifications over plain HTTP (works everywhere, including serverless hosts
// like Vercel where a persistent WebSocket connection isn't possible). The driver's app posts
// events here; everyone else polls /api/services/:id/notifications for anything new.
app.post('/api/notify', requireAuth, async (req, res) => {
  const { serviceId, type, label, message, coordinates, idempotencyKey } = req.body || {};

  if (!isValidText(String(serviceId || ''), 100) || !isValidText(String(type || ''), 50)) {
    return res.status(400).json({ message: 'Geçersiz bildirim bilgisi.' });
  }
  if (label != null && String(label).length > 120) return res.status(400).json({ message: 'Bildirim başlığı çok uzun.' });
  if (message != null && String(message).length > 500) return res.status(400).json({ message: 'Bildirim mesajı çok uzun.' });
  if (idempotencyKey != null && String(idempotencyKey).length > 200) return res.status(400).json({ message: 'Geçersiz işlem anahtarı.' });

  const db = await readDb();
  const sender = db.users.find((entry) => entry.id === req.user.id);
  const service = db.services.find((entry) => entry.id === serviceId);
  if (!sender || !service) return res.status(404).json({ message: 'Servis veya kullanıcı bulunamadı.' });

  if (sender.role !== 'admin' && sender.serviceId !== serviceId) {
    return res.status(403).json({ message: 'Bu servise bildirim gönderme yetkiniz yok.' });
  }
  if (sender.role === 'personel' && type !== 'location_request') {
    return res.status(403).json({ message: 'Personel yalnızca konum talebi gönderebilir.' });
  }
  if (sender.role === 'driver' && !['departure_10', 'departure_5', 'departed', 'arrival_10', 'arrival_5', 'arrived', 'delayed', 'driver_location', 'message'].includes(type)) {
    return res.status(400).json({ message: 'Geçersiz sürücü bildirimi.' });
  }
  if (sender.role === 'admin' && !['departure_10', 'departure_5', 'departed', 'arrival_10', 'arrival_5', 'arrived', 'delayed', 'driver_location', 'message', 'location_request', 'test'].includes(type)) {
    return res.status(400).json({ message: 'Geçersiz bildirim türü.' });
  }

  let safeCoordinates = null;
  if (coordinates != null) {
    const lat = Number(coordinates.latitude);
    const lng = Number(coordinates.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Geçersiz konum bilgisi.' });
    }
    safeCoordinates = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
  }

  const requestKey = String(idempotencyKey || req.headers['x-idempotency-key'] || '').trim();
  const duplicate = requestKey && (db.logs || []).find(
    (entry) => entry.senderId === req.user.id && entry.idempotencyKey === requestKey
  );
  if (duplicate) return res.status(200).json(duplicate);

  const logEntry = {
    id: randomUUID(),
    serviceId,
    type: String(type).trim(),
    label: String(label || 'Servis Bildirimi').trim().slice(0, 120),
    message: String(message || '').trim().slice(0, 500),
    senderName: String(sender.name || 'Kullanıcı').trim().slice(0, 100),
    senderId: sender.id,
    idempotencyKey: requestKey || null,
    coordinates: safeCoordinates,
    createdAt: new Date().toISOString()
  };

  const recipientIds = await createNotification(logEntry);
  sendPushNotifications(recipientIds, logEntry).catch((error) => {
    console.error('Push delivery failed:', error.name || 'PushError');
  });
  return res.status(201).json(logEntry);
});

app.post('/api/admin/notify', requireAuth, async (req, res) => {
  const admin = await requireRole(req, res, ['admin']);
  if (!admin) return;

  const { serviceId, label, message } = req.body || {};
  if (serviceId !== 'all' && !isValidText(String(serviceId || ''), 100)) {
    return res.status(400).json({ message: 'Geçerli bir servis seçin.' });
  }
  if (!isValidText(String(message || '').trim(), 500)) {
    return res.status(400).json({ message: 'Mesaj boş olamaz ve 500 karakteri geçemez.' });
  }
  if (label != null && String(label).length > 120) {
    return res.status(400).json({ message: 'Bildirim başlığı çok uzun.' });
  }

  const db = await readDb();
  const serviceIds = serviceId === 'all'
    ? (db.services || []).map((service) => service.id)
    : [serviceId];
  if (!serviceIds.length || serviceIds.some((id) => !(db.services || []).some((service) => service.id === id))) {
    return res.status(404).json({ message: 'Servis bulunamadı.' });
  }

  const logEntry = {
    type: 'admin_message',
    label: String(label || 'Yönetici Bildirimi').trim().slice(0, 120),
    message: String(message).trim().slice(0, 500),
    senderName: admin.name,
    senderId: admin.id,
    createdAt: new Date().toISOString()
  };
  const recipientIds = await createAdminNotifications(logEntry, serviceIds);
  sendPushNotifications(recipientIds, { ...logEntry, id: randomUUID() }).catch((error) => {
    console.error('Push delivery failed:', error.name || 'PushError');
  });
  return res.status(201).json({ sent: serviceIds.length, recipients: recipientIds.length });
});

app.get('/api/push/public-key', requireAuth, (_req, res) => {
  return res.json({ enabled: PUSH_ENABLED, publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : null });
});

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ message: 'A valid push subscription is required.' });
  }

  const db = await readDb();
  db.pushSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  db.pushSubscriptions = db.pushSubscriptions.filter((entry) => entry.subscription.endpoint !== subscription.endpoint);
  db.pushSubscriptions.push({ userId: req.user.id, subscription, createdAt: new Date().toISOString() });
  await writeDb(db);
  return res.status(201).json({ subscribed: true });
});

app.delete('/api/push/subscribe', requireAuth, async (req, res) => {
  const endpoint = req.body?.endpoint;
  const db = await readDb();
  db.pushSubscriptions = (db.pushSubscriptions || []).filter(
    (entry) => !(entry.userId === req.user.id && entry.subscription.endpoint === endpoint)
  );
  await writeDb(db);
  return res.json({ unsubscribed: true });
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  const db = await readDb();
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  const user = db.users.find((entry) => entry.id === req.user.id);
  const existingIds = new Set(
    db.notifications.filter((entry) => entry.userId === req.user.id).map((entry) => entry.id)
  );

  // Backfill logs created before per-user inbox records existed.
  if (user?.serviceId) {
    (db.logs || [])
      .filter((entry) => entry.serviceId === user.serviceId && entry.senderId !== user.id && !existingIds.has(entry.id))
      .forEach((entry) => {
        db.notifications.push({ ...entry, userId: user.id, readAt: null });
      });
    await writeDb(db);
  }

  const notifications = db.notifications
    .filter((notification) => notification.userId === req.user.id && !notification.readAt)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return res.json(notifications.slice(-50));
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  const db = await readDb();
  const notification = (db.notifications || []).find(
    (entry) => entry.id === req.params.id && entry.userId === req.user.id
  );

  if (!notification) {
    return res.status(404).json({ message: 'Notification not found.' });
  }

  notification.readAt = new Date().toISOString();
  await writeDb(db);
  return res.json(notification);
});

app.get('/api/services/:id/notifications', requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((entry) => entry.id === req.user.id);
  if (!user) return res.status(401).json({ message: 'User not found.' });
  if (user.role !== 'admin' && user.serviceId !== req.params.id) {
    return res.status(403).json({ message: 'Bu servisin bildirimlerine erişim yetkiniz yok.' });
  }
  const { since } = req.query;
  const sinceTime = since ? new Date(since).getTime() : 0;

  const entries = (db.logs || [])
    .filter((log) => log.serviceId === req.params.id)
    .filter((log) => new Date(log.createdAt).getTime() > sinceTime)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-50);

  return res.json(entries);
});

// Manual log cleanup endpoint for drivers and personnel
app.post('/api/cleanup-logs', requireAuth, async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user || !['driver', 'personel'].includes(user.role)) {
    return res.status(403).json({ message: 'Bu işlem için yetkiniz yok.' });
  }

  if (!user.serviceId) {
    return res.status(400).json({ message: 'Önce bir servise bağlanmalısınız.' });
  }

  try {
    const db = await readDb();
    const originalLogCount = db.logs.length;
    const originalNotificationCount = db.notifications.length;
    
    // Keep only logs from the last 24 hours for the user's service
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.logs = db.logs.filter(log => 
      log.serviceId !== user.serviceId || log.createdAt >= cutoffTime
    );
    
    // Clean up old notifications for the user's service (keep only last 7 days)
    const notificationCutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.notifications = db.notifications.filter(notification => 
      notification.serviceId !== user.serviceId || notification.createdAt >= notificationCutoffTime
    );
    
    await writeDb(db);
    
    const logsDeleted = originalLogCount - db.logs.length;
    const notificationsDeleted = originalNotificationCount - db.notifications.length;
    
    return res.json({ 
      message: 'Geçmiş temizlendi.',
      logsDeleted,
      notificationsDeleted
    });

  } catch (error) {
    console.error('Log temizleme hatası:', error);
    return res.status(500).json({ message: 'Geçmiş temizlenirken hata oluştu.' });
  }
});

app.post('/api/admin/cleanup', requireAuth, async (req, res) => {
  const admin = await requireRole(req, res, ['admin']);
  if (!admin) return;

  const db = await readDb();
  const logsDeleted = (db.logs || []).length;
  const notificationsDeleted = (db.notifications || []).length;
  db.logs = [];
  db.notifications = [];
  await writeDb(db);

  return res.json({ message: 'Tüm hareket ve bildirim kayıtları temizlendi.', logsDeleted, notificationsDeleted });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Payogum server is running on http://localhost:${PORT} (storage: ${useKv ? 'upstash-redis' : 'local-file'})`);
  });
}

module.exports = app;
