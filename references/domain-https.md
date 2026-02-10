# Domain + HTTPS Reference

Setting up a custom domain with automatic HTTPS using Caddy.

## Table of Contents
- [How Caddy HTTPS Works](#how-caddy-https-works)
- [DNS Setup by Registrar](#dns-setup-by-registrar)
- [Caddyfile Patterns](#caddyfile-patterns)
- [Applying Domain Changes](#applying-domain-changes)
- [Verifying HTTPS](#verifying-https)
- [Subdomains](#subdomains)
- [Troubleshooting HTTPS](#troubleshooting-https)

---

## How Caddy HTTPS Works

Caddy automatically provisions and renews TLS certificates from Let's Encrypt. When you put a domain name in the Caddyfile (instead of `:80`), Caddy:

1. Listens on port 80 for the ACME HTTP-01 challenge
2. Requests a certificate from Let's Encrypt
3. Starts serving HTTPS on port 443
4. Automatically redirects HTTP → HTTPS
5. Renews the certificate before it expires (every ~60 days)

The user does NOT need to:
- Install Certbot
- Run any certificate commands
- Set up cron jobs for renewal
- Configure HTTPS listeners manually

The only requirement is that the domain's DNS A record points to the server's IP BEFORE Caddy tries to get the certificate. Let's Encrypt validates domain ownership by making an HTTP request to the domain.

---

## DNS Setup by Registrar

Tell the user to create an A record pointing to their Elastic IP. The exact steps vary by registrar:

### General instructions (works for any registrar)
```
Type: A
Name: @ (for root domain) or subdomain name (e.g., "app")
Value: <elastic-ip-address>
TTL: 300 (5 minutes, for quick propagation during setup)
```

### Namecheap
1. Go to Domain List → Manage → Advanced DNS
2. Add New Record → A Record
3. Host: `@` | Value: `<elastic-ip>` | TTL: 5 min

### Cloudflare
1. Go to DNS → Records → Add record
2. Type: A | Name: `@` | IPv4: `<elastic-ip>`
3. **Important:** Set proxy status to "DNS only" (gray cloud) — Cloudflare's proxy conflicts with Caddy's HTTPS

### Google Domains / Squarespace Domains
1. Go to DNS → Resource Records
2. Create A record: Host: `@` | Data: `<elastic-ip>`

### GoDaddy
1. Go to My Products → DNS → Manage
2. Add Record → A | Name: `@` | Value: `<elastic-ip>` | TTL: 600

### Verifying DNS propagation
After setting the A record, check that it has propagated:
```bash
dig +short your-domain.com
# Should return the Elastic IP
```

Or use: https://dnschecker.org

DNS propagation can take anywhere from 1 minute to 48 hours, but usually completes within 5-15 minutes for new records.

---

## Caddyfile Patterns

### Basic domain with reverse proxy
```
your-domain.com {
    reverse_proxy app:3000
}
```

### With www redirect
```
www.your-domain.com {
    redir https://your-domain.com{uri} permanent
}

your-domain.com {
    reverse_proxy app:3000
}
```

### Static file serving with domain
```
your-domain.com {
    root * /srv
    file_server
    try_files {path} /index.html
}
```

### API + static frontend on same domain
```
your-domain.com {
    handle /api/* {
        reverse_proxy app:3000
    }
    handle {
        root * /srv
        file_server
        try_files {path} /index.html
    }
}
```

### Multiple subdomains
```
api.your-domain.com {
    reverse_proxy api-app:3000
}

your-domain.com {
    reverse_proxy frontend-app:3000
}
```

### With basic security headers
```
your-domain.com {
    reverse_proxy app:3000
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

---

## Applying Domain Changes

When updating the Caddyfile on the server:

### Method 1: Edit in place
```bash
ssh -i ~/.ssh/deploy-key.pem ubuntu@<ip>
cd /opt/apps/<project-name>
nano Caddyfile  # Make changes
docker compose restart caddy
```

### Method 2: Copy from local machine
```bash
scp -i ~/.ssh/deploy-key.pem ./Caddyfile ubuntu@<ip>:/opt/apps/<project-name>/Caddyfile
ssh -i ~/.ssh/deploy-key.pem ubuntu@<ip> "cd /opt/apps/<project-name> && docker compose restart caddy"
```

### Method 3: Update via git (if Caddyfile is in repo)
```bash
ssh -i ~/.ssh/deploy-key.pem ubuntu@<ip>
cd /opt/apps/<project-name>
git pull
docker compose restart caddy
```

After restarting Caddy, check its logs to confirm the certificate was provisioned:
```bash
docker compose logs caddy
```

You should see messages about obtaining a certificate. If there are errors, see the troubleshooting section.

---

## Verifying HTTPS

### Check certificate
```bash
curl -vI https://your-domain.com 2>&1 | grep -E "(SSL|subject|issuer|expire)"
```

### Check redirect
```bash
curl -sI http://your-domain.com | head -5
# Should show 301/308 redirect to https://
```

### Browser check
Open `https://your-domain.com` in a browser. You should see the padlock icon. Click it to inspect the certificate — it should say "Let's Encrypt" as the issuer.

---

## Subdomains

To set up a subdomain (e.g., `app.your-domain.com`):

1. Add an A record for the subdomain pointing to the same Elastic IP
2. Add the subdomain block to the Caddyfile
3. Restart Caddy

Each subdomain gets its own certificate automatically.

---

## Troubleshooting HTTPS

### "failed to obtain certificate"
- **DNS not propagated yet**: Wait a few minutes, then restart Caddy
- **Port 80 not open**: Caddy needs port 80 for the ACME challenge. Check the security group.
- **Rate limited**: Let's Encrypt has rate limits (50 certs per domain per week). Unlikely for new deployments but possible if testing repeatedly.

### Caddy logs show "tls: failed to verify certificate"
- The domain doesn't point to this server. Verify with `dig +short your-domain.com`.

### HTTPS works but HTTP doesn't redirect
- This shouldn't happen with Caddy (it auto-redirects). Check that port 80 is open in the security group.

### Certificate renewal issues
- Caddy handles renewal automatically. If it fails, check that:
  - Port 80 is still open
  - The domain still points to the server
  - `docker compose logs caddy` for specific errors

### Cloudflare proxy conflicts
If the user uses Cloudflare, they MUST set the DNS record to "DNS only" (gray cloud icon). Cloudflare's proxy terminates SSL at their edge, which conflicts with Caddy trying to get its own certificate. Options:
1. **DNS only mode** (recommended): Let Caddy handle SSL end-to-end
2. **Full (strict) mode**: Use Cloudflare's proxy with Caddy, but this requires configuring Caddy to use Cloudflare's origin certificates instead of Let's Encrypt — more complex, skip for v1
