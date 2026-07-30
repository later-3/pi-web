# pi-web Mobile Cloud Relay — Stage 1 Runbook

## Overview

Stage 1 adds infrastructure so a phone and a Mac can reach the **same**
pi-web backend process:

```
Phone ──▶ Cloudflare ──▶ Nginx (121.43.113.236:33042) ─┐
                                                         │ SSH reverse tunnel
Mac ──▶ 127.0.0.1:30141 ──▶ pi-web (next start) ───────┘
```

- **Mac** continues to access `http://127.0.0.1:30141` (dev or production).
- **Phone** accesses `https://pi.ai4child.asia` (Cloudflare → Nginx → SSH tunnel → pi-web).
- Both reach the **same** Next.js process and the **same** in-process AgentSession registry.

## Deployment Configuration (2026-07-29)

- Public URL: `https://pi.ai4child.asia`
- App login accounts: `piweb`, `later` (shared application privileges; no RBAC)
- Credentials file (Mac only, mode `600`, gitignored): `deploy/secrets/pi-web-auth-credentials.json`
- Legacy `piweb` password file (kept for migration, gitignored): `deploy/secrets/pi-web-http-password`
- Cookie signing key (Mac only, gitignored): `deploy/secrets/pi-web-session-secret`
- Mac production and SSH relay LaunchAgents are loaded and enabled with
  `KeepAlive=true`.
- Public create → local read → local delete → public 404 was verified with a
  temporary session, confirming that both clients use the same backend.
- Server services kept active: Nginx, cloudflared, AuditTraceAI.
- Retired services: Happy, PostgreSQL 16, and the old ngrok process are stopped;
  Happy and PostgreSQL are disabled from automatic startup. PostgreSQL data is
  preserved and its cluster startup mode is `manual`.

## What is in scope (Stage 1)

| Component | Purpose |
|---|---|
| `GET /api/health` | Lightweight readiness probe (no sensitive data) |
| `PI_WEB_DIST_DIR` | Isolate production build to `.next-mobile/` |
| `build:mobile` / `start:mobile` | npm scripts for the mobile production build |
| LaunchAgent: `com.later.pi-web.production` | Runs `next start` with `.next-mobile` |
| LaunchAgent: `com.later.pi-web.cloud-relay` | SSH `-R 127.0.0.1:33041:127.0.0.1:30141` |
| Nginx on server | Reverse proxy to `127.0.0.1:33041`; no browser-native auth prompt |
| Pi Web auth | Public `/login`, signed HttpOnly cookie, protected pages/API/SSE |
| Install / uninstall / verify scripts | Local Mac automation |
| Server install script | Nginx config deployment with backup and rollback |

## What is NOT in scope (Stage 1)

- PWA / service worker / offline support
- Voice / audio input on mobile
- Mobile-specific UI layout or responsive redesign
- Cloudflare Access / Zero Trust
- RBAC / multi-user isolation
- Happy / Paseo / Runtime Broker
- Real-time sync between Mac and phone (manual browser refresh)

## Architecture Constraints

### Single backend process

Both the Mac browser and the phone browser reach the **same** `next start`
process. This means:

- Session list, session content, and agent state are identical for both.
- SSE streams from either browser go to the same AgentSession registry.
- There is no database replication or sync layer.

### Manual refresh for cross-device sync

When the Mac sends a message, the phone will not see it until the user
manually refreshes the page (and vice versa). Real-time push between
browsers is not implemented in Stage 1.

### No concurrent pi writes to the same session

The native terminal `pi` CLI and the web UI both write to the same
`~/.pi/agent/sessions/` directory. **Do not** run the terminal `pi` and
the web UI against the same session file simultaneously — this can corrupt
the `.jsonl` file. This is an existing constraint, not new to Stage 1.

## Port Map

| Port | Where | Purpose |
|---|---|---|
| 30141 | Mac loopback | pi-web (dev or production) |
| 33041 | Server loopback | SSH reverse tunnel target |
| 33042 | Server loopback | Nginx reverse proxy |
| 443 | Cloudflare edge | TLS termination → Nginx |

## Installation

### Prerequisites

- Passwordless SSH to `root@121.43.113.236` with the host key already accepted.
- `nginx` installed on the server with `sites-available` / `sites-enabled`.
- `openssl` available locally (for password and signing-key generation).
- `node >= 22.19.0` and `npm install` already done.

### First-time install

```bash
chmod +x scripts/install-mobile-relay.sh
./scripts/install-mobile-relay.sh
```

This will:
1. Build `.next-mobile/` (production build).
2. Generate a random initial password and create `deploy/secrets/pi-web-auth-credentials.json` when absent.
3. Generate an independent signing key in `deploy/secrets/pi-web-session-secret`.
4. Install the Nginx config without `auth_basic` (with backup + rollback on failure).
5. Configure Pi Web to validate signed HttpOnly session cookies.
6. Install two LaunchAgents on the Mac.
7. Wait for readiness and print the summary.

### Skip options

```bash
# Skip the build (use existing .next-mobile):
./scripts/install-mobile-relay.sh --skip-build

# Keep the current server-side Nginx config (the SSH relay still starts):
./scripts/install-mobile-relay.sh --skip-server
```

`--skip-server` intentionally leaves the existing public Nginx policy unchanged;
it still connects to the server, reclaims a stale dedicated relay port when
needed, and starts the SSH tunnel. It does not remove an already-installed
Basic Auth prompt from the public PWA.

### Uninstall

```bash
chmod +x scripts/uninstall-mobile-relay.sh
./scripts/uninstall-mobile-relay.sh
```

This removes only the two LaunchAgent labels and their plist files.
User data, sessions, logs, secrets, and build artifacts are preserved.

### Verify

```bash
chmod +x scripts/verify-mobile-relay.sh
./scripts/verify-mobile-relay.sh
```

Checks local health, LaunchAgent status, public login reachability, absence of
`WWW-Authenticate`, protected-route redirects, cookie login, and optionally
the public hostname (set `PI_WEB_PUBLIC_HOSTNAME=none` to skip).

## Cloudflare Setup (manual, out of script scope)

Reuse the existing named tunnel. Do not add an A record to the server and do
not expose port `33042` publicly:

1. Add a tunnel DNS route for `pi.ai4child.asia` to the existing named tunnel.
2. Insert this ingress rule before the final `http_status:404` rule in the
   server's `/etc/cloudflared/config.yml`:

   ```yaml
   - hostname: pi.ai4child.asia
     service: http://127.0.0.1:33042
   ```

3. Validate the ingress rules and restart `cloudflared`.

4. Ensure the cloudflared systemd unit does not depend on the retired Happy
   service. `deploy/server/cloudflared-pi-web.service` is the reviewed unit used
   by the current deployment.

> **Note**: Cloudflare configuration is handled by the main agent and is
> intentionally not automated in these scripts.

## File Layout

```
deploy/
  macos/
    com.later.pi-web.production.plist.in   LaunchAgent template (next start)
    com.later.pi-web.cloud-relay.plist.in  LaunchAgent template (ssh tunnel)
  nginx/
    pi-web.conf                            Nginx server block template
  server/
    cloudflared-pi-web.service               cloudflared unit without Happy dependency
    install-pi-web-relay.sh                Server-side install script
  secrets/                                 (gitignored) Random passwords
  logs/                                    (created at install) Runtime logs
  state/                                   (created at install) Install metadata
scripts/
  install-mobile-relay.sh                  Local Mac install
  uninstall-mobile-relay.sh                Local Mac uninstall
  verify-mobile-relay.sh                   Verification checks
```

## Troubleshooting

### Production server won't start

```bash
cat deploy/logs/pi-web.stderr.log
# Check if port 30141 is free:
lsof -i :30141
```

### SSH tunnel drops

```bash
cat deploy/logs/cloud-relay.stderr.log
./scripts/manage-pi-web.sh restart
```

The LaunchAgent has `KeepAlive=true` and `ThrottleInterval=10`, so launchd
restarts an ordinary failed client. A Mac sleep or network transition can leave
the remote `sshd` listener stuck on port `33041`; `start`, `restart`, and the
installer reclaim that listener only after confirming the owner is `sshd`.

### Nginx returns 502

The SSH tunnel may be down. Check:
```bash
launchctl print gui/$(id -u)/com.later.pi-web.cloud-relay
ssh root@121.43.113.236 'curl -s http://127.0.0.1:33041/api/health'
```

### Nginx test fails during install

The server install script runs `nginx -t` before `systemctl reload nginx`.
If the test fails, the trap rolls back to the previous config automatically.

## Rollback

If something goes wrong during install:

1. **Local**: Run `./scripts/uninstall-mobile-relay.sh`.
2. **Server**: The install script backs up existing files to
   `/var/backups/pi-web/<release-id>/` and rolls back on any error.
3. **Manual server rollback**:
   ```bash
   ls /var/backups/pi-web/
   # Restore from the most recent backup.
   ```
