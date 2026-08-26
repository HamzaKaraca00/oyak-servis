const express = require('express');
const path = require('path');
const session = require('express-session');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel / Reverse Proxy yapılandırması (HTTPS ve cookie'lerin doğru çalışması için şart)
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser('secret-key-change-me')); // Cookie parser eklendi

// Session yapılandırması
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'super-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Vercel'de HTTPS zorunlu
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
});

app.use(sessionMiddleware);

// CSRF Koruması (Cookie tabanlı yapılandırma serverless modda en kararlısıdır)
const csrfProtection = csrf({
    cookie: {
        key: '_csrf',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
});

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));

// CSRF Token alma endpoint'i (Frontend istemcisi için)
app.get('/api/csrf-token', csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});

// Form veya API POST isteklerinizde csrfProtection middleware'ini kullanın
app.post('/api/submit', csrfProtection, (req, res) => {
    res.json({ success: true, message: 'İşlem başarılı!' });
});

// CSRF Hata Yakalama Middleware'i
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({
            error: 'CSRF validation failed',
            message: 'Geçersiz veya eksik CSRF token.'
        });
    }
    next(err);
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;