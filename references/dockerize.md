# Dockerize Reference

Stack-specific Dockerfile templates and docker-compose patterns.

## Table of Contents
- [Detection Logic](#detection-logic)
- [Node.js / Express](#nodejs--express)
- [Next.js](#nextjs)
- [React / Vue / Vite (Static SPA)](#react--vue--vite-static-spa)
- [Python / Flask](#python--flask)
- [Python / FastAPI](#python--fastapi)
- [Python / Django](#python--django)
- [Go](#go)
- [Static HTML](#static-html)
- [Docker Compose Template](#docker-compose-template)
- [Caddyfile Templates](#caddyfile-templates)
- [With Database](#with-database)

---

## Detection Logic

Check files in the project root to determine the stack:

| File | Stack | Check for |
|------|-------|-----------|
| `package.json` | Node.js | Check `dependencies` for framework |
| `next.config.*` | Next.js | — |
| `vite.config.*` | Vite (React/Vue/Svelte) | — |
| `angular.json` | Angular | — |
| `requirements.txt` | Python | Check for flask/django/fastapi |
| `pyproject.toml` | Python | Check `[project.dependencies]` or `[tool.poetry.dependencies]` |
| `go.mod` | Go | — |
| `Cargo.toml` | Rust | — |
| `index.html` (no package.json) | Static | — |
| `Dockerfile` | Already containerized | Use as-is, review if requested |

For Node.js, determine the framework from `package.json` dependencies:
- `next` → Next.js
- `express` / `fastify` / `koa` / `hono` → Node API server
- `react` / `vue` / `svelte` (without SSR framework) → Static SPA (build + serve)

---

## Node.js / Express

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app .
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

Adjust `CMD` based on the `start` script in `package.json`. Common patterns:
- `"start": "node server.js"` → `CMD ["node", "server.js"]`
- `"start": "node index.js"` → `CMD ["node", "index.js"]`
- `"start": "node dist/index.js"` → Add a build step, then `CMD ["node", "dist/index.js"]`

If using TypeScript, add a build step:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
```

---

## Next.js

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

**Important:** This requires `output: 'standalone'` in `next.config.js`. If the user doesn't have this, add it:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}
module.exports = nextConfig
```

---

## React / Vue / Vite (Static SPA)

These frameworks build to static files. Use Caddy to serve them directly — no need for a Node server in production.

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=builder /app/dist /srv
```

For this pattern, the Caddyfile serves files directly instead of reverse proxying:
```
:80 {
    root * /srv
    file_server
    try_files {path} /index.html
}
```

**Note:** The `try_files` directive is critical for SPAs — it ensures client-side routing works by falling back to `index.html` for all routes.

When using this pattern, the docker-compose.yml does NOT need a separate Caddy service — Caddy is the app container. Adjust the compose file accordingly (see the static SPA variant in the Docker Compose section).

Build output directories by framework:
- Vite / React (Vite): `dist/`
- Create React App: `build/`
- Vue CLI: `dist/`
- Angular: `dist/<project-name>/`

---

## Python / Flask

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .
EXPOSE 5000
RUN useradd -m appuser
USER appuser
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "app:app"]
```

Make sure `gunicorn` is in `requirements.txt`. If the user is using `flask run` in development, explain that gunicorn is the production server.

Adjust `app:app` based on the project structure:
- `app.py` with `app = Flask(__name__)` → `app:app`
- `main.py` with `app = Flask(__name__)` → `main:app`
- Factory pattern `create_app()` → `app:create_app()`

---

## Python / FastAPI

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .
EXPOSE 8000
RUN useradd -m appuser
USER appuser
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

Ensure `uvicorn` is in `requirements.txt`. Adjust `main:app` to match the actual module and variable name.

---

## Python / Django

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY . .
RUN python manage.py collectstatic --noinput
EXPOSE 8000
RUN useradd -m appuser
USER appuser
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "config.wsgi:application"]
```

Adjust `config.wsgi:application` — the WSGI module is usually `<project_name>.wsgi:application`. Check the Django project's `wsgi.py` location.

For Django, also remind the user to:
- Set `ALLOWED_HOSTS` to include the domain/IP
- Set `DEBUG = False` in production
- Configure `STATIC_ROOT` for collectstatic

---

## Go

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE 8080
RUN adduser -D appuser
USER appuser
CMD ["./server"]
```

Go produces a single static binary — the final image is tiny (~15MB).

---

## Static HTML

If there's just an `index.html` with no build step:

```dockerfile
FROM caddy:2-alpine
COPY . /srv
```

Same Caddyfile pattern as the SPA, but without `try_files`:
```
:80 {
    root * /srv
    file_server
}
```

---

## Docker Compose Template

### Standard (app + Caddy reverse proxy)

This is the default for any app that runs its own server (Node, Python, Go, etc.):

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    networks:
      - web

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - web
    depends_on:
      - app

volumes:
  caddy_data:
  caddy_config:

networks:
  web:
```

### Static SPA variant (Caddy serves files directly)

For React/Vue/static builds where Caddy IS the server:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

---

## Caddyfile Templates

### IP-only (no domain, Phase 3)
```
:80 {
    reverse_proxy app:3000
}
```

### With domain (Phase 4)
```
your-domain.com {
    reverse_proxy app:3000
}
```

### Static files with domain
```
your-domain.com {
    root * /srv
    file_server
    try_files {path} /index.html
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

Adjust the port in `reverse_proxy` to match the app's exposed port (3000 for Node, 5000 for Flask, 8000 for FastAPI/Django, 8080 for Go).

---

## With Database

If the app needs PostgreSQL, add to docker-compose.yml:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    depends_on:
      - db
    networks:
      - web

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-app}
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - web

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - web
    depends_on:
      - app

volumes:
  caddy_data:
  caddy_config:
  pgdata:

networks:
  web:
```

The app should connect to the database using the service name as the host: `postgresql://postgres:password@db:5432/app`

Remind the user to set `DB_PASSWORD` in their `.env` file with a strong password.
