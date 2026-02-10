---
name: aws-deploy
description: Deploy any web project to AWS EC2 with Docker, automatic HTTPS, and push-to-deploy CI/CD. Use this skill whenever the user wants to deploy, host, launch, or ship a website, web app, API, or project to AWS, EC2, or "the cloud." Also trigger when the user says "make this live," "put this online," "host this," "deploy this," or asks about setting up a server. Covers project hygiene, containerization, EC2 provisioning, domain/SSL setup, and GitHub Actions auto-deploy. Does NOT cover ECS, EKS, Lambda, S3 static hosting, or other advanced AWS services — this is intentionally simple EC2-based deployment.
---

# AWS Deploy Skill

Deploy a web project to a single EC2 instance using Docker + Caddy, with optional custom domain, automatic HTTPS, and GitHub Actions CI/CD.

## Philosophy

This skill prioritizes simplicity over scalability. One server, one Docker Compose stack, zero managed services. This covers 90% of personal projects, MVPs, and small business apps. The user can always scale later.

**Skip-if-done principle:** At the start of EVERY phase, check whether the user has already completed it. Don't force someone to set up an AWS account if they already have one. Ask first, verify if possible, then skip or proceed.

## When to Use

- User has a web project (frontend, backend, fullstack, API) and wants it live on the internet
- User mentions AWS, EC2, deployment, hosting, or "making it live"
- User wants to update a previously deployed project

---

## Workflow Overview

The deployment has 8 phases. Walk the user through each one sequentially.

```
Phase 1: Pre-flight Check       →  Verify project is ready (git, .gitignore, .env, etc.)
Phase 2: Detect & Containerize  →  Analyze project, generate Docker files
Phase 2.5: Docker Validation    →  Validate Docker config before deploying (NEW!)
Phase 3: AWS Setup              →  Ensure CLI configured, provision EC2 + security groups
Phase 4: Deploy                 →  SSH into EC2, clone repo, docker compose up
Phase 5: Domain + HTTPS         →  Optional custom domain, Caddy auto-HTTPS
Phase 6: CI/CD                  →  GitHub Actions workflow for push-to-deploy
Phase 7: Verify                 →  Health check, hand over URL + SSH details
```

---

## Phase 1: Pre-flight Check

**Goal:** Make sure the project is clean, version-controlled, and ready to be deployed.

Read `references/preflight.md` for detailed checks and auto-fix patterns.

### Ask First

Before running any checks, ask the user:
- "Is your project in a GitHub repo already?"
- "Do you have a `.gitignore` and `.env` set up?"

If they confirm everything is good, do a quick verify and move on. Don't lecture them.

### Checks to Run

1. **Git initialized?**
   - Look for `.git/` directory
   - If not: `git init`, help them create a GitHub repo

2. **GitHub remote configured?**
   - `git remote -v` — does it have an origin?
   - If not: walk them through creating a repo on GitHub and adding the remote
   - If the repo is private, note this for Phase 4 (deploy keys needed)

3. **`.gitignore` exists and is correct?**
   - If missing: generate one for their stack (Node, Python, etc.)
   - If exists: verify it includes critical entries:
     - `.env` (MUST be present — secrets should never be committed)
     - `node_modules/` (Node projects)
     - `__pycache__/`, `*.pyc`, `venv/` (Python projects)
     - `.DS_Store` (macOS)
     - `dist/`, `build/` (build outputs — optional, depends on workflow)

4. **`.env` file handling?**
   - If `.env` exists but is NOT in `.gitignore` → add it immediately and warn the user
   - If `.env` exists and IS in `.gitignore` → good
   - If no `.env` exists but the app uses environment variables → create a `.env.example` with placeholder values (no real secrets) for documentation
   - Check git history: has `.env` been committed before? If so, warn the user that secrets may be in git history and suggest they rotate any exposed keys

5. **No secrets in the codebase?**
   - Quick grep for common patterns: API keys, passwords, AWS credentials hardcoded in source files
   - If found: flag them and suggest moving to `.env`

6. **Code pushed to GitHub?**
   - `git status` — are there uncommitted changes?
   - `git log --oneline -1` — has anything been committed?
   - Help them commit and push if needed

### Output

After pre-flight, confirm:
```
✅ Git repo initialized with GitHub remote
✅ .gitignore configured for [stack]
✅ .env secured (in .gitignore, not in git history)
✅ Code pushed to GitHub
```

---

## Phase 2: Detect & Containerize

**Goal:** Generate Docker files for the project, then verify it's actually ready for production.

This phase has two parts: containerization and a deployment readiness check.

Read `references/dockerize.md` for stack-specific Dockerfile templates and patterns.
Read `references/readiness-check.md` for the full readiness scan and auto-fix patterns.

### Ask First

- "Do you already have a Dockerfile?" → If yes, review it and use it
- "Does your app need a database?" → If yes, include Postgres in the compose file

### Part A: Containerize

1. **Detect the stack** by examining the project files:
   - `package.json` → Node.js (check for `next`, `react`, `vue`, `express`, etc.)
   - `requirements.txt` / `pyproject.toml` → Python (check for `flask`, `django`, `fastapi`, etc.)
   - `go.mod` → Go
   - `Cargo.toml` → Rust
   - `index.html` (no framework) → Static site
   - If the user already has a `Dockerfile`, use it. Ask if they want it reviewed.

2. **Generate the Dockerfile** using the appropriate template from `references/dockerize.md`. Use multi-stage builds where applicable to keep images small.

3. **Generate `docker-compose.yml`** with:
   - The app service (built from Dockerfile)
   - Caddy reverse proxy service
   - Shared network
   - Optional: Postgres service if the app needs a database
   - Volume for Caddy data (certificate storage)
   - Volume for Caddy config

4. **Generate `Caddyfile`** — start with the IP-only version:
   ```
   :80 {
       reverse_proxy app:3000
   }
   ```
   This gets upgraded to the domain version in Phase 5 if the user has a domain.

5. **Add Docker-related entries to `.gitignore`** if not already present:
   ```
   # Docker
   docker-compose.override.yml
   ```

6. **Create `.dockerignore`** to keep images small:
   ```
   node_modules
   .git
   .env
   *.md
   .DS_Store
   ```
   Adjust based on the stack.

### Part B: Deployment Readiness Check

Before moving to AWS setup, scan the codebase to catch issues that would break in production. This saves the user from deploying a broken app and debugging over SSH.

Read `references/readiness-check.md` for the full scan patterns and auto-fix templates.

#### Code-Level Checks
1. **Hardcoded localhost / local URLs** — scan source files for `localhost`, `127.0.0.1`, `0.0.0.0` in fetch calls, API URLs, WebSocket connections, CORS origins. These must be replaced with environment variables.
2. **Hardcoded ports** — API calls pointing to specific ports like `:3000`, `:5000`, `:8080` that won't resolve in production.
3. **Debug mode left on** — Django `DEBUG=True`, Flask `debug=True`, `console.log` spam, verbose error pages.

#### Config-Level Checks
4. **Missing production dependencies** — `gunicorn` not in `requirements.txt`, no `start` script in `package.json`, missing `uvicorn` for FastAPI.
5. **Framework-specific production config** — Next.js missing `output: 'standalone'`, Django missing `ALLOWED_HOSTS`, Flask missing production WSGI server.
6. **Environment variable coverage** — are all env vars used in code documented in `.env.example`?

#### Docker-Level Checks
7. **Port consistency** — the port exposed in Dockerfile matches the port in Caddyfile's `reverse_proxy` directive.
8. **Docker Compose build test** — optionally run `docker compose build` to verify the image builds successfully.

#### Output

Present results clearly and offer to auto-fix:

```
🔍 Deployment Readiness Check

⚠️  Hardcoded localhost found:
   - src/api.js:12     →  fetch("http://localhost:3000/api")
   - src/config.js:5   →  CORS_ORIGIN: "http://localhost:3000"
   Fix: Replace with environment variables? (y/n)

⚠️  Missing production dependency:
   - gunicorn not in requirements.txt
   Fix: Add gunicorn to requirements.txt? (y/n)

✅ No debug mode detected
✅ Ports consistent (app:3000 → Caddy reverse_proxy app:3000)
✅ Environment variables documented in .env.example
✅ Docker build succeeds

Fix 2 issues before continuing to AWS setup?
```

After all issues are resolved (or skipped), proceed to Phase 3.

### Part C: Local Test (Optional)

Ask the user if they want to test locally before deploying:
```bash
docker compose up --build
```
This catches build errors before they're debugging over SSH on EC2.

---

## Phase 2.5: Docker Validation (NEW!)

**Goal:** Validate Docker configuration to catch build errors BEFORE deploying to EC2.

Read `references/docker-validation.md` for detailed validation checks and auto-fix patterns.

### Why This Phase Exists

Real-world deployment issues we've encountered:
- ✅ Build context mismatch (Dockerfile COPY paths not in context)
- ✅ Missing TypeScript (--only=production skipped devDependencies needed for build)
- ✅ Missing environment variables (config used vars not in docker-compose.yml)
- ✅ Port mismatches (app listening on different port than Caddy proxies to)

**These would have been caught with validation!**

### Validation Checks

Run these checks automatically after generating Docker files:

**1. Build Context Validation**
- Parse docker-compose.yml to get each service's build context
- Parse Dockerfile to find all COPY/ADD commands
- Verify all COPY source paths exist relative to build context
- **Auto-fix:** Suggest using root context (`.`) for complex projects

**2. Multi-Stage Build Dependencies**
- Check if `npm ci --only=production` is followed by `npm run build`
- Check if package.json has build tools in devDependencies (typescript, vite, webpack)
- **Auto-fix:** Remove `--only=production` flag if build needs devDependencies

**3. Environment Variable Coverage**
- Scan backend config files for env var usage (os.getenv, process.env)
- Compare with docker-compose.yml environment section
- Check .env.example for documented variables
- **Auto-fix:** Add missing env vars to docker-compose.yml with defaults

**4. Port Consistency**
- Find app's listening port (Dockerfile EXPOSE, backend code, docker-compose ports)
- Find Caddyfile reverse_proxy target port
- **Auto-fix:** Flag mismatches, suggest consistent port

**5. Docker Compose Syntax**
- Run `docker compose config` to validate YAML
- **Auto-fix:** Show syntax errors and suggest fixes

**6. Local Build Test (Optional)**
- Offer to run `docker compose build` locally
- Let user decide (takes 5-10 min but catches all build errors)

### Output Format

Present all findings grouped by severity:

```
🔍 Docker Configuration Validation

❌ CRITICAL (must fix):
  • Build context mismatch in frontend service
    - Dockerfile: COPY docker/nginx.conf
    - Context: ./frontend (docker/ not accessible)
    Fix: Change context to "." in docker-compose.yml? (y/n)

⚠️  WARNINGS (recommended):
  • Missing GEMINI_MODEL in docker-compose.yml
    - Backend config.py uses os.getenv('GEMINI_MODEL')
    - Not defined in environment section
    Fix: Add to docker-compose.yml? (y/n)

✅ PASSED:
  • Port consistency verified
  • Docker Compose syntax valid
  • All COPY sources exist

2 critical, 1 warning. Fix now? (y/n)
```

### User Can Skip

If user chooses to skip validation:
```
⚠️  Skipping Docker validation.

If build fails on EC2, you'll need to:
1. Fix the issue locally
2. Commit and push changes
3. SSH to EC2: ssh -i ~/.ssh/key.pem ubuntu@<ip>
4. Rebuild: cd /opt/apps/<name> && git pull && docker compose up -d --build

This can take 10-20 minutes to debug remotely.
Testing locally takes ~5 min but catches errors immediately.

Continue to AWS setup anyway? (y/n)
```

### Benefits

**Time saved:**
- Our deployment: ~30 min debugging Docker issues on EC2
- With validation: ~2 min to catch locally

**Better UX:**
- Catch errors on fast local machine, not slow EC2 SSH
- Understand issues before they're on a live server
- Learn Docker best practices

---

## Phase 3: AWS Setup

**Goal:** Ensure the user has a working AWS CLI and a running EC2 instance.

Read `references/setup-aws.md` for detailed AWS CLI setup instructions and troubleshooting.

### Ask First

Ask these questions up front to skip unnecessary steps:

1. "Do you have an AWS account?" → If no, direct them to create one
2. "Do you have the AWS CLI installed?" → If no, walk them through installation
3. "Have you configured the CLI with credentials?" → Verify with `aws sts get-caller-identity`
4. "Do you already have an EC2 instance you want to use?" → If yes, get the instance ID and skip provisioning

### Steps (skip any the user has already done)

1. **Check AWS CLI**: Run `aws sts get-caller-identity` to verify credentials. If this fails, walk the user through setup (see reference doc).

2. **Important security notes** (mention these once, don't lecture):
   - They should be using an IAM user, NOT root credentials
   - Root account should have MFA enabled
   - Never commit AWS credentials to git
   - If they're using root: strongly suggest creating an IAM user (see reference doc for steps)

3. **Create a key pair** (if the user doesn't have one):
   ```bash
   aws ec2 create-key-pair \
     --key-name deploy-key \
     --query 'KeyMaterial' \
     --output text > ~/.ssh/deploy-key.pem
   chmod 400 ~/.ssh/deploy-key.pem
   ```

4. **Create a security group**:
   ```bash
   aws ec2 create-security-group \
     --group-name web-server-sg \
     --description "Security group for web server"
   ```
   Then open ports: 22 (SSH), 80 (HTTP), 443 (HTTPS).

5. **Launch EC2 instance**:
   - AMI: Ubuntu 24.04 LTS (look up current AMI ID for the user's region)
   - Instance type: `t2.micro` (free tier) — mention `t3.small` if they need more RAM
   - Storage: 20 GB gp3
   - Set `DeleteOnTermination: false` on the EBS volume as a safety net
   - Tag with a name for easy identification

6. **Allocate an Elastic IP** and associate it with the instance:
   ```bash
   aws ec2 allocate-address --domain vpc
   aws ec2 associate-address --instance-id <id> --allocation-id <alloc-id>
   ```

7. **Wait for instance to be running**, then output:
   - Public IP / Elastic IP
   - SSH command: `ssh -i ~/.ssh/deploy-key.pem ubuntu@<ip>`

---

## Phase 4: Deploy

**Goal:** Get the app running on EC2.

Read `references/deploy.md` for the full deployment script and troubleshooting.

### Steps

1. **SSH into the instance** and run the initial setup script:
   - Update packages
   - Install Docker and Docker Compose
   - Install Git
   - Create project directory at `/opt/apps/<project-name>/`
   - Add 2 GB swap space (important for t2.micro)

2. **Clone the repo**:
   ```bash
   cd /opt/apps/<project-name>
   git clone <repo-url> .
   ```
   If the repo is private, help the user set up a deploy key or personal access token.

3. **Set up environment variables**:
   - Ask the user for any required `.env` variables
   - Create `/opt/apps/<project-name>/.env` on the server
   - NEVER commit `.env` to the repo — remind the user
   - For generating secrets: `openssl rand -hex 32`

4. **Build and start**:
   ```bash
   docker compose up -d --build
   ```

5. **Verify** the app is running:
   ```bash
   docker compose ps
   curl -s http://localhost
   ```

---

## Phase 5: Domain + HTTPS

**Goal:** Set up a custom domain with automatic HTTPS, or confirm HTTP-only access via IP.

Read `references/domain-https.md` for Caddy configuration patterns and DNS setup.

### Ask First

- "Do you have a custom domain you want to use?" → If no, skip to the end of this phase
- "Where did you buy your domain?" → Provide registrar-specific DNS instructions

### Steps

1. **DNS configuration**: Tell the user to create an A record pointing to the EC2 Elastic IP:
   ```
   Type: A
   Name: @ (or subdomain like "app")
   Value: <elastic-ip>
   TTL: 300
   ```

2. **Update the Caddyfile** to use the domain:
   ```
   your-domain.com {
       reverse_proxy app:3000
   }
   ```
   Caddy automatically provisions a Let's Encrypt certificate.

3. **Restart Caddy**:
   ```bash
   docker compose restart caddy
   ```

4. **No domain?** The app is already accessible at `http://<elastic-ip>`. Let the user know they can add a domain later by repeating these steps.

---

## Phase 6: CI/CD (Push-to-Deploy)

**Goal:** Set up GitHub Actions so pushing to `main` automatically redeploys.

Read `references/ci-cd.md` for the full workflow file and setup instructions.

### Ask First

- "Do you want automatic deploys when you push to main?" → If no, skip this phase and show them the manual update commands instead

### Steps

1. **Generate `.github/workflows/deploy.yml`** that:
   - Triggers on push to `main`
   - SSHes into the EC2 instance
   - Runs `git pull && docker compose up -d --build`
   - Includes a health check
   - Cleans up old Docker images

2. **Set up GitHub Secrets** — tell the user to add these in their repo settings (Settings > Secrets > Actions):
   - `EC2_HOST`: The Elastic IP
   - `EC2_USER`: `ubuntu`
   - `EC2_SSH_KEY`: Contents of the `.pem` file
   - `APP_NAME`: Project directory name

3. **Test the pipeline**: Have the user make a small change, push to main, and verify the deployment updates.

---

## Phase 7: Verify & Handoff

**Goal:** Confirm everything works and give the user all the info they need.

### Health Check

Verify the app is accessible from outside:
- `curl -s -o /dev/null -w "%{http_code}" http://<ip-or-domain>`
- Should return 200 (or 301/302 if redirecting)

### Output Summary

Present the user with a clean summary:

```
✅ Deployment Complete!

🌐 URL: http://<elastic-ip> (or https://your-domain.com)
🖥️ SSH: ssh -i ~/.ssh/deploy-key.pem ubuntu@<elastic-ip>
📁 App location: /opt/apps/<project-name>/
🔄 Auto-deploy: Push to `main` branch to redeploy

Useful commands:
  docker compose logs -f                              # View logs
  docker compose restart                              # Restart services
  docker compose down && docker compose up -d --build  # Full rebuild

Cost reminder:
  - Free tier: $0/month for 12 months (t2.micro, 750 hrs/month)
  - After free tier: ~$10/month (t2.micro + EBS + Elastic IP)
  - Elastic IP costs ~$3.65/month if instance is STOPPED — release it or keep running
```

---

## Updating an Existing Deployment

If the user has already deployed and wants to update:

1. If CI/CD is set up: "Just push to main!"
2. If no CI/CD: SSH in and run:
   ```bash
   cd /opt/apps/<project-name>
   git pull
   docker compose up -d --build
   ```

---

## Error Handling

Common issues and how to handle them:

- **Port already in use**: `docker compose down` first, then bring back up
- **Out of memory on t2.micro**: Check if swap is active (`free -h`), add swap if not, or suggest upgrading to t3.small
- **Docker build fails**: Check the Dockerfile, ensure all dependencies are listed
- **Can't SSH**: Verify security group has port 22 open, key permissions are 400
- **HTTPS not working**: Ensure DNS has propagated (`dig your-domain.com`), check Caddy logs
- **GitHub Actions failing**: Check secrets are set correctly, SSH key format is right
- **Secrets leaked in git history**: Help user rotate keys, suggest `git filter-branch` or BFG Repo-Cleaner

---

## What This Skill Does NOT Cover

Be upfront with the user if they need:
- **Multiple instances / load balancing** → Suggest ECS or manual ALB setup
- **Serverless** → Suggest Lambda + API Gateway
- **Static site only** → Suggest S3 + CloudFront (much cheaper)
- **Managed database** → Suggest RDS (but note the Postgres-in-Docker option works fine for small scale)
- **Large file storage** → Suggest S3
- **Git workflow / project management** → Out of scope, this skill is deployment only

These are out of scope intentionally. This skill is for simple, single-server deployments.