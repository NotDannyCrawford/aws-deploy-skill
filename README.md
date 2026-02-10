# AWS Deploy Skill for Claude Code

Deploy any web project to AWS EC2 with Docker, automatic HTTPS, and push-to-deploy CI/CD in minutes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude-Code-blue)](https://code.claude.com)

## What This Skill Does

This skill automates the deployment of web applications to AWS EC2 using a simple, single-server Docker setup. Perfect for MVPs, personal projects, and small business apps.

**Features:**
- ✅ Automated Docker containerization for any stack (Node.js, Python, Go, etc.)
- ✅ EC2 instance provisioning with security groups and Elastic IP
- ✅ Automatic HTTPS with Caddy (Let's Encrypt)
- ✅ **NEW: Docker validation catches errors before deploying**
- ✅ GitHub Actions CI/CD for push-to-deploy
- ✅ Built-in troubleshooting and error recovery

**Cost:** $0-10/month (free tier eligible for 12 months)

---

## What's New in v2.0 🎉

We've significantly improved the deployment experience based on real-world usage:

### **1. Docker Validation (Phase 2.5)**

**Before:** Errors found on EC2 after 10-20 minutes
**After:** Errors caught locally in 2 minutes

The skill now validates:
- ✅ **Build context mismatches** - Dockerfile COPY paths must exist in docker-compose context
- ✅ **Missing build dependencies** - Catches `--only-production` blocking TypeScript builds
- ✅ **Environment variable coverage** - Ensures all env vars are in docker-compose.yml
- ✅ **Port consistency** - Verifies app ports match Caddy proxy configuration
- ✅ **Docker Compose syntax** - Validates YAML before deployment

Each issue gets an **auto-fix offer** with explanation!

### **2. Enhanced Git Authentication**

**Before:** Manually paste token 3+ times
**After:** One-time setup, automatic pulls forever

Three authentication methods:
- 🔐 **Deploy Keys (SSH)** - Most secure, best for production
- 🔑 **Personal Access Token** - Quick setup, good for MVPs
- 🛠️ **GitHub CLI** - Best for multiple repos

### **3. Better Error Messages**

Clear explanations of what went wrong and how to fix it, with visual diagrams showing the problem.

---

## Installation

### Option 1: npm (Recommended)

```bash
npx @notdannycrawford/aws-deploy-skill
```

This automatically installs the skill to your Claude Code skills directory.

### Option 2: Manual Installation

```bash
# Clone the skill into your Claude skills directory
git clone https://github.com/NotDannyCrawford/aws-deploy-skill.git ~/.claude/skills/aws-deploy
```

Or download and extract to:
- **macOS/Linux:** `~/.claude/skills/aws-deploy/`
- **Windows:** `%USERPROFILE%\.claude\skills\aws-deploy\`

---

## Usage

In any project with Claude Code:

```bash
claude-code
```

Then just tell Claude:
- "Deploy this to AWS"
- "Make this live"
- "Set up AWS deployment"
- "Host this on EC2"

The skill will guide you through:
1. Pre-flight checks (git, .env, secrets)
2. Docker containerization
3. **Docker validation** ← NEW!
4. AWS setup (EC2, security groups, Elastic IP)
5. Deployment
6. Optional: Domain + HTTPS
7. Optional: CI/CD with GitHub Actions

---

## Example Deployment

Here's what happened during a real deployment:

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

  • Frontend build uses --only=production but needs TypeScript
    - npm ci --only=production skips devDependencies
    - But package.json has typescript as devDependency
    Fix: Remove --only=production flag? (y/n)

✅ PASSED:
  • Port consistency verified
  • Docker Compose syntax valid

3 issues found. Fix now? (y/n)
```

**Result:** All issues caught and fixed locally before deploying!

---

## Deployment Flow

```
Phase 1: Pre-flight Check
├─ Verify git repository
├─ Check .gitignore (ensure .env is ignored)
└─ Scan for hardcoded secrets

Phase 2: Containerize
├─ Detect stack (Node, Python, Go, etc.)
├─ Generate Dockerfile (multi-stage, optimized)
├─ Generate docker-compose.yml
└─ Generate Caddyfile (reverse proxy)

Phase 2.5: Docker Validation ✨ NEW!
├─ Validate build contexts
├─ Check build dependencies
├─ Verify environment variables
├─ Check port consistency
├─ Validate Docker Compose syntax
└─ Optional: Local build test

Phase 3: AWS Setup
├─ Configure AWS CLI
├─ Create SSH key pair
├─ Launch EC2 instance (t2.micro, free tier)
├─ Create security group (ports 22, 80, 443)
└─ Allocate Elastic IP

Phase 4: Deploy
├─ SSH into EC2
├─ Install Docker + dependencies
├─ Set up Git authentication
├─ Clone repository
├─ Configure .env
├─ Build and start containers
└─ Verify health

Phase 5: Domain + HTTPS (Optional)
├─ Configure DNS (A record)
├─ Update Caddyfile with domain
└─ Caddy auto-provisions SSL certificate

Phase 6: CI/CD (Optional)
├─ Generate GitHub Actions workflow
├─ Set up secrets
└─ Test auto-deploy on push

Phase 7: Verify
├─ Health check
├─ Test from public internet
└─ Provide SSH details and commands
```

---

## Supported Stacks

**Frontend:**
- Next.js
- React (Vite, Create React App)
- Vue.js
- Svelte
- Angular
- Static HTML

**Backend:**
- Node.js (Express, Fastify, Nest.js)
- Python (Flask, Django, FastAPI)
- Go
- Rust

**Databases:**
- PostgreSQL (included in Docker Compose)
- Or use AWS RDS (suggested for production)

---

## What This Skill Does NOT Cover

This skill is intentionally simple (single-server deployments). For advanced needs:

- ❌ **Multiple instances / load balancing** → Use AWS ECS or ALB
- ❌ **Serverless** → Use AWS Lambda + API Gateway
- ❌ **Static sites only** → Use S3 + CloudFront (cheaper)
- ❌ **Managed databases at scale** → Use AWS RDS
- ❌ **Large file storage** → Use S3

The philosophy: Start simple, scale later when needed.

---

## Real-World Example

**Project:** OCaml Learning Companion (Flask + React + PostgreSQL)

**Before validation:**
- Build failed on EC2 after 15 minutes
- Debugging over SSH was slow
- Fixed 3 issues over 30 minutes

**After validation:**
- All 3 issues caught locally in 2 minutes
- Fixed with auto-suggestions
- Deployed successfully on first try

**Time saved:** 28 minutes per deployment

---

## Architecture

Your deployed app will look like this:

```
                Internet
                   │
                   ▼
            ┌─────────────┐
            │   Caddy     │ :80, :443
            │ (Reverse    │ (Auto HTTPS)
            │  Proxy)     │
            └──────┬──────┘
                   │
        ┏━━━━━━━━━┻━━━━━━━━━┓
        ▼                    ▼
   ┌─────────┐         ┌─────────┐
   │ Backend │         │Frontend │
   │ (Docker)│         │(Docker) │
   │  :5000  │         │  :80    │
   └────┬────┘         └─────────┘
        │
        ▼
   ┌─────────┐
   │Postgres │
   │(Docker) │
   │  :5432  │
   └─────────┘

All running on a single EC2 t2.micro instance
```

---

## Cost Breakdown

**Free tier (first 12 months):**
- t2.micro EC2: $0/month (750 hours/month included)
- 20 GB storage: $0/month (30 GB included)
- Elastic IP: $0/month (when instance is running)
- **Total: $0/month**

**After free tier:**
- t2.micro EC2: ~$8/month
- 20 GB gp3 storage: ~$2/month
- Elastic IP: $0 (running) or $3.65/month (if stopped)
- Data transfer: ~$1/month
- **Total: ~$10-15/month**

---

## Troubleshooting

The skill includes built-in troubleshooting for common issues:

| Issue | Detection | Solution |
|-------|-----------|----------|
| Build context mismatch | ✅ Validation | Auto-fix: suggest root context |
| Missing TypeScript | ✅ Validation | Auto-fix: remove --only-production |
| Missing env vars | ✅ Validation | Auto-fix: add to docker-compose.yml |
| Port mismatch | ✅ Validation | Auto-fix: suggest consistent ports |
| Out of memory | ⚠️ Runtime | Add swap space (automated) |
| Git auth fails | ⚠️ Runtime | Setup deploy keys (guided) |
| Docker build fails | ✅ Validation | Test locally before EC2 |
| HTTPS not working | ⚠️ Runtime | Check DNS propagation |

---

## Security Best Practices

The skill follows security best practices:

✅ Never commits secrets to git
✅ Uses IAM users (not root credentials)
✅ SSH keys with proper permissions (chmod 400)
✅ Security groups with minimal open ports
✅ EBS volumes with DeleteOnTermination: false
✅ Environment variables in .env (gitignored)
✅ Deploy keys for production (read-only)

---

## Contributing

Found a bug or have a suggestion? Open an issue or PR!

**Areas for contribution:**
- Additional stack support (Ruby, PHP, etc.)
- More validation checks
- Database migration strategies
- Monitoring/alerting setup
- Multi-region deployments

---

## Real-World Success Stories

> "Deployed my Flask + React app in 15 minutes. The Docker validation caught 3 issues I would have spent an hour debugging on EC2." - OCaml Learning Project

> "The auto-fix suggestions taught me Docker best practices while deploying." - First-time AWS user

---

## Comparison with Alternatives

| Method | Time to Deploy | Cost | Complexity | This Skill |
|--------|---------------|------|------------|------------|
| AWS Elastic Beanstalk | 20-30 min | $20-50/mo | Medium | ❌ |
| Heroku | 10 min | $25+/mo | Low | ❌ |
| Railway | 5 min | $10+/mo | Low | ❌ |
| AWS ECS/Fargate | 1-2 hours | $30-100/mo | High | ❌ |
| **This Skill** | **15 min** | **$0-10/mo** | **Low** | **✅** |

---

## FAQ

**Q: Can I use this for production?**
A: Yes! It's production-ready for small-medium traffic. For high traffic, consider scaling to ECS or adding a load balancer.

**Q: What if I need multiple servers?**
A: This skill is single-server. For multiple servers, you'll need to set up a load balancer manually or use AWS ECS.

**Q: Can I use RDS instead of Docker Postgres?**
A: Yes! The skill can be adapted to use RDS. Ask Claude to modify the setup for RDS.

**Q: Does this work with monorepos?**
A: Yes, but you may need to adjust the build contexts. The validation will catch any issues.

**Q: Can I deploy to an existing EC2 instance?**
A: Yes! The skill detects if you already have an instance and can deploy to it.

---

## License

MIT License - feel free to use and modify!

---

## Credits

Created by the Claude Code community. Improved based on real-world deployments and user feedback.

**Special thanks to:**
- Users who reported deployment issues
- Contributors who suggested improvements
- The Claude Code team for the amazing platform

---

## Support

- 📖 Documentation: This README + references/ folder
- 💬 Questions: Open an issue
- 🐛 Bug reports: Open an issue with reproduction steps
- 💡 Feature requests: Open an issue with use case

---

## Changelog

### v2.0 (2026-02-10)
- ✨ Added Docker validation phase (catches errors before EC2)
- ✨ Added git authentication guide
- ✨ Auto-fix suggestions for common issues
- ✨ Better error messages with visual diagrams
- 🐛 Fixed build context issues
- 🐛 Fixed environment variable coverage
- 📚 Comprehensive documentation

### v1.0 (Initial Release)
- Basic 7-phase deployment workflow
- Support for Node.js, Python, Go
- Docker Compose generation
- EC2 provisioning
- Caddy reverse proxy
- Optional domain + HTTPS
- Optional GitHub Actions CI/CD

---

Made with ❤️ by the Claude Code community
