import React, { useState, useRef, useEffect, useCallback } from 'react';

const QUICK_LINKS = [
  { name: 'WhatsApp', url: 'https://web.whatsapp.com', icon: '💬', color: '#25D366' },
  { name: 'Telegram', url: 'https://web.telegram.org', icon: '✈️', color: '#0088cc' },
  { name: 'Instagram', url: 'https://www.instagram.com', icon: '📷', color: '#E4405F' },
  { name: 'YouTube', url: 'https://www.youtube.com', icon: '▶️', color: '#FF0000' },
  { name: 'Twitter / X', url: 'https://x.com', icon: '𝕏', color: '#000000' },
  { name: 'Facebook', url: 'https://www.facebook.com', icon: '👤', color: '#1877F2' },
  { name: 'Gmail', url: 'https://mail.google.com', icon: '✉️', color: '#EA4335' },
  { name: 'Google', url: 'https://www.google.com', icon: '🔍', color: '#4285F4' },
  { name: 'GitHub', url: 'https://github.com', icon: '🐙', color: '#333333' },
  { name: 'Reddit', url: 'https://www.reddit.com', icon: '🤖', color: '#FF4500' },
  { name: 'Netflix', url: 'https://www.netflix.com', icon: '🎬', color: '#E50914' },
  { name: 'Discord', url: 'https://discord.com/app', icon: '🎮', color: '#5865F2' },
];

function Browser({ onLogout }) {
  const [tabs, setTabs] = useState([]);
  const [currentUrl, setCurrentUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [frame, setFrame] = useState(null);
  const wsRef = useRef(null);
  const canvasRef = useRef(null);
  const viewRef = useRef(null);
  const inputRef = useRef(null);
  const imgRef = useRef(new Image());

  const activeTab = tabs.find(t => t.active);
  const isHome = !activeTab || activeTab.url === 'about:blank' || activeTab.url === '';

  // Send message to server
  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Connect WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.binaryType = 'blob';
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(() => {
        if (wsRef.current === ws) window.location.reload();
      }, 2000);
    };

    ws.onmessage = (e) => {
      // Binary = frame image, Text = JSON control message
      if (e.data instanceof Blob) {
        const url = URL.createObjectURL(e.data);
        setFrame(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      } else {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tabs') setTabs(msg.tabs);
        else if (msg.type === 'urlChange') { setCurrentUrl(msg.url || ''); setUrlInput(msg.url || ''); }
      }
    };

    return () => ws.close();
  }, []);

  // Draw frame on canvas
  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    const img = imgRef.current;
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    };
    img.src = frame;
  }, [frame]);

  // Send viewport size on resize
  useEffect(() => {
    const handleResize = () => {
      if (viewRef.current) {
        const rect = viewRef.current.getBoundingClientRect();
        send({ type: 'resize', width: rect.width, height: rect.height });
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [send, connected]);

  // Get mouse coordinates relative to the browser view
  const getCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    const { x, y } = getCoords(e);
    send({ type: 'mousedown', x, y, button: e.button });
  };

  const handleMouseUp = (e) => {
    e.preventDefault();
    const { x, y } = getCoords(e);
    send({ type: 'mouseup', x, y, button: e.button });
  };

  const handleClick = (e) => {
    e.preventDefault();
    const { x, y } = getCoords(e);
    send({ type: 'click', x, y, button: e.button });
    // Focus the hidden input to capture keyboard
    if (inputRef.current) inputRef.current.focus();
  };

  const handleDblClick = (e) => {
    e.preventDefault();
    const { x, y } = getCoords(e);
    send({ type: 'dblclick', x, y });
  };

  const handleMouseMove = (e) => {
    const { x, y } = getCoords(e);
    send({ type: 'mousemove', x, y });
  };

  const handleWheel = (e) => {
    send({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    const { x, y } = getCoords(e);
    send({ type: 'click', x, y, button: 2 });
  };

  // Keyboard events via hidden input
  const handleKeyDown = (e) => {
    // Don't intercept when typing in URL bar
    if (e.target.classList.contains('url-input')) return;
    e.preventDefault();
    send({ type: 'keydown', key: e.key, code: e.code });
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      send({ type: 'keypress', key: e.key });
    }
  };

  const handleKeyUp = (e) => {
    if (e.target.classList.contains('url-input')) return;
    e.preventDefault();
    send({ type: 'keyup', key: e.key, code: e.code });
  };

  // Navigation
  const navigateTo = (url) => {
    send({ type: 'navigate', url });
    setUrlInput(url);
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    navigateTo(urlInput);
    if (inputRef.current) inputRef.current.focus();
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  };

  return (
    <div className="browser" onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} tabIndex={-1}>
      {/* Title Bar */}
      <div className="titlebar">
        <div className="titlebar-traffic">
          <span className="traffic-light red" onClick={handleLogout} title="Logout" />
          <span className="traffic-light yellow" />
          <span className="traffic-light green" />
        </div>

        <div className="tabs-container">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`tab ${tab.active ? 'tab-active' : ''}`}
              onClick={() => send({ type: 'switchTab', id: tab.id })}
            >
              <span className="tab-title">{tab.title || 'New Tab'}</span>
              <span className="tab-close" onClick={(e) => { e.stopPropagation(); send({ type: 'closeTab', id: tab.id }); }}>×</span>
            </div>
          ))}
          <button className="tab-add" onClick={() => send({ type: 'newTab' })}>+</button>
        </div>

        {!connected && <div className="connection-status">Reconnecting...</div>}
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="nav-buttons">
          <button className="nav-btn" onClick={() => send({ type: 'goBack' })} title="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button className="nav-btn" onClick={() => send({ type: 'goForward' })} title="Forward">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <button className="nav-btn" onClick={() => send({ type: 'refresh' })} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button className="nav-btn" onClick={() => { send({ type: 'navigate', url: '' }); }} title="Home">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </button>
        </div>

        <form className="url-bar" onSubmit={handleUrlSubmit}>
          <div className="url-bar-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <input
            type="text"
            className="url-input"
            placeholder="Cari atau masukkan alamat website..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </form>

        <button className="nav-btn logout-btn" onClick={handleLogout} title="Logout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>

      {/* Browser View */}
      <div className="browser-content" ref={viewRef}>
        {isHome && !frame ? (
          <div className="home-page">
            <h1 className="home-greeting">Selamat Datang 👋</h1>
            <p className="home-subtitle">Pilih situs atau ketik URL di address bar</p>
            <div className="quick-links-grid">
              {QUICK_LINKS.map((link, i) => (
                <button key={i} className="quick-link-card" onClick={() => navigateTo(link.url)}>
                  <div className="quick-link-icon" style={{ background: link.color }}>
                    <span>{link.icon}</span>
                  </div>
                  <span className="quick-link-name">{link.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="browser-canvas"
            onClick={handleClick}
            onDoubleClick={handleDblClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
            onContextMenu={handleContextMenu}
          />
        )}
        {/* Hidden input for capturing keyboard events */}
        <input
          ref={inputRef}
          className="hidden-input"
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          autoFocus
        />
      </div>
    </div>
  );
}

export default Browser;
