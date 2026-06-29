# Hosting Damia Pulse on the admin droplet (pulse.damiatracker.com)

One-time setup. Run these **on the droplet** (you own SSH/server ops — Claude
does not run these). After this, future deploys are just `./deploy/deploy.sh`.

Pulse runs as its own Node service on **port 4010** behind nginx, separate from
the admin service, so the two never clash.

## 1. DNS
Add an **A record**: `pulse.damiatracker.com` → the admin droplet's IP.

## 2. Clone the repo on the droplet
```bash
sudo git clone https://github.com/drammehadama188-lab/pulse.git /opt/damia-pulse
cd /opt/damia-pulse
```
(Adjust the path to match how admin is laid out on this box; if you use a
different path, edit `WorkingDirectory` in the service file in step 4.)

## 3. Secrets + data
Create `/opt/damia-pulse/.env` with the same `ZOHO_*` keys as your local `.env`
(copy them over — they are gitignored and never committed). `data/` is created
automatically and seeds from the roster; it is gitignored too.

## 4. Install deps + build
```bash
npm ci
npm run build
```

## 5. systemd service
```bash
sudo cp deploy/damia-pulse.service /etc/systemd/system/damia-pulse.service
# edit WorkingDirectory / User to match this droplet, then:
sudo systemctl daemon-reload
sudo systemctl enable --now damia-pulse
sudo systemctl status damia-pulse     # confirm it's running on :4010
```

## 6. nginx + HTTPS
```bash
sudo cp deploy/nginx-pulse.damiatracker.com.conf /etc/nginx/sites-available/pulse.damiatracker.com
sudo ln -s /etc/nginx/sites-available/pulse.damiatracker.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pulse.damiatracker.com   # issues the cert + 443 block
```

## 7. Verify
Open https://pulse.damiatracker.com — you should get the Pulse login. Sign in,
confirm the Staff page loads and permissions/data look right.

## Future deploys
```bash
cd /opt/damia-pulse && ./deploy/deploy.sh
```
Edit local → commit → push → run deploy.sh on the droplet. Never edit on the
server directly.
