# Hosting Damia Pulse (pulse.damiatracker.com)

Pulse deploys exactly like the admin app: **everything runs from the Mac** —
build locally, ship over the `prod` SSH alias (YubiKey taps), restart the
service. Nobody SSHes into the server by hand, and nothing is ever edited
there directly.

Pulse runs as its own Node service on **port 4010** at `/var/www/damia-pulse`,
beside the admin service (port 4011, `/var/www/damia-admin`) — they never clash.

## One-time setup

1. **DNS (GoDaddy):** A record `pulse` → `157.245.132.41` (same IP as the
   `admin` record). Wait until `ping -c 1 pulse.damiatracker.com` answers with
   that IP.

2. **Run the setup script** from the Mac:
   ```bash
   cd ~/damia/staff-app && ./deploy/setup-server.sh
   ```
   Tap the YubiKey each time it blinks. The script:
   - creates `/var/www/damia-pulse` and ships the code (via `deploy.sh`)
   - builds prod's `.env` from your local one, **minus** `OUTBOUND_EMAIL=off`
     (that's the local-dev email blocker — on prod it would kill every invite)
   - copies `RESEND_API_KEY` from the admin app's `.env` **on the server**
     (the key never travels through the Mac) and wires the shared
     `PULSE_SYNC_KEY` + `ADMIN_SYNC_URL` for the KPI bridge, creating the key
     in both `.env`s if admin doesn't have one yet
   - installs + starts the `damia-pulse` systemd service
   - installs the nginx site and issues the HTTPS cert (certbot)

   Safe to re-run; it never overwrites an existing prod `.env`.

3. **Verify:** open https://pulse.damiatracker.com — you should get the Pulse
   login. Then send the first set-password email to yourself or one person and
   confirm it lands before inviting the rest of the team.

## Future deploys

```bash
cd ~/damia/staff-app && ./deploy/deploy.sh
```

Edit local → commit → push → `./deploy/deploy.sh`. Never edit on the server.

## What lives only on the server

- `/var/www/damia-pulse/.env` — secrets (Zoho, Resend, sync key)
- `/var/www/damia-pulse/data/` — live app data (attendance, leave, links…).
  `deploy.sh` never touches either.
