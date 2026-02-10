# Docker Validation Reference

**Purpose:** Catch Docker build issues BEFORE deploying to EC2. These checks run after generating Dockerfiles but before AWS provisioning.

## Why This Matters

In our OCaml deployment, we hit these issues on the server:
1. **Build context mismatch** - Dockerfile `COPY` paths didn't match docker-compose `context`
2. **Missing TypeScript** - Used `--only=production` but needed devDependencies for build
3. **Missing env vars** - GEMINI_MODEL wasn't in docker-compose.yml environment section

These would have been caught with validation!

---

## Validation Checks

### 1. Build Context Validation

**Problem:** If `docker-compose.yml` sets `context: ./frontend` but Dockerfile has `COPY package.json`, it works. But if it tries `COPY docker/nginx.conf`, it fails because `docker/` isn't in the `frontend/` context.

**Check:**
```bash
# For each service in docker-compose.yml:
# 1. Get the build context (e.g., "./frontend")
# 2. Get the Dockerfile path
# 3. Parse Dockerfile for all COPY/ADD commands
# 4. Verify each COPY source exists relative to build context
```

**Common Patterns:**

**❌ Wrong:**
```yaml
# docker-compose.yml
services:
  frontend:
    build:
      context: ./frontend  # <-- context is frontend/
      dockerfile: ../docker/frontend.Dockerfile
```
```dockerfile
# docker/frontend.Dockerfile
COPY docker/nginx.conf /etc/nginx/  # <-- FAILS! docker/ not in frontend/
```

**✅ Right - Option 1 (Root context):**
```yaml
services:
  frontend:
    build:
      context: .  # <-- Root of project
      dockerfile: ./docker/frontend.Dockerfile
```
```dockerfile
COPY frontend/package.json /app/
COPY docker/nginx.conf /etc/nginx/  # Works!
```

**✅ Right - Option 2 (Copy to context first):**
```yaml
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: ../docker/frontend.Dockerfile
```
```dockerfile
COPY package.json /app/
# Don't reference files outside context
```

**Auto-fix:** Suggest using root context (`.`) for complex projects with shared files.

---

### 2. Multi-Stage Build Validation

**Problem:** Frontend builds often need devDependencies (TypeScript, Vite, etc.) but production flag skips them.

**Check:**
```bash
# Parse Dockerfile for:
# 1. RUN npm ci --production OR RUN npm ci --only=production
# 2. Check if there's a subsequent RUN npm run build
# 3. Check package.json for build dependencies (typescript, vite, webpack)
```

**Common Patterns:**

**❌ Wrong:**
```dockerfile
FROM node:20-alpine AS builder
COPY package*.json ./
RUN npm ci --only=production  # <-- Skips typescript!
RUN npm run build  # <-- FAILS! tsc not found
```

**✅ Right:**
```dockerfile
FROM node:20-alpine AS builder
COPY package*.json ./
RUN npm ci  # <-- Install ALL deps (including devDependencies)
RUN npm run build  # <-- Works!

FROM node:20-alpine AS runtime
# Only copy built files, don't need node_modules
COPY --from=builder /app/dist ./dist
```

**Auto-fix:** If `RUN npm run build` follows `--only=production`, remove the flag.

---

### 3. Environment Variable Coverage

**Problem:** Backend needs env vars that aren't defined in docker-compose.yml

**Check:**
```bash
# 1. Parse backend config.py or equivalent for os.getenv() / config.get() calls
# 2. Extract all environment variable names
# 3. Check docker-compose.yml environment section
# 4. Flag any missing variables
```

**Example from our deployment:**

**Backend config.py used:**
```python
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-1.5-pro')
CLAUDE_MODEL = os.getenv('CLAUDE_MODEL', 'claude-sonnet-4-20250514')
```

**But docker-compose.yml only had:**
```yaml
environment:
  - GEMINI_API_KEY=${GEMINI_API_KEY}
  # Missing: GEMINI_MODEL, CLAUDE_MODEL
```

**Result:** Backend used default values instead of .env values!

**Auto-fix:**
```yaml
environment:
  - GEMINI_API_KEY=${GEMINI_API_KEY}
  - GEMINI_MODEL=${GEMINI_MODEL:-gemini-1.5-pro}  # <-- Add these
  - CLAUDE_MODEL=${CLAUDE_MODEL:-claude-sonnet-4-20250514}
```

**Detection strategy:**
- Python: Scan for `os.getenv()`, `os.environ.get()`, `config.get()`
- Node.js: Scan for `process.env.`
- Compare with docker-compose.yml `environment:` section
- Also check `.env.example` for expected variables

---

### 4. Port Consistency Check

**Problem:** App listens on one port, Caddy proxies to another.

**Check:**
```bash
# 1. Find app's listening port from:
#    - Dockerfile EXPOSE
#    - Backend code (app.listen, app.run)
#    - docker-compose.yml ports mapping
# 2. Find Caddyfile reverse_proxy target
# 3. Verify they match
```

**Example:**

**Dockerfile:**
```dockerfile
EXPOSE 5000
```

**Backend code:**
```python
app.run(port=5001)  # <-- Mismatch!
```

**Caddyfile:**
```
:80 {
    reverse_proxy backend:5000  # <-- Which port is right?
}
```

**Auto-fix:** Flag the mismatch, suggest making them consistent.

---

### 5. Docker Compose Syntax Validation

**Check:**
```bash
docker compose config
```

This validates:
- YAML syntax
- Valid service names
- Volume/network references
- Build context paths exist

**Common errors caught:**
- Invalid YAML indentation
- Referencing non-existent files in `dockerfile:`
- Circular dependencies in `depends_on:`
- Invalid port mappings

---

### 6. Local Build Test (Optional)

**Check:**
```bash
docker compose build
```

**When to run:**
- Always suggest it
- Make it optional (can take 5-10 min)
- If user declines, warn them builds will happen on EC2

**Benefits:**
- Catches all build errors locally
- Faster iteration (no EC2 SSH delay)
- Downloads images/layers on fast connection

**Present as:**
```
Would you like to test the Docker build locally before deploying?
This takes 5-10 minutes but catches build errors early.

[Y] Yes, test now (Recommended)
[N] No, build on EC2 (faster but harder to debug)
```

---

## Validation Output Format

Present all findings at once, grouped by severity:

```
🔍 Docker Configuration Validation

❌ CRITICAL (must fix):
  • Build context mismatch in frontend service
    - Dockerfile tries to COPY docker/nginx.conf
    - But build context is ./frontend (docker/ not accessible)
    Fix: Change context to "." in docker-compose.yml? (y/n)

⚠️  WARNINGS (recommended fixes):
  • Missing environment variables in backend service
    - Backend code uses GEMINI_MODEL
    - Not defined in docker-compose.yml environment section
    Fix: Add GEMINI_MODEL to docker-compose.yml? (y/n)

  • Frontend build uses --only=production but needs TypeScript
    - npm ci --only=production skips devDependencies
    - But package.json has typescript as devDependency
    Fix: Remove --only=production flag? (y/n)

✅ PASSED:
  • Port consistency (backend:5000 → Caddy → backend:5000)
  • Docker Compose syntax valid
  • All COPY sources exist in build contexts

2 critical issues, 2 warnings. Fix before deploying? (y/n)
```

---

## Implementation Strategy

**When to run:** After generating Dockerfiles, before AWS setup.

**Add as Phase 2.5:**
```
Phase 1: Pre-flight Check
Phase 2: Detect & Containerize
Phase 2.5: Docker Validation  ← NEW
Phase 3: AWS Setup
Phase 4: Deploy
...
```

**User can skip** validation but should see warnings:
```
⚠️  Skipping Docker validation. If build fails on EC2, you'll need to:
  1. Fix the issue locally
  2. Commit and push
  3. SSH into EC2 and pull changes
  4. Rebuild: docker compose up -d --build
```

---

## Common Fix Patterns

### Fix: Build Context Mismatch

**Option 1 - Use root context:**
```yaml
# Before
services:
  frontend:
    build:
      context: ./frontend
      dockerfile: ../docker/frontend.Dockerfile

# After
services:
  frontend:
    build:
      context: .  # Root of project
      dockerfile: ./docker/frontend.Dockerfile
```

Then update Dockerfile COPY paths:
```dockerfile
# Before
COPY package.json ./

# After
COPY frontend/package.json ./
```

**Option 2 - Copy shared files to service directory:**
```bash
# Add to build process
cp docker/nginx.conf frontend/nginx.conf
```

Then keep context as `./frontend` and `COPY nginx.conf`.

---

### Fix: Missing Build Dependencies

```dockerfile
# Before
RUN npm ci --only=production
RUN npm run build

# After
RUN npm ci  # Install ALL dependencies
RUN npm run build
# Optionally: RUN npm prune --production  # Clean up after build
```

Or use multi-stage build:
```dockerfile
FROM node:20-alpine AS builder
RUN npm ci  # All deps
RUN npm run build

FROM node:20-alpine AS runtime
COPY --from=builder /app/dist ./dist
# Runtime doesn't need devDependencies
```

---

### Fix: Missing Environment Variables

Scan config files, add to docker-compose.yml:

```yaml
environment:
  - EXISTING_VAR=${EXISTING_VAR}
  - GEMINI_MODEL=${GEMINI_MODEL:-gemini-1.5-pro}  # Add with default
  - CLAUDE_MODEL=${CLAUDE_MODEL:-claude-sonnet-4}  # Add with default
```

Remind user to add to `.env` on server!

---

## Benefits

**For users:**
- Catch errors locally (faster than debugging on EC2)
- Understand Docker issues before deploying
- Smoother deployment experience

**For maintainers:**
- Fewer deployment failures
- Better user experience
- Teachable moments about Docker best practices

**Time saved:**
- Our deployment: ~30 min debugging Docker issues on EC2
- With validation: Would catch in ~2 min locally
