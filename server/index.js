const express = require('express');
const http = require('http');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const puppeteer = require('puppeteer');

const PORT = 7799;
const ACCESS_PASSWORD = process.env.BROWSER_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Browser viewport
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 900;
const FPS = 24;
const QUALITY = 70;

const app = express();
const server = http.createServer(app);

// Session setup
const sessionParser = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' }
});

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(sessionParser);

// Serve React build
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

// Auth endpoints
app.post('/api/login', (req, res) => {
  if (req.body.password === ACCESS_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

// ======== Puppeteer Browser Instance ========
let browser = null;
let activePage = null;
const pages = new Map(); // id -> { page, title, url }
let pageIdCounter = 0;

async function launchBrowser() {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--window-size=${VIEW_WIDTH},${VIEW_HEIGHT}`,
    ],
    defaultViewport: { width: VIEW_WIDTH, height: VIEW_HEIGHT },
  });
  console.log('🌐 Chromium launched');
  // Create initial tab
  await createNewPage();
}

async function createNewPage() {
  if (!browser) await launchBrowser();
  const page = await browser.newPage();
  const id = ++pageIdCounter;

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: VIEW_WIDTH, height: VIEW_HEIGHT });

  // Track navigation
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const entry = pages.get(id);
      if (entry) {
        entry.url = page.url();
        page.title().then(t => { entry.title = t || entry.url; }).catch(() => {});
        broadcastTabsUpdate();
      }
    }
  });

  pages.set(id, { page, title: 'New Tab', url: 'about:blank' });
  activePage = id;
  broadcastTabsUpdate();
  return id;
}

async function closePage(id) {
  const entry = pages.get(id);
  if (!entry) return;
  try { await entry.page.close(); } catch {}
  pages.delete(id);

  if (pages.size === 0) {
    await createNewPage();
  } else if (activePage === id) {
    activePage = [...pages.keys()][pages.size - 1];
  }
  broadcastTabsUpdate();
}

function getTabsList() {
  const tabs = [];
  for (const [id, entry] of pages) {
    tabs.push({ id, title: entry.title || 'New Tab', url: entry.url || '', active: id === activePage });
  }
  return tabs;
}

// ======== WebSocket ========
const wss = new WebSocketServer({ server });
const clients = new Set();

function broadcastTabsUpdate() {
  const msg = JSON.stringify({ type: 'tabs', tabs: getTabsList() });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function broadcastUrl() {
  const entry = pages.get(activePage);
  if (!entry) return;
  const msg = JSON.stringify({ type: 'urlChange', url: entry.url || '' });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// Auth check for WebSocket
wss.on('connection', (ws, req) => {
  // Parse session from cookies
  const mockRes = { setHeader: () => {}, getHeader: () => null, end: () => {} };
  sessionParser(req, mockRes, () => {
    if (!req.session || !req.session.authenticated) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    clients.add(ws);
    console.log('Client connected, total:', clients.size);

    // Send current state
    ws.send(JSON.stringify({ type: 'tabs', tabs: getTabsList() }));
    const entry = pages.get(activePage);
    if (entry) {
      ws.send(JSON.stringify({ type: 'urlChange', url: entry.url || '' }));
    }

    // Start streaming to this client
    startStreaming();

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await handleClientMessage(msg);
      } catch (err) {
        console.error('WS message error:', err.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('Client disconnected, total:', clients.size);
      if (clients.size === 0) stopStreaming();
    });
  });
});

// Handle messages from client
async function handleClientMessage(msg) {
  const entry = pages.get(activePage);
  if (!entry) return;
  const page = entry.page;

  switch (msg.type) {
    case 'navigate': {
      let url = msg.url.trim();
      if (!url) break;
      if (!/^https?:\/\//i.test(url)) {
        if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(url)) {
          url = 'https://' + url;
        } else {
          url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
        }
      }
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        entry.url = page.url();
        entry.title = await page.title() || entry.url;
        broadcastTabsUpdate();
        broadcastUrl();
      } catch (err) {
        console.error('Navigation error:', err.message);
      }
      break;
    }

    case 'click': {
      try {
        await page.mouse.click(msg.x, msg.y, { button: msg.button === 2 ? 'right' : 'left' });
      } catch {}
      break;
    }

    case 'dblclick': {
      try {
        await page.mouse.click(msg.x, msg.y, { clickCount: 2 });
      } catch {}
      break;
    }

    case 'mousemove': {
      try {
        await page.mouse.move(msg.x, msg.y);
      } catch {}
      break;
    }

    case 'mousedown': {
      try {
        await page.mouse.down({ button: msg.button === 2 ? 'right' : 'left' });
      } catch {}
      break;
    }

    case 'mouseup': {
      try {
        await page.mouse.up({ button: msg.button === 2 ? 'right' : 'left' });
      } catch {}
      break;
    }

    case 'scroll': {
      try {
        await page.mouse.wheel({ deltaX: msg.deltaX || 0, deltaY: msg.deltaY || 0 });
      } catch {}
      break;
    }

    case 'keydown': {
      try {
        const key = mapKey(msg.key, msg.code);
        if (key) await page.keyboard.down(key);
      } catch {}
      break;
    }

    case 'keyup': {
      try {
        const key = mapKey(msg.key, msg.code);
        if (key) await page.keyboard.up(key);
      } catch {}
      break;
    }

    case 'keypress': {
      try {
        if (msg.key && msg.key.length === 1) {
          await page.keyboard.sendCharacter(msg.key);
        }
      } catch {}
      break;
    }

    case 'newTab': {
      await createNewPage();
      break;
    }

    case 'closeTab': {
      await closePage(msg.id);
      break;
    }

    case 'switchTab': {
      if (pages.has(msg.id)) {
        activePage = msg.id;
        broadcastTabsUpdate();
        broadcastUrl();
      }
      break;
    }

    case 'goBack': {
      try { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }); } catch {}
      entry.url = page.url();
      entry.title = await page.title().catch(() => '') || entry.url;
      broadcastTabsUpdate();
      broadcastUrl();
      break;
    }

    case 'goForward': {
      try { await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 }); } catch {}
      entry.url = page.url();
      entry.title = await page.title().catch(() => '') || entry.url;
      broadcastTabsUpdate();
      broadcastUrl();
      break;
    }

    case 'refresh': {
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); } catch {}
      break;
    }

    case 'resize': {
      if (msg.width && msg.height) {
        try {
          for (const [, e] of pages) {
            await e.page.setViewport({ width: Math.round(msg.width), height: Math.round(msg.height) });
          }
        } catch {}
      }
      break;
    }
  }
}

// Key mapping
function mapKey(key, code) {
  const keyMap = {
    'Enter': 'Enter', 'Backspace': 'Backspace', 'Tab': 'Tab',
    'Escape': 'Escape', 'Delete': 'Delete', 'Home': 'Home', 'End': 'End',
    'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight',
    'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown',
    'PageUp': 'PageUp', 'PageDown': 'PageDown',
    'Shift': 'Shift', 'Control': 'Control', 'Alt': 'Alt', 'Meta': 'Meta',
    'CapsLock': 'CapsLock',
    'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
    'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
    'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
    ' ': 'Space',
  };
  return keyMap[key] || (key && key.length === 1 ? key : null);
}

// ======== Screencasting ========
let streamInterval = null;

function startStreaming() {
  if (streamInterval) return;
  streamInterval = setInterval(async () => {
    if (clients.size === 0) return;
    const entry = pages.get(activePage);
    if (!entry) return;
    try {
      const screenshot = await entry.page.screenshot({
        type: 'jpeg',
        quality: QUALITY,
        encoding: 'base64',
      });
      const msg = JSON.stringify({ type: 'frame', data: screenshot });
      for (const ws of clients) {
        if (ws.readyState === 1) ws.send(msg);
      }
    } catch {}
  }, 1000 / FPS);
}

function stopStreaming() {
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
}

// ======== Start ========
(async () => {
  await launchBrowser();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web Browser running at http://0.0.0.0:${PORT}`);
    console.log(`   Password: ${ACCESS_PASSWORD}`);
  });
})();
