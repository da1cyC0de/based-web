import React, { useState, useRef } from 'react';

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

let tabIdCounter = 1;

function createNewTab() {
  return {
    id: tabIdCounter++,
    title: 'New Tab',
    url: '',
    inputUrl: '',
    isHome: true,
  };
}

function Browser({ onLogout }) {
  const [tabs, setTabs] = useState([createNewTab()]);
  const [activeTabId, setActiveTabId] = useState(1);
  const inputRef = useRef(null);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const updateTab = (id, updates) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const navigateTo = (url, tabId) => {
    const tid = tabId || activeTabId;
    let finalUrl = url.trim();

    if (!finalUrl) return;

    // Add https:// if no protocol
    if (!/^https?:\/\//i.test(finalUrl)) {
      // If it looks like a URL (has a dot), navigate to it; otherwise search Google
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(finalUrl)) {
        finalUrl = 'https://' + finalUrl;
      } else {
        finalUrl = 'https://www.google.com/search?q=' + encodeURIComponent(finalUrl);
      }
    }

    const proxyUrl = '/api/proxy?url=' + encodeURIComponent(finalUrl);
    let title = finalUrl;
    try {
      title = new URL(finalUrl).hostname;
    } catch {}

    updateTab(tid, {
      url: proxyUrl,
      inputUrl: finalUrl,
      title,
      isHome: false,
    });
  };

  const handleUrlSubmit = (e) => {
    e.preventDefault();
    navigateTo(activeTab.inputUrl);
    if (inputRef.current) inputRef.current.blur();
  };

  const addTab = () => {
    const newTab = createNewTab();
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const closeTab = (id, e) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      // Reset last tab to home
      updateTab(id, { title: 'New Tab', url: '', inputUrl: '', isHome: true });
      return;
    }
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    if (activeTabId === id) {
      const newIdx = Math.min(idx, newTabs.length - 1);
      setActiveTabId(newTabs[newIdx].id);
    }
    setTabs(newTabs);
  };

  const goHome = () => {
    updateTab(activeTabId, { title: 'New Tab', url: '', inputUrl: '', isHome: true });
  };

  const handleRefresh = () => {
    if (activeTab.url) {
      const url = activeTab.url;
      updateTab(activeTabId, { url: '' });
      setTimeout(() => updateTab(activeTabId, { url }), 50);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    onLogout();
  };

  const openQuickLink = (url) => {
    navigateTo(url);
  };

  return (
    <div className="browser">
      {/* Title Bar */}
      <div className="titlebar">
        <div className="titlebar-traffic">
          <span className="traffic-light red" onClick={handleLogout} title="Logout" />
          <span className="traffic-light yellow" />
          <span className="traffic-light green" />
        </div>

        {/* Tabs */}
        <div className="tabs-container">
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`tab ${tab.id === activeTabId ? 'tab-active' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span className="tab-title">{tab.title}</span>
              <span className="tab-close" onClick={(e) => closeTab(tab.id, e)}>×</span>
            </div>
          ))}
          <button className="tab-add" onClick={addTab}>+</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="nav-buttons">
          <button className="nav-btn" onClick={goHome} title="Home">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </button>
          <button className="nav-btn" onClick={handleRefresh} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
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
            ref={inputRef}
            type="text"
            className="url-input"
            placeholder="Cari atau masukkan alamat website..."
            value={activeTab.inputUrl}
            onChange={(e) => updateTab(activeTabId, { inputUrl: e.target.value })}
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

      {/* Content */}
      <div className="browser-content">
        {activeTab.isHome ? (
          <div className="home-page">
            <h1 className="home-greeting">Selamat Datang 👋</h1>
            <p className="home-subtitle">Pilih situs atau ketik URL di address bar</p>

            <div className="quick-links-grid">
              {QUICK_LINKS.map((link, i) => (
                <button
                  key={i}
                  className="quick-link-card"
                  onClick={() => openQuickLink(link.url)}
                >
                  <div className="quick-link-icon" style={{ background: link.color }}>
                    <span>{link.icon}</span>
                  </div>
                  <span className="quick-link-name">{link.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <iframe
            key={activeTab.id + activeTab.url}
            src={activeTab.url}
            className="browser-iframe"
            title={activeTab.title}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
          />
        )}
      </div>
    </div>
  );
}

export default Browser;
