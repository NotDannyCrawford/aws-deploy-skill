# Deployment Readiness Check Reference

Scan patterns and auto-fix templates for catching issues that would break in production.

## Table of Contents
- [Overview](#overview)
- [Code-Level Scans](#code-level-scans)
  - [Hardcoded Localhost](#hardcoded-localhost)
  - [Hardcoded Ports in API Calls](#hardcoded-ports-in-api-calls)
  - [CORS Origins](#cors-origins)
  - [WebSocket URLs](#websocket-urls)
  - [Database Connection Strings](#database-connection-strings)
- [Config-Level Checks](#config-level-checks)
  - [Debug Mode](#debug-mode)
  - [Production Dependencies](#production-dependencies)
  - [Framework-Specific Config](#framework-specific-config)
  - [Environment Variable Coverage](#environment-variable-coverage)
- [Docker-Level Checks](#docker-level-checks)
  - [Port Consistency](#port-consistency)
  - [Build Verification](#build-verification)
- [Auto-Fix Templates](#auto-fix-templates)

---

## Overview

The readiness check runs after containerization (Phase 2, Part B). Its purpose is to catch production-breaking issues BEFORE the user spends time setting up AWS and deploying. Every issue found here would be much harder to debug over SSH on a remote server.

The check should:
1. Scan silently (don't spam the user with "checking X... checking Y...")
2. Present all findings at once in a clear summary
3. Offer auto-fixes where possible
4. Let the user skip any fix they don't want
5. Not block deployment — warn, don't prevent

---

## Code-Level Scans

### Hardcoded Localhost

This is the most common production-breaking issue. Apps that work perfectly locally fail because URLs point to `localhost`.

#### What to scan for

```bash
# Scan source files for localhost references (exclude node_modules, .git, vendor, etc.)
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.py" --include="*.go" --include="*.rs" \
  --include="*.vue" --include="*.svelte" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor \
  --exclude-dir=__pycache__ --exclude-dir=.next --exclude-dir=dist \
  --exclude-dir=build \
  -E "(http|https)://(localhost|127\.0\.0\.1)" .

# Also check for non-URL localhost references in config-like patterns
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.py" --include="*.go" --include="*.json" --include="*.yaml" --include="*.yml" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor \
  --exclude-dir=__pycache__ --exclude-dir=.next --exclude-dir=dist \
  -E "(host|HOST|hostname|HOSTNAME)\s*[:=]\s*['\"]?(localhost|127\.0\.0\.1)" .
```

#### What to IGNORE (false positives)
- `README.md` or documentation files — these are fine
- Test files (`*.test.js`, `*.spec.ts`, `*_test.go`) — only run locally anyway
- Comments — not executed code
- `package.json` scripts like `"dev": "next dev"` — these are dev-only
- `.env` or `.env.local` files — these are supposed to have local values
- Docker healthcheck commands that use localhost (checking from inside the container is fine)
- `docker-compose.yml` internal references — services reference each other by name, not localhost

#### Severity
**High** — this WILL break in production if not fixed.

---

### Hardcoded Ports in API Calls

Apps that fetch from `http://localhost:3000/api` will break, but even relative URLs like `/api` are fine. The issue is specifically full URLs with ports.

#### What to scan for

```bash
# Full URLs with explicit ports in source code
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.py" --include="*.vue" --include="*.svelte" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude-dir=build --exclude-dir=__pycache__ \
  -E "(fetch|axios|http\.get|requests\.(get|post)|urllib)\s*\(.*localhost:[0-9]+" .
```

#### What to IGNORE
- Server listen calls like `app.listen(3000)` — these are fine, the port is set by the server
- Dockerfile `EXPOSE` statements — these are metadata
- `docker-compose.yml` port mappings — these are correct

#### Severity
**High** — same as hardcoded localhost. Usually found together.

---

### CORS Origins

If the backend has CORS configured with only localhost, the frontend will fail to make API calls in production.

#### What to scan for

```bash
# Node.js (Express/Fastify)
grep -rn \
  --include="*.js" --include="*.ts" \
  --exclude-dir=node_modules --exclude-dir=.git \
  -E "(cors|CORS|origin|Origin)\s*[:=].*localhost" .

# Python (Flask-CORS, Django)
grep -rn \
  --include="*.py" \
  --exclude-dir=venv --exclude-dir=.git --exclude-dir=__pycache__ \
  -E "(CORS_ORIGIN|ALLOWED_ORIGINS|cors_allowed_origins|origins)\s*[:=].*localhost" .
```

#### Auto-fix pattern
CORS origins should come from environment variables:

**Before (Node/Express):**
```javascript
app.use(cors({ origin: "http://localhost:3000" }));
```

**After:**
```javascript
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000" }));
```

Then `.env.example` gets:
```
CORS_ORIGIN=http://localhost:3000
```

And production `.env` on EC2 gets:
```
CORS_ORIGIN=https://your-domain.com
```

#### Severity
**High** — API calls from frontend will be blocked by browser.

---

### WebSocket URLs

WebSocket connections often hardcode `ws://localhost`.

#### What to scan for

```bash
grep -rn \
  --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --include="*.vue" --include="*.svelte" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  -E "ws(s)?://(localhost|127\.0\.0\.1)" .
```

#### Auto-fix pattern

**Before:**
```javascript
const ws = new WebSocket("ws://localhost:3000/ws");
```

**After:**
```javascript
const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000/ws";
const ws = new WebSocket(wsUrl);
```

For client-side code (React/Vue/etc.), the env var needs a framework-specific prefix:
- Next.js: `NEXT_PUBLIC_WS_URL`
- Vite: `VITE_WS_URL`
- Create React App: `REACT_APP_WS_URL`

#### Severity
**High** — WebSocket connections will fail silently in production.

---

### Database Connection Strings

If the app connects to a database, the connection string should use environment variables.

#### What to scan for

```bash
# Look for hardcoded database URLs
grep -rn \
  --include="*.js" --include="*.ts" --include="*.py" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor \
  --exclude-dir=__pycache__ --exclude-dir=venv \
  -E "(postgres|mysql|mongo|redis)://(localhost|127\.0\.0\.1)" .

# Also check for Prisma schema
grep -rn "url.*localhost" --include="*.prisma" .
```

#### What to IGNORE
- If the connection string is already reading from an env var (e.g., Prisma's `env("DATABASE_URL")`) — that's correct
- Docker Compose database service URLs using service names like `db:5432` — these are correct

#### Severity
**High** — app won't be able to connect to database in production.

---

## Config-Level Checks

### Debug Mode

Debug mode in production exposes stack traces, verbose errors, and sometimes secret keys.

#### What to scan for

**Django:**
```bash
grep -rn "DEBUG\s*=\s*True" --include="*.py" --exclude-dir=venv --exclude-dir=__pycache__ .
```

**Flask:**
```bash
grep -rn "debug\s*=\s*True" --include="*.py" --exclude-dir=venv --exclude-dir=__pycache__ .
grep -rn "FLASK_DEBUG\s*=\s*1" --include="*.env*" .
```

**Node.js:**
```bash
# Check for verbose logging that shouldn't be in production
grep -rn "NODE_ENV.*development" --include="*.js" --include="*.ts" --exclude-dir=node_modules .
```

#### Auto-fix pattern

Debug mode should be driven by environment:

**Django:**
```python
# Before
DEBUG = True

# After
DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'
```

**Flask:**
```python
# Before
app.run(debug=True)

# After
app.run(debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true')
```

Note: With gunicorn in production, `app.run()` isn't called at all, so this is mostly about ensuring settings files are correct.

#### Severity
**Medium** — won't break the app but exposes sensitive info and hurts performance.

---

### Production Dependencies

Missing production dependencies mean the Docker build succeeds locally (where dev dependencies exist) but the container fails to start.

#### What to check

**Python (Flask):**
```bash
# gunicorn should be in requirements.txt for production
grep -q "gunicorn" requirements.txt 2>/dev/null || echo "MISSING: gunicorn"
```

**Python (FastAPI):**
```bash
grep -q "uvicorn" requirements.txt 2>/dev/null || echo "MISSING: uvicorn"
```

**Node.js:**
```bash
# Check package.json has a start script
node -e "const p = require('./package.json'); if (!p.scripts?.start) console.log('MISSING: start script')"
```

#### Auto-fix
- Add `gunicorn` to `requirements.txt`
- Add `uvicorn[standard]` to `requirements.txt`
- Add `"start": "node server.js"` to `package.json` scripts (adjust filename)

#### Severity
**High** — container will start but app will fail to serve requests, or Docker build fails.

---

### Framework-Specific Config

#### Next.js
- `output: 'standalone'` in `next.config.js` — required for the Docker standalone build
- Check: `grep -q "standalone" next.config.*`

#### Django
- `ALLOWED_HOSTS` should include the domain/IP or `*` for initial testing
- `STATIC_ROOT` should be set for `collectstatic`
- `SECRET_KEY` should come from environment

#### Flask
- Should NOT use the built-in development server in production
- Must use gunicorn or waitress as WSGI server

#### Express/Node
- Should have a `start` script in `package.json`
- Port should come from `process.env.PORT` or a sensible default

#### Severity
**Medium to High** depending on the specific issue.

---

### Environment Variable Coverage

Verify that every environment variable used in the code is documented.

#### What to check

```bash
# Node.js: find all process.env references
grep -roh "process\.env\.\w\+" --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=.git . | sort -u

# Python: find all os.environ / os.getenv references
grep -roh "os\.environ\['\w\+'\]" --include="*.py" --exclude-dir=venv --exclude-dir=__pycache__ . | sort -u
grep -roh "os\.getenv(['\"]\\w\+['\"])" --include="*.py" --exclude-dir=venv --exclude-dir=__pycache__ . | sort -u

# Then check if each one exists in .env.example
```

#### Auto-fix
Add any missing env vars to `.env.example` with placeholder values.

#### Severity
**Medium** — app might crash on startup if a required env var is missing.

---

## Docker-Level Checks

### Port Consistency

The port the app listens on must match what Caddy proxies to.

#### What to check

1. Find the app's port:
   - Dockerfile `EXPOSE` statement
   - `app.listen(PORT)` in source code
   - gunicorn/uvicorn `--port` or `--bind` flags

2. Check Caddyfile `reverse_proxy` target:
   ```
   reverse_proxy app:3000
   ```

3. These must match. If the app runs on 8000 but Caddy proxies to 3000, traffic won't reach the app.

#### Severity
**Critical** — app will appear to be down.

---

### Build Verification

Optionally run a Docker build to catch issues early.

```bash
docker compose build 2>&1
```

Common build failures:
- Missing files referenced in `COPY` commands
- Dependencies that fail to install (wrong Python version, native modules needing build tools)
- Syntax errors in Dockerfile

Ask the user if they want to run this. It takes 1-3 minutes but catches a lot of issues.

#### Severity
**Critical** if it fails — the app literally can't be deployed.

---

## Auto-Fix Templates

When offering auto-fixes, use these patterns to replace hardcoded values with environment variables.

### Node.js / JavaScript / TypeScript

**API URL:**
```javascript
// Before
const API_URL = "http://localhost:3000";

// After
const API_URL = process.env.API_URL || "http://localhost:3000";
```

**For client-side code (browser-executed):**
```javascript
// Next.js (must prefix with NEXT_PUBLIC_)
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Vite (must prefix with VITE_)
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

// Create React App (must prefix with REACT_APP_)
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3000";
```

### Python

**API URL / Config:**
```python
# Before
API_URL = "http://localhost:3000"

# After
import os
API_URL = os.environ.get("API_URL", "http://localhost:3000")
```

**Django settings:**
```python
# Before
DEBUG = True
ALLOWED_HOSTS = []

# After
DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost').split(',')
```

### Go

```go
// Before
apiURL := "http://localhost:3000"

// After
apiURL := os.Getenv("API_URL")
if apiURL == "" {
    apiURL = "http://localhost:3000"
}
```

### .env.example additions

For every env var introduced by auto-fixes, add it to `.env.example`:

```bash
# API Configuration
API_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
WS_URL=ws://localhost:3000/ws

# App Configuration
NODE_ENV=production
DEBUG=false
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@db:5432/dbname
```

And remind the user that the production `.env` on EC2 will have different values:

```bash
# Production values (on EC2)
API_URL=https://your-domain.com
CORS_ORIGIN=https://your-domain.com
WS_URL=wss://your-domain.com/ws
NODE_ENV=production
DEBUG=false
PORT=3000
DATABASE_URL=postgresql://postgres:strongpassword@db:5432/app
```