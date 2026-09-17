# VPS deploy (GitHub Actions → SSH → pm2)

`.github/workflows/deploy-vps.yml` builds the app on GitHub and copies **only the build
output** (a standalone Next.js server + `public` + static assets, ~190 MB) to the VPS over SSH
using a username and password. No source code, no `npm install` and no build happen on the
VPS. It then switches `current` to the new release, health-checks
`http://127.0.0.1:3000/`, and rolls back to the previous release if the check fails.

It runs only when started by hand from **Actions → Deploy to VPS → Run workflow**,
but **only once the repo variable `VPS_DEPLOY_ENABLED` is `true`**. Until then it is skipped.

```
<VPS_DEPLOY_PATH>/
  releases/<git-sha>/   last 5 releases
  current -> releases/<git-sha>
  shared/.env           runtime secrets, rewritten on each deploy (mode 600)
```

## 1. VPS prerequisites (one time)

Requirements: Linux **x86_64 with glibc** (Ubuntu or Debian — not Alpine, not ARM, because
`sharp` is built on the GitHub runner) and **Node ≥ 20.12**.

```bash
# as root
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs nginx
npm i -g pm2

adduser deploy                                  # set the password → VPS_PASSWORD
mkdir -p <VPS_DEPLOY_PATH> && chown deploy:deploy <VPS_DEPLOY_PATH>

# start pm2 on boot for the deploy user
env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

SSH must allow password login (`PasswordAuthentication yes` in `/etc/ssh/sshd_config`).
Then, from your laptop, capture the server's host key for `VPS_KNOWN_HOSTS`:

```bash
ssh-keyscan -p 22 <VPS_HOST>
```

## 2. GitHub secrets

Repo → Settings → Secrets and variables → Actions → **Secrets**:

| Secret | Value |
|---|---|
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | SSH username, e.g. `deploy` |
| `VPS_PASSWORD` | that user's SSH password |
| `VPS_DEPLOY_PATH` | absolute folder the app is deployed to, e.g. `/var/www/bch-rc` |
| `VPS_PORT` | SSH port — optional, defaults to 22 |
| `VPS_KNOWN_HOSTS` | optional but recommended: output of `ssh-keyscan <VPS_HOST>`. Without it the workflow trusts whatever server answers, and would send it the password. |
| `PRODUCTION_ENV` | the whole production `.env` file (every `KEY=value` line) |

`PRODUCTION_ENV` is used twice: at build time (the `NEXT_PUBLIC_*` values are baked into the
client and product pages prerender from the database) and written to `shared/.env` for
runtime. `VERCEL` / `VERCEL_*` lines are stripped automatically.

## 3. GitHub variables

Same page → **Variables**:

| Variable | Default | Meaning |
|---|---|---|
| `VPS_DEPLOY_ENABLED` | — | set to `true` to turn deploys on |
| `VPS_APP_PORT` | `3000` | port the app listens on (127.0.0.1 only) |
| `VPS_INSTALL_CRONS` | `false` | `true` installs the 3 cron jobs (see §5) |

## 4. nginx + TLS

`/etc/nginx/sites-available/bch-rc`:

```nginx
server {
  listen 80;
  server_name pocketrccars.com www.pocketrccars.com;

  client_max_body_size 20m;   # review photo uploads

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    # src/lib/rate-limit.ts keys on X-Real-IP — must be the real client IP
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

```bash
ln -s /etc/nginx/sites-available/bch-rc /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d pocketrccars.com -d www.pocketrccars.com   # after DNS points here
```

`X-Forwarded-For` is set to `$remote_addr` (not appended) so a client cannot spoof it.

## 5. Cutting over from Vercel

- **Crons.** Vercel runs `reconcile` (every 5 min), `sync-shipments` (3-hourly) and
  `analytics-snapshots` (hourly). Keep `VPS_INSTALL_CRONS=false` while Vercel is live, or both
  will run them. Flip it to `true` when DNS moves. System cron uses the server's timezone;
  Vercel uses UTC. Set the VPS to UTC (`timedatectl set-timezone UTC`) to keep the same times.
- **Redirects and security headers** from `vercel.json` are applied by `next.config.ts` in the
  VPS build (`NEXT_OUTPUT=standalone`). If you edit one list, edit the other.
- **Webhooks** (Razorpay, Shiprocket, Resend) point at the domain, so they follow DNS. No change needed.
- **DNS**: point the A records for `pocketrccars.com` and `www` at the VPS, then run certbot.

## Operating

```bash
pm2 status                         # process state
pm2 logs bch-rc --lines 100        # app logs
cat <VPS_DEPLOY_PATH>/current/REVISION   # deployed commit

# manual rollback to an older release
cd <VPS_DEPLOY_PATH>
ln -sfn releases/<sha> current && APP_DIR=$PWD pm2 reload current/ecosystem.config.cjs --update-env
```
