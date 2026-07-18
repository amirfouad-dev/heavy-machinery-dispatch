# Heavy Machinery Scraper - Deployment Guide

This guide covers deploying the Heavy Machinery scraper to a Linux VPS (Ubuntu/Debian) to run continuously.

## Prerequisites
- A Linux VPS (e.g., DigitalOcean, Linode, AWS EC2)
- SSH access to your server
- Python 3.10+ installed

## 1. Clone the Repository
Upload your project files to the server. You can use Git, `scp`, or an FTP client like FileZilla.
```bash
git clone <your-repo-url> machinery-scraper
cd machinery-scraper/scraper_project
```

## 2. Set Up Virtual Environment
It is highly recommended to use a Python virtual environment to avoid dependency conflicts.
```bash
sudo apt update
sudo apt install python3-venv python3-pip

# Create the virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate

# Install requirements
pip install -r requirements.txt

# If you use the Playwright-based fetch path, also install its browser:
playwright install chromium
```

## 3. Configure Environment Variables
Copy the example environment file and fill in your actual credentials.
```bash
cp .env.example .env
nano .env
```
Add your `TELEGRAM_BOT_TOKEN` and run `python telegram_setup.py` if you haven't yet generated the `TELEGRAM_CHAT_IDS`.

**Key variables to set (see `.env.example` for the full list):**
- `TELEGRAM_BOT_TOKEN` — from @BotFather. **Rotate it if it was ever committed or shared.**
- `API_KEY` — a long random string. When set, every mutating API endpoint requires an
  `X-API-Key` header. Leave blank only for isolated local testing. The dashboard must be
  built with a matching `VITE_API_KEY`, and the local harvester reads `API_KEY` automatically.
- `ALLOWED_ORIGINS` — the dashboard's public URL in production (e.g. `https://dispatch.example.com`).
  Leave `*` only for local dev.
- `ADMIN_CHAT_ID` — receives operational alerts such as "scraper returned 0 results".
- `SERVER_URL` — only needed on the machine running `local_harvester.py`; points at this API.

## 4. Initialize the Database
Before running the scraper, initialize the SQLite database to store listings.
```bash
python main.py --init-db
```

## 5. Set up Cron Job (Live Polling)
We have provided a script to automatically schedule the scraper to run every 1 hour. The script is smart enough to use your virtual environment if you followed Step 2.
```bash
chmod +x setup_cron.sh
./setup_cron.sh
```

**To verify the cron job was added:**
```bash
crontab -l
```

## 6. Run the Telegram Registration Poller (Required for alerts)
Operators register by sending `/start` to your bot. The poller (`telegram_poller.py`)
listens for `/start`, links each person to their Telegram chat ID, and stores it in the
database — **without this running, users added in the Admin Panel never receive alerts.**
Run it as its own always-on service.

Create `/etc/systemd/system/machinery-poller.service`:
```ini
[Unit]
Description=Heavy Machinery Telegram Poller
After=network.target

[Service]
User=root
WorkingDirectory=/path/to/scraper_project
Environment="PATH=/path/to/scraper_project/venv/bin"
ExecStart=/path/to/scraper_project/venv/bin/python telegram_poller.py
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable machinery-poller
sudo systemctl start machinery-poller
```

## 7. Hosting the Dashboard (Optional)
If you want to view the React dashboard live on the internet from your VPS:
1. Navigate to the `dashboard` folder.
2. Create a `.env` file there (see `dashboard/.env.example`):
   ```bash
   echo "VITE_API_BASE_URL=https://YOUR_DOMAIN" > .env
   echo "VITE_API_KEY=the_same_value_as_backend_API_KEY" >> .env
   ```
   The API key is baked into the build, so rebuild whenever it changes.
3. Run `npm install` and `npm run build`.
4. Serve the `dist` folder using Nginx or Apache.
5. Ensure `api.py` is running on a port (e.g., 8000) using a process manager like `pm2` or `systemd`, so the dashboard can fetch the live data!

**Example `systemd` for FastAPI Backend:**
Create `/etc/systemd/system/machinery-api.service`:
```ini
[Unit]
Description=Heavy Machinery API
After=network.target

[Service]
User=root
WorkingDirectory=/path/to/scraper_project
Environment="PATH=/path/to/scraper_project/venv/bin"
ExecStart=/path/to/scraper_project/venv/bin/uvicorn api:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable machinery-api
sudo systemctl start machinery-api
```

## 8. Enable HTTPS (Strongly Recommended)
Serving the dashboard and API over plain HTTP means lead data, operator names, and your
`X-API-Key` travel unencrypted. Put Nginx in front with a free Let's Encrypt certificate.

```bash
sudo apt install nginx certbot python3-certbot-nginx
```

Point a domain at your server, then have Nginx serve the dashboard and proxy the API:
```nginx
server {
    server_name dispatch.example.com;

    root /opt/heavy-machinery/dashboard/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to the FastAPI backend
    location /listings   { proxy_pass http://127.0.0.1:8000; }
    location /claim      { proxy_pass http://127.0.0.1:8000; }
    location /users      { proxy_pass http://127.0.0.1:8000; }
    location /api/       { proxy_pass http://127.0.0.1:8000; }
}
```
Then obtain and auto-renew the certificate:
```bash
sudo certbot --nginx -d dispatch.example.com
```
After this, set `VITE_API_BASE_URL=https://dispatch.example.com` (rebuild the dashboard)
and `ALLOWED_ORIGINS=https://dispatch.example.com` in the backend `.env`.

> **Security checklist:** rotate the Telegram token if it was ever exposed, set a strong
> `API_KEY`, lock `ALLOWED_ORIGINS` to your domain, and consider a firewall rule so port
> 8000 is only reachable from localhost (Nginx) rather than the public internet.
