# Web Browser VPS

Browser pribadi yang berjalan di VPS, dibuat dengan React JS + Express.

## Fitur
- 🔒 Password protection
- 🌐 Tampilan macOS-style browser
- 📑 Tab management (buka banyak tab)
- ⚡ Quick links: WhatsApp, Telegram, Instagram, YouTube, dll
- 🔄 Server-side proxy untuk bypass iframe restrictions
- 🔍 Search via Google dari address bar

## Cara Install & Jalankan

### 1. Install di VPS

```bash
# Clone / upload folder ke VPS
# Pastikan Node.js >= 16 sudah terinstall

# Install semua dependencies
cd /path/to/ext
npm run install:all

# Build React app
npm run build

# Jalankan server
BROWSER_PASSWORD=passwordkamu npm start
```

Server berjalan di port **7799**. Buka `http://IP_VPS:7799` di browser.

### 2. Jalankan dengan PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Jalankan
BROWSER_PASSWORD=passwordkamu pm2 start server/index.js --name web-browser

# Auto-start saat reboot
pm2 startup
pm2 save
```

### 3. Jalankan dengan Docker

```bash
docker build -t web-browser .
docker run -d -p 7799:7799 -e BROWSER_PASSWORD=passwordkamu --name web-browser web-browser
```

## Environment Variables

| Variable | Default | Keterangan |
|----------|---------|------------|
| `BROWSER_PASSWORD` | `admin123` | Password untuk login |
| `SESSION_SECRET` | auto-generated | Secret untuk session |

## ⚠️ Penting

- **Ganti password default** sebelum deploy!
- Beberapa website (seperti WhatsApp Web, Google) mungkin punya proteksi tambahan yang membuat mereka tidak bisa dibuka via proxy/iframe. Untuk pengalaman terbaik, pertimbangkan menggunakan solusi seperti [neko](https://github.com/m1k1o/neko) untuk browser streaming penuh.
- Gunakan HTTPS (via nginx reverse proxy + Let's Encrypt) untuk keamanan.

## Nginx Reverse Proxy (Optional, untuk HTTPS)

```nginx
server {
    listen 443 ssl;
    server_name browser.domainmu.com;

    ssl_certificate /etc/letsencrypt/live/browser.domainmu.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/browser.domainmu.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7799;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
