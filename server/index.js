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

const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 900;

const app = express();
const server = http.createServer(app);

const sessionParser = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' }
});

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(sessionParser);
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

// ======== Puppeteer ========
let browser = null;
let activePage = null;
const pages = new Map(); // id -> { page, cdp, title, url, lastFrame }
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
  console.log('Chromium launched');
  await createNewPage();
}

async function createNewPage() {
  if (!browser) await launchBrowser();
  const page = await browser.newPage();
  const id = ++pageIdCounter;

  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: VIEW_WIDTH, height: VIEW_HEIGHT });

  // Get CDP session for screencast
  const cdp = await page.createCDPSession();

  // Track navigation
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const entry = pages.get(id);
      if (entry) {
        entry.url = page.url();
        page.title().then(t => { entry.title = t || entry.url; }).catch(() => {});
        broadcastTabsUpdate();
        if (id === activePage) broadcastUrl();
      }
    }
  });

  // Screencast: Chromium sends frames ONLY when screen changes
  cdp.on('Page.screencastFrame', (params) => {
    const entry = pages.get(id);
    if (!entry) return;

    // Always ack the frame to keep receiving
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});

    // Store the latest frame as binary buffer
    entry.lastFrame = Buffer.from(params.data, 'base64');

    // Only broadcast if this is the active tab
    if (id === activePage) {
      broadcastFrame(entry.lastFrame);
    }
  });

  pages.set(id, { page, cdp, title: 'New Tab', url: 'about:blank', lastFrame: null });

  // Start screencast for this page
  await startPageScreencast(id);

  activePage = id;
  broadcastTabsUpdate();
  broadcastUrl();
  return id;
}

async function startPageScreencast(id) {
  const entry = pages.get(id);
  if (!entry) return;
  try {
    await entry.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 50,
      maxWidth: VIEW_WIDTH,
      maxHeight: VIEW_HEIGHT,
      everyNthFrame: 2,
    });
  } catch (err) {
    console.error('Screencast start error:', err.message);
  }
}

async function stopPageScreencast(id) {
  const entry = pages.get(id);
  if (!entry) return;
  try {
    await entry.cdp.send('Page.stopScreencast');
  } catch {}
}

async function closePage(id) {
  const entry = pages.get(id);
  if (!entry) return;
  try { await stopPageScreencast(id); } catch {}
  try { await entry.cdp.detach(); } catch {}
  try { await entry.page.close(); } catch {}
  pages.delete(id);

  if (pages.size === 0) {
    await createNewPage();
  } else if (activePage === id) {
    activePage = [...pages.keys()][pages.size - 1];
    broadcastTabsUpdate();
    broadcastUrl();
    // Send cached frame of new active tab immediately
    const newEntry = pages.get(activePage);
    if (newEntry && newEntry.lastFrame) {
      broadcastFrame(newEntry.lastFrame);
    }
  }
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

// Send frame as binary (no base64 JSON overhead)
function broadcastFrame(frameBuffer) {
  if (!frameBuffer) return;
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(frameBuffer, { binary: true });
    }
  }
}

wss.on('connection', (ws, req) => {
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
      // Send cached frame immediately so client sees something right away
      if (entry.lastFrame) {
        ws.send(entry.lastFrame, { binary: true });
      }
    }

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await handleClientMessage(msg, ws);
      } catch (err) {
        console.error('WS message error:', err.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('Client disconnected, total:', clients.size);
    });
  });
});

// ======== Handle Input ========
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
        await page.mouse.move(msg.x, msg.y);
        await page.mouse.click(msg.x, msg.y, { button: msg.button === 2 ? 'right' : 'left', delay: 50 });
      } catch {}
      break;
    }

    case 'dblclick': {
      try {
        await page.mouse.move(msg.x, msg.y);
        await page.mouse.click(msg.x, msg.y, { clickCount: 2, delay: 50 });
      } catch {}
      break;
    }

    case 'mousemove': {
      try { await page.mouse.move(msg.x, msg.y); } catch {}
      break;
    }

    case 'scroll': {
      try { await page.mouse.wheel({ deltaX: msg.deltaX || 0, deltaY: msg.deltaY || 0 }); } catch {}
      break;
    }

    case 'keydown': {
      try {
        const key = mapKey(msg.key);
        if (key) await page.keyboard.down(key);
      } catch {}
      break;
    }

    case 'keyup': {
      try {
        const key = mapKey(msg.key);
        if (key) await page.keyboard.up(key);
      } catch {}
      break;
    }

    case 'keypress': {
      try {
        if (msg.key && msg.key.length === 1) await page.keyboard.sendCharacter(msg.key);
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
      if (pages.has(msg.id) && msg.id !== activePage) {
        activePage = msg.id;
        broadcastTabsUpdate();
        broadcastUrl();
        // Send cached frame of new tab IMMEDIATELY — no wait
        const newEntry = pages.get(activePage);
        if (newEntry && newEntry.lastFrame) {
          broadcastFrame(newEntry.lastFrame);
        }
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
        const w = Math.round(msg.width);
        const h = Math.round(msg.height);
        try {
          // Only resize active page immediately, others on switch
          const activeEntry = pages.get(activePage);
          if (activeEntry) {
            await activeEntry.page.setViewport({ width: w, height: h });
            // Restart screencast with new dimensions
            await stopPageScreencast(activePage);
            await startPageScreencast(activePage);
          }
        } catch {}
      }
      break;
    }
  }
}

function mapKey(key) {
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

// ======== Start ========
(async () => {
  await launchBrowser();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web Browser running at http://0.0.0.0:${PORT}`);
    console.log(`   Password: ${ACCESS_PASSWORD}`);
  });
})();
