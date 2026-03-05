const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const app = express();
const PORT = 7799;

// --- Configuration ---
// Change this password before deploying!
const ACCESS_PASSWORD = process.env.BROWSER_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// Serve React build
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ACCESS_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Wrong password' });
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth status
app.get('/api/auth', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// Proxy endpoint — fetches pages server-side to bypass X-Frame-Options
app.get('/api/proxy', requireAuth, (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Only allow http and https protocols
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Only HTTP/HTTPS URLs are allowed' });
  }

  const client = parsedUrl.protocol === 'https:' ? https : http;

  const proxyReq = client.get(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    timeout: 15000,
  }, (proxyRes) => {
    // Forward status code
    res.status(proxyRes.statusCode);

    // Forward headers but remove restrictive ones
    const headers = { ...proxyRes.headers };
    delete headers['x-frame-options'];
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];

    Object.entries(headers).forEach(([key, value]) => {
      try {
        res.setHeader(key, value);
      } catch (e) {
        // skip invalid headers
      }
    });

    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch the requested URL' });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ error: 'Request timed out' });
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web Browser running at http://0.0.0.0:${PORT}`);
  console.log(`   Password: ${ACCESS_PASSWORD}`);
});
