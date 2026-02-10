# CI/CD Reference

Set up GitHub Actions for automatic deployment on push to main.

## Table of Contents
- [How It Works](#how-it-works)
- [GitHub Actions Workflow](#github-actions-workflow)
- [Setting Up GitHub Secrets](#setting-up-github-secrets)
- [SSH Key for CI/CD](#ssh-key-for-cicd)
- [Testing the Pipeline](#testing-the-pipeline)
- [Advanced: Zero-Downtime Deploy](#advanced-zero-downtime-deploy)
- [Advanced: Branch-Based Deploys](#advanced-branch-based-deploys)
- [Troubleshooting](#troubleshooting)

---

## How It Works

The deployment pipeline is intentionally simple:

1. Developer pushes to `main` branch
2. GitHub Actions triggers
3. Action SSHes into EC2 instance
4. Runs `git pull` + `docker compose up -d --build`
5. App is updated

No container registries, no complex orchestration, no artifact storage. Just SSH and Docker Compose.

---

## GitHub Actions Workflow

Generate this file at `.github/workflows/deploy.yml` in the user's repo:

```yaml
name: Deploy to EC2

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /opt/apps/${{ secrets.APP_NAME }}
            git pull origin main
            docker compose up -d --build
            docker image prune -f
```

The `docker image prune -f` at the end cleans up old images to prevent disk from filling up over time.

### Workflow with health check

For a more robust version that verifies the deploy succeeded:

```yaml
name: Deploy to EC2

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USER }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /opt/apps/${{ secrets.APP_NAME }}
            git pull origin main
            docker compose up -d --build
            docker image prune -f

            # Wait for app to be ready
            echo "Waiting for app to start..."
            sleep 10

            # Health check
            HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost)
            if [ "$HTTP_CODE" -ne 200 ]; then
              echo "Health check failed with status $HTTP_CODE"
              docker compose logs --tail=50
              exit 1
            fi
            echo "Deploy successful! App returned HTTP $HTTP_CODE"
```

---

## Setting Up GitHub Secrets

Tell the user to go to their GitHub repo → Settings → Secrets and variables → Actions → New repository secret.

Add these secrets:

| Secret Name | Value | Example |
|------------|-------|---------|
| `EC2_HOST` | Elastic IP address | `54.123.45.67` |
| `EC2_USER` | SSH username | `ubuntu` |
| `EC2_SSH_KEY` | Contents of the .pem file | (full key text) |
| `APP_NAME` | Project directory name | `my-app` |

### Getting the SSH key contents

The user needs to paste the FULL contents of their `.pem` file, including the header and footer lines:

```bash
cat ~/.ssh/deploy-key.pem
# Copy everything from -----BEGIN RSA PRIVATE KEY----- to -----END RSA PRIVATE KEY-----
```

**Important:** The key must include the `-----BEGIN...-----` and `-----END...-----` lines.

---

## SSH Key for CI/CD

The same key pair used for manual SSH access works for GitHub Actions. However, if the user wants a separate key specifically for CI/CD (better security practice):

### Generate a dedicated deploy key

On the local machine:
```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github-actions-deploy -N ""
```

### Add public key to EC2
```bash
cat ~/.ssh/github-actions-deploy.pub | ssh -i ~/.ssh/deploy-key.pem ubuntu@<ip> "cat >> ~/.ssh/authorized_keys"
```

### Use private key as GitHub Secret
```bash
cat ~/.ssh/github-actions-deploy
# Copy this as the EC2_SSH_KEY secret
```

This way, the main `.pem` key is only on the developer's machine, and the CI/CD key can be rotated independently.

---

## Testing the Pipeline

Walk the user through a test deploy:

1. Make a small visible change (e.g., update a heading or version string)
2. Commit and push to main:
   ```bash
   git add .
   git commit -m "Test CI/CD deploy"
   git push origin main
   ```
3. Go to GitHub repo → Actions tab → Watch the workflow run
4. Once complete, refresh the app in the browser to verify the change

If the workflow fails, click into it to see the logs. Common issues are covered in the troubleshooting section.

---

## Advanced: Zero-Downtime Deploy

The basic workflow has a brief moment of downtime during the rebuild. For most small apps this is fine (a few seconds). If the user needs zero downtime:

```yaml
script: |
  cd /opt/apps/${{ secrets.APP_NAME }}
  git pull origin main
  docker compose build app
  docker compose up -d --no-deps app
  docker image prune -f
```

This builds the new image first, then swaps only the app container. Caddy stays running throughout, so there's minimal interruption.

For true zero-downtime with health checks, you'd need blue-green deployment — but that's overkill for this skill's scope.

---

## Advanced: Branch-Based Deploys

If the user wants to deploy from a specific branch or add manual approval:

### Deploy only on release tags
```yaml
on:
  push:
    tags:
      - 'v*'
```

### Manual deploy trigger
```yaml
on:
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to deploy'
        required: true
        default: 'main'
```

This adds a "Run workflow" button in the Actions tab.

---

## Troubleshooting

### Workflow fails with "Connection refused" or "Connection timed out"
- EC2 instance is not running → `aws ec2 describe-instances`
- Security group doesn't allow SSH from GitHub's IPs → Port 22 must be open to `0.0.0.0/0` for GitHub Actions (GitHub uses dynamic IPs)
- Wrong host in secrets → Verify `EC2_HOST` matches the Elastic IP

### "Permission denied (publickey)"
- SSH key in `EC2_SSH_KEY` secret is wrong or malformed
- Make sure the entire key is copied, including header/footer lines
- Check that the corresponding public key is in `~/.ssh/authorized_keys` on EC2

### "docker: command not found"
- Docker isn't installed or the PATH isn't set for non-interactive SSH sessions
- Fix: Use the full path `/usr/bin/docker` or add `source /etc/profile` at the start of the script

### Build succeeds but app doesn't update
- Docker cache might be serving the old build
- Add `--no-cache` flag: `docker compose build --no-cache app`
- Check `git pull` output — it might say "Already up to date" if the wrong branch is being pulled

### Disk space issues after many deploys
- Old Docker images accumulate over time
- The workflow already includes `docker image prune -f`
- For more aggressive cleanup: `docker system prune -af` (removes ALL unused images, containers, networks)
- Check disk usage: SSH in and run `df -h`
