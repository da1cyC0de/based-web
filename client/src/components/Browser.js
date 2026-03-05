import React, { useState, useRef, useEffect, useCallback } from 'react';

const LINKS = [
  { name: 'WhatsApp', url: 'https://web.whatsapp.com', icon: '💬' },
  { name: 'Telegram', url: 'https://web.telegram.org', icon: '✈️' },
  { name: 'Instagram', url: 'https://www.instagram.com', icon: '📷' },
  { name: 'YouTube', url: 'https://www.youtube.com', icon: '▶️' },
  { name: 'Twitter/X', url: 'https://x.com', icon: '𝕏' },
  { name: 'Facebook', url: 'https://www.facebook.com', icon: '👤' },
  { name: 'Gmail', url: 'https://mail.google.com', icon: '✉️' },
  { name: 'Google', url: 'https://www.google.com', icon: '🔍' },
  { name: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { name: 'Reddit', url: 'https://www.reddit.com', icon: '🤖' },
  { name: 'Netflix', url: 'https://www.netflix.com', icon: '🎬' },
  { name: 'Discord', url: 'https://discord.com/app', icon: '🎮' },
];

function Browser({ onLogout }) {
  const [tabs, setTabs] = useState([]);
  const [urlInput, setUrlInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [frame, setFrame] = useState(null);
  const wsRef = useRef(null);
  const canvasRef = useRef(null);
  const viewRef = useRef(null);
  const overlayRef = useRef(null);
  const imgRef = useRef(new Image());

  const activeTab = tabs.find(t => t.active);
  const isHome = !activeTab || activeTab.url === 'about:blank' || activeTab.url === '';

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.binaryType = 'blob';
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => { setConnected(false); setTimeout(() => { if (wsRef.current === ws) window.location.reload(); }, 2000); };
    ws.onmessage = (e) => {
      if (e.data instanceof Blob) {
        const url = URL.createObjectURL(e.data);
        setFrame(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      } else {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tabs') setTabs(msg.tabs);
        else if (msg.type === 'urlChange') setUrlInput(msg.url || '');
      }
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (!frame || !canvasRef.current) return;
    const img = imgRef.current;
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = frame;
  }, [frame]);

  useEffect(() => {
    const onResize = () => {
      if (viewRef.current) {
        const r = viewRef.current.getBoundingClientRect();
        send({ type: 'resize', width: r.width, height: r.height });
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [send, connected]);

  const getCoords = (e) => {
    const el = viewRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const c = canvasRef.current;
    const sx = (c ? c.width : rect.width) / rect.width;
    const sy = (c ? c.height : rect.height) / rect.height;
    return { x: Math.round((e.clientX - rect.left) * sx), y: Math.round((e.clientY - rect.top) * sy) };
  };

  const handleClick = (e) => { e.preventDefault(); overlayRef.current?.focus(); const { x, y } = getCoords(e); send({ type: 'click', x, y, button: e.button }); };
  const handleDblClick = (e) => { e.preventDefault(); const { x, y } = getCoords(e); send({ type: 'dblclick', x, y }); };

  const lastMoveRef = useRef(0);
  const handleMove = (e) => { const now = Date.now(); if (now - lastMoveRef.current < 66) return; lastMoveRef.current = now; const { x, y } = getCoords(e); send({ type: 'mousemove', x, y }); };

  const handleWheel = (e) => { e.preventDefault(); send({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY }); };
  const handleCtx = (e) => { e.preventDefault(); const { x, y } = getCoords(e); send({ type: 'click', x, y, button: 2 }); };

  const handleKeyDown = (e) => {
    if (e.target.classList.contains('url-input')) return;
    e.preventDefault();
    send({ type: 'keydown', key: e.key, code: e.code });
  };
  const handleKeyUp = (e) => { if (e.target.classList.contains('url-input')) return; e.preventDefault(); send({ type: 'keyup', key: e.key, code: e.code }); };

  const go = (url) => { send({ type: 'navigate', url }); setUrlInput(url); };
  const handleUrlSubmit = (e) => { e.preventDefault(); go(urlInput); overlayRef.current?.focus(); };
  const logout = async () => { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); onLogout(); };

  return (
    <div className="br">
      {/* Tabs */}
      <div className="tabs">
        <div className="tabs-list">
          {tabs.map(t => (
            <div key={t.id} className={`t ${t.active ? 'ta' : ''}`} onClick={() => send({ type: 'switchTab', id: t.id })}>
              <span className="tt">{t.title || 'New Tab'}</span>
              <span className="tc" onClick={e => { e.stopPropagation(); send({ type: 'closeTab', id: t.id }); }}>×</span>
            </div>
          ))}
          <button className="t-add" onClick={() => send({ type: 'newTab' })}>+</button>
        </div>
        {!connected && <span className="offline">Offline</span>}
      </div>

      {/* Toolbar */}
      <div className="bar">
        <button className="btn" onClick={() => send({ type: 'goBack' })}>←</button>
        <button className="btn" onClick={() => send({ type: 'goForward' })}>→</button>
        <button className="btn" onClick={() => send({ type: 'refresh' })}>↻</button>
        <button className="btn" onClick={() => go('')}>⌂</button>
        <form className="url" onSubmit={handleUrlSubmit}>
          <input className="url-input" placeholder="Search or enter URL..." value={urlInput} onChange={e => setUrlInput(e.target.value)} onFocus={e => e.target.select()} />
        </form>
        <button className="btn btn-out" onClick={logout}>⏻</button>
      </div>

      {/* View */}
      <div className="view" ref={viewRef}>
        {isHome && !frame ? (
          <div className="home">
            <h2>Quick Links</h2>
            <div className="links">
              {LINKS.map((l, i) => (
                <button key={i} className="link" onClick={() => go(l.url)}>
                  <span className="link-ico">{l.icon}</span>
                  <span className="link-name">{l.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className="cv" />
            <div ref={overlayRef} className="ov" tabIndex={0}
              onClick={handleClick} onMouseMove={handleMove} onDoubleClick={handleDblClick}
              onWheel={handleWheel} onContextMenu={handleCtx} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} />
          </>
        )}
      </div>
    </div>
  );
}

export default Browser;
