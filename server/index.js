const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');

const app = express();
const PORT = 7799;

// --- Configuration ---
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
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// Serve React build (but NOT for /proxy/ paths)
app.use((req, res, next) => {
  if (req.path.startsWith('/proxy/')) return next();
  express.static(path.join(__dirname, '..', 'client', 'build'))(req, res, next);
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ACCESS_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Wrong password' });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth
app.get('/api/auth', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ====== FULL REVERSE PROXY ======
// Route: /proxy/https://example.com/path
// This proxies ALL requests (HTML, JS, CSS, images, API calls) and rewrites URLs

function extractTargetUrl(req) {
  // req.path = /proxy/https://example.com/some/path
  const match = req.originalUrl.match(/^\/proxy\/(https?:\/\/.+)/);
  if (!match) return null;
  try {
    return new URL(match[1]);
  } catch {
    return null;
  }
}

// Rewrite URLs in HTML content to go through our proxy
function rewriteHtml(html, baseUrl) {
  const origin = baseUrl.origin;
  const proxyBase = '/proxy/' + origin;

  // Rewrite absolute URLs with same origin: href="/path" -> href="/proxy/https://example.com/path"
  html = html.replace(/(href|src|action)=(["'])\//g, `$1=$2${proxyBase}/`);

  // Rewrite full URLs: https://example.com -> /proxy/https://example.com
  // Handle the base origin
  html = html.replace(new RegExp(escapeRegExp(origin), 'g'), proxyBase);

  // Remove integrity attributes (they break when we modify content)
  html = html.replace(/\s+integrity="[^"]*"/g, '');
  html = html.replace(/\s+integrity='[^']*'/g, '');

  // Inject a <base> tag and a script to intercept navigation
  const injectScript = `
<script>
(function() {
  // Override fetch to proxy API calls
  const origFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = __proxyRewrite(input);
    } else if (input instanceof Request) {
      input = new Request(__proxyRewrite(input.url), input);
    }
    return origFetch.call(this, input, init);
  };

  // Override XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    return origOpen.call(this, method, __proxyRewrite(url), ...args);
  };

  // Override WebSocket
  // (WebSocket cannot be proxied this way - they need special handling)

  // Helper to rewrite URLs
  function __proxyRewrite(url) {
    if (!url || typeof url !== 'string') return url;
    // Already proxied
    if (url.startsWith('/proxy/')) return url;
    // Absolute URL
    if (url.startsWith('https://') || url.startsWith('http://')) {
      return '/proxy/' + url;
    }
    // Protocol-relative
    if (url.startsWith('//')) {
      return '/proxy/https:' + url;
    }
    // Relative URL - resolve against current base
    if (url.startsWith('/')) {
      return '/proxy/${origin}' + url;
    }
    return url;
  }

  // Override History API
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function(state, title, url) {
    if (url) url = __proxyRewrite(url);
    return origPush.call(this, state, title, url);
  };
  history.replaceState = function(state, title, url) {
    if (url) url = __proxyRewrite(url);
    return origReplace.call(this, state, title, url);
  };

  // Override window.open  
  const origWindowOpen = window.open;
  window.open = function(url, ...args) {
    if (url) url = __proxyRewrite(url);
    return origWindowOpen.call(this, url, ...args);
  };

  // Intercept link clicks  
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a');
    if (a && a.href) {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('/proxy/') && !href.startsWith('#') && !href.startsWith('javascript:')) {
        e.preventDefault();
        const newUrl = __proxyRewrite(href.startsWith('http') ? href : a.href);
        window.location.href = newUrl;
      }
    }
  }, true);

  // Override createElement for dynamically created scripts/links
  const origCreateElement = document.createElement;
  document.createElement = function(tag) {
    const el = origCreateElement.call(this, tag);
    if (tag.toLowerCase() === 'script' || tag.toLowerCase() === 'link' || tag.toLowerCase() === 'img') {
      const origSetAttr = el.setAttribute.bind(el);
      el.setAttribute = function(name, value) {
        if ((name === 'src' || name === 'href') && typeof value === 'string') {
          value = __proxyRewrite(value);
        }
        return origSetAttr(name, value);
      };
      // Override .src setter
      const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src') ||
                      Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src') || {};
      if (srcDesc.set) {
        Object.defineProperty(el, 'src', {
          set: function(v) { srcDesc.set.call(this, __proxyRewrite(v)); },
          get: srcDesc.get ? function() { return srcDesc.get.call(this); } : undefined,
          configurable: true
        });
      }
    }
    return el;
  };
})();
</script>`;

  // Inject after <head> or at the beginning
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>' + injectScript);
  } else if (html.includes('<HEAD>')) {
    html = html.replace('<HEAD>', '<HEAD>' + injectScript);
  } else {
    html = injectScript + html;
  }

  return html;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Decompress response body
function decompressResponse(proxyRes, callback) {
  const encoding = proxyRes.headers['content-encoding'];
  let stream = proxyRes;

  if (encoding === 'gzip') {
    stream = proxyRes.pipe(zlib.createGunzip());
  } else if (encoding === 'deflate') {
    stream = proxyRes.pipe(zlib.createInflate());
  } else if (encoding === 'br') {
    stream = proxyRes.pipe(zlib.createBrotliDecompress());
  }

  const chunks = [];
  stream.on('data', chunk => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
  stream.on('error', err => callback(err));
}

// Main proxy handler
app.all('/proxy/*', requireAuth, (req, res) => {
  const targetUrl = extractTargetUrl(req);
  if (!targetUrl) {
    return res.status(400).json({ error: 'Invalid proxy URL' });
  }

  // Only allow http(s)
  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    return res.status(400).json({ error: 'Only HTTP/HTTPS allowed' });
  }

  const client = targetUrl.protocol === 'https:' ? https : http;
  const fullUrl = targetUrl.href;

  // Forward relevant headers from the original request
  const forwardHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': req.headers['accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': targetUrl.origin + '/',
    'Origin': targetUrl.origin,
  };

  // Forward cookies if any
  if (req.headers['x-proxy-cookie']) {
    forwardHeaders['Cookie'] = req.headers['x-proxy-cookie'];
  }

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: forwardHeaders,
    timeout: 30000,
  };

  const proxyReq = client.request(options, (proxyRes) => {
    // Handle redirects - rewrite Location header
    if (proxyRes.headers['location']) {
      let loc = proxyRes.headers['location'];
      if (loc.startsWith('http://') || loc.startsWith('https://')) {
        loc = '/proxy/' + loc;
      } else if (loc.startsWith('/')) {
        loc = '/proxy/' + targetUrl.origin + loc;
      }
      proxyRes.headers['location'] = loc;
    }

    // Remove security headers that block iframe embedding
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    delete proxyRes.headers['content-security-policy-report-only'];
    delete proxyRes.headers['x-content-type-options'];
    delete proxyRes.headers['strict-transport-security'];

    const contentType = proxyRes.headers['content-type'] || '';
    const isHtml = contentType.includes('text/html');

    if (isHtml) {
      // For HTML responses, we need to decompress, rewrite URLs, then send
      decompressResponse(proxyRes, (err, body) => {
        if (err) {
          console.error('Decompression error:', err.message);
          return res.status(502).send('Proxy error');
        }

        let html = body.toString('utf-8');
        html = rewriteHtml(html, targetUrl);

        // Set headers (without content-encoding since we decompressed)
        const headers = { ...proxyRes.headers };
        delete headers['content-encoding'];
        delete headers['content-length'];
        delete headers['transfer-encoding'];

        // Rewrite Set-Cookie domain
        if (headers['set-cookie']) {
          headers['set-cookie'] = Array.isArray(headers['set-cookie'])
            ? headers['set-cookie'].map(c => c.replace(/;\s*[Dd]omain=[^;]*/g, '').replace(/;\s*[Ss]ecure/g, '').replace(/;\s*[Ss]ame[Ss]ite=[^;]*/g, ''))
            : headers['set-cookie'].replace(/;\s*[Dd]omain=[^;]*/g, '').replace(/;\s*[Ss]ecure/g, '').replace(/;\s*[Ss]ame[Ss]ite=[^;]*/g, '');
        }

        res.status(proxyRes.statusCode);
        Object.entries(headers).forEach(([key, value]) => {
          try { res.setHeader(key, value); } catch (e) {}
        });
        res.send(html);
      });
    } else {
      // For non-HTML (JS, CSS, images, etc.), stream directly
      const headers = { ...proxyRes.headers };

      // Rewrite Set-Cookie
      if (headers['set-cookie']) {
        headers['set-cookie'] = Array.isArray(headers['set-cookie'])
          ? headers['set-cookie'].map(c => c.replace(/;\s*[Dd]omain=[^;]*/g, '').replace(/;\s*[Ss]ecure/g, '').replace(/;\s*[Ss]ame[Ss]ite=[^;]*/g, ''))
          : headers['set-cookie'].replace(/;\s*[Dd]omain=[^;]*/g, '').replace(/;\s*[Ss]ecure/g, '').replace(/;\s*[Ss]ame[Ss]ite=[^;]*/g, '');
      }

      res.status(proxyRes.statusCode);
      Object.entries(headers).forEach(([key, value]) => {
        try { res.setHeader(key, value); } catch (e) {}
      });
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to fetch: ' + err.message });
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timed out' });
    }
  });

  // Forward request body for POST/PUT
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body && Object.keys(req.body).length > 0) {
      const bodyStr = JSON.stringify(req.body);
      proxyReq.setHeader('Content-Type', 'application/json');
      proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr));
      proxyReq.write(bodyStr);
    }
  }

  proxyReq.end();
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Web Browser running at http://0.0.0.0:${PORT}`);
  console.log(`   Password: ${ACCESS_PASSWORD}`);
});
