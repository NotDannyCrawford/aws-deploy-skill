# Pre-flight Check Reference

Detailed checks and auto-fix patterns for preparing a project for deployment.

## Table of Contents
- [Git Initialization](#git-initialization)
- [GitHub Remote Setup](#github-remote-setup)
- [Gitignore by Stack](#gitignore-by-stack)
- [Environment Variable Handling](#environment-variable-handling)
- [Secret Detection](#secret-detection)
- [Commit and Push](#commit-and-push)

---

## Git Initialization

### Check
```bash
# Is this a git repo?
git rev-parse --is-inside-work-tree 2>/dev/null
```

### Fix (if not a git repo)
```bash
git init
git add .
git commit -m "Initial commit"
```

Then help the user create a GitHub repo. Two options:

**Option A: GitHub CLI (if installed)**
```bash
gh repo create <project-name> --private --source=. --push
```

**Option B: Manual**
1. Go to https://github.com/new
2. Create repo (don't initialize with README — the project already has files)
3. Connect and push:
```bash
git remote add origin https://github.com/<username>/<repo>.git
git branch -M main
git push -u origin main
```

---

## GitHub Remote Setup

### Check
```bash
git remote -v
# Should show origin with a GitHub URL
```

### Determine if repo is private
```bash
# If using GitHub CLI
gh repo view --json isPrivate -q '.isPrivate'
```

If the repo is private, flag this for Phase 4 — the EC2 instance will need a deploy key or personal access token to clone it. Make a note and move on; don't solve it now.

---

## Gitignore by Stack

### Check
```bash
# Does .gitignore exist?
test -f .gitignore && echo "exists" || echo "missing"

# Is .env in .gitignore?
grep -q "^\.env$" .gitignore 2>/dev/null && echo ".env is ignored" || echo ".env NOT ignored"
```

### Generate .gitignore by stack

**Node.js / JavaScript / TypeScript:**
```
# Dependencies
node_modules/

# Environment
.env
.env.local
.env.*.local

# Build outputs
dist/
build/
.next/
.nuxt/
.output/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Docker
docker-compose.override.yml
```

**Python:**
```
# Environment
.env
.env.local
venv/
.venv/
env/

# Python
__pycache__/
*.py[cod]
*$py.class
*.so
*.egg-info/
dist/
build/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Docker
docker-compose.override.yml
```

**Go:**
```
# Environment
.env

# Binary
/main
/server
/app

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db

# Docker
docker-compose.override.yml
```

**General / Static:**
```
# Environment
.env

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Docker
docker-compose.override.yml
```

### Fix: Add missing .env entry
```bash
# Add .env to .gitignore if not present
grep -q "^\.env$" .gitignore 2>/dev/null || echo ".env" >> .gitignore
```

---

## Environment Variable Handling

### Check if .env has been committed to git history
```bash
# Check if .env has ever been tracked
git log --all --full-history -- .env
```

If this returns results, the `.env` file (with secrets) is in the git history even if it's now in `.gitignore`. This is a security issue.

### Warning message for the user
If `.env` was previously committed:
```
⚠️  Your .env file was previously committed to git. Even though it's now 
in .gitignore, the old version with secrets is still in your git history.

You should:
1. Rotate ALL secrets that were in that .env file (API keys, passwords, etc.)
2. The old secrets are compromised and should be considered public.
```

For most personal projects, rotating the secrets is sufficient. Don't push the user to rewrite git history unless they ask — it's complex and error-prone.

### Create .env.example
If the project uses environment variables but doesn't have a `.env.example`:

```bash
# Detect env vars used in the codebase
grep -roh 'process\.env\.\w\+' --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" . | sort -u
# or for Python
grep -roh 'os\.environ\[.\+\]' --include="*.py" . | sort -u
grep -roh 'os\.getenv(.\+)' --include="*.py" . | sort -u
```

Generate a `.env.example` with placeholder values:
```
# App Configuration
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@db:5432/dbname

# Secrets (generate with: openssl rand -hex 32)
SECRET_KEY=change-me
JWT_SECRET=change-me

# External APIs
API_KEY=your-api-key-here
```

The `.env.example` SHOULD be committed to git — it documents what environment variables are needed without containing real values.

---

## Secret Detection

### Quick scan for hardcoded secrets
```bash
# AWS keys
grep -rn "AKIA[0-9A-Z]\{16\}" --include="*.js" --include="*.ts" --include="*.py" --include="*.jsx" --include="*.tsx" --include="*.go" .

# Generic API key patterns
grep -rn "api[_-]key\s*[:=]\s*['\"][a-zA-Z0-9]" --include="*.js" --include="*.ts" --include="*.py" --include="*.jsx" --include="*.tsx" --include="*.go" . -i

# Hardcoded passwords
grep -rn "password\s*[:=]\s*['\"][^'\"]\+" --include="*.js" --include="*.ts" --include="*.py" --include="*.jsx" --include="*.tsx" --include="*.go" . -i

# Private keys
grep -rn "BEGIN.*PRIVATE KEY" .
```

### What to do if secrets are found

Don't panic the user. Calmly explain:

1. Move the secret to the `.env` file
2. Replace the hardcoded value with an environment variable reference:
   - Node: `process.env.API_KEY`
   - Python: `os.environ['API_KEY']` or `os.getenv('API_KEY')`
   - Go: `os.Getenv("API_KEY")`
3. If the secret has been committed to git, it should be rotated (get a new key from the provider)

---

## Commit and Push

### Check for uncommitted changes
```bash
# Check status
git status --porcelain

# Check if there's at least one commit
git log --oneline -1 2>/dev/null
```

### Help commit and push
```bash
git add .
git commit -m "Prepare for deployment"
git push -u origin main
```

If push fails:
- **"remote: Repository not found"** → Check the remote URL, user might need to authenticate
- **"rejected: non-fast-forward"** → Repo was initialized on GitHub with a README. Fix: `git pull --rebase origin main` then push again
- **Authentication error** → User may need to set up a GitHub personal access token or SSH key for their local machine

---

## Summary Checklist

After all checks, the project should have:

```
project/
├── .git/                    # Git initialized
├── .gitignore               # Correct for stack, includes .env
├── .env                     # Local only, NOT in git
├── .env.example             # Committed, documents required vars
├── (project files)          # All committed and pushed
└── (no hardcoded secrets)   # Secrets in .env only
```
