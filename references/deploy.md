# Deploy Reference

Full deployment procedure: SSH setup, server provisioning, and app deployment.

## Table of Contents
- [Server Setup Script](#server-setup-script)
- [Private Repos](#private-repos)
- [Environment Variables](#environment-variables)
- [Deploying the App](#deploying-the-app)
- [Adding Swap Space](#adding-swap-space)
- [Verifying Deployment](#verifying-deployment)
- [Manual Update Procedure](#manual-update-procedure)
- [Troubleshooting](#troubleshooting)

---

## Server Setup Script

After SSHing into the EC2 instance, run this setup. You can either walk the user through each command or generate a single setup script.

### Option A: Generate a setup script

Create a file called `setup.sh` and SCP it to the server, or paste it inline via SSH:

```bash
#!/bin/bash
set -euo pipefail

echo "=== Updating system ==="
sudo apt-get update && sudo apt-get upgrade -y

echo "=== Installing Docker ==="
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "=== Adding ubuntu user to docker group ==="
sudo usermod -aG docker ubuntu

echo "=== Installing Git ==="
sudo apt-get install -y git

echo "=== Creating app directory ==="
sudo mkdir -p /opt/apps
sudo chown ubuntu:ubuntu /opt/apps

echo "=== Adding swap space (recommended for t2.micro) ==="
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

echo "=== Setup complete! ==="
echo "Log out and back in for docker group to take effect."
echo "  exit"
echo "  ssh -i ~/.ssh/deploy-key.pem ubuntu@<ip>"
```

### Option B: Run commands inline via SSH

For users who prefer to see each step. SSH in and run the commands from the script above one block at a time.

### Important: Re-login after setup

After adding the user to the docker group, the user MUST log out and log back in for the group membership to take effect. Otherwise `docker` commands will require `sudo`.

---

## Private Repos

If the user's GitHub repo is private, they need a way for the EC2 instance to pull it.

### Option 1: Deploy Key (recommended)

On the EC2 instance:
```bash
ssh-keygen -t ed25519 -C "deploy-key" -f ~/.ssh/github-deploy -N ""
cat ~/.ssh/github-deploy.pub
```

Then tell the user to:
1. Go to their GitHub repo → Settings → Deploy keys → Add deploy key
2. Paste the public key
3. Check "Allow write access" only if needed (usually not)

Configure SSH on the EC2 instance to use this key for GitHub:
```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
    IdentityFile ~/.ssh/github-deploy
    StrictHostKeyChecking no
EOF
```

Clone using SSH URL:
```bash
git clone git@github.com:username/repo.git /opt/apps/project-name
```

### Option 2: Personal Access Token

If the user prefers HTTPS:
1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens
2. Create a token with read access to the specific repo
3. Clone using the token:
```bash
git clone https://<token>@github.com/username/repo.git /opt/apps/project-name
```

**Note:** The token will be stored in the git remote URL. This is fine for a private server but not ideal. Deploy keys are cleaner.

---

## Environment Variables

### Creating the .env file

On the EC2 instance:
```bash
nano /opt/apps/<project-name>/.env
```

Or pipe it in via SSH from the local machine:
```bash
ssh -i ~/.ssh/deploy-key.pem ubuntu@<ip> "cat > /opt/apps/<project-name>/.env" << 'EOF'
DATABASE_URL=postgresql://postgres:secretpassword@db:5432/app
SECRET_KEY=your-secret-key-here
NODE_ENV=production
EOF
```

### Security reminders
- NEVER commit `.env` to git
- Ensure `.env` is in `.gitignore`
- Use strong, random passwords for database credentials
- For generating a random secret: `openssl rand -hex 32`

---

## Deploying the App

Once the server is set up and the repo is cloned:

```bash
cd /opt/apps/<project-name>

# Build and start
docker compose up -d --build
```

First build will take a few minutes as it downloads base images and installs dependencies. Subsequent builds are much faster due to Docker layer caching.

### Watching the build
```bash
docker compose up --build  # Without -d to see output in real time
# Ctrl+C when satisfied, then:
docker compose up -d        # Run in background
```

### Checking status
```bash
docker compose ps           # Show running containers
docker compose logs -f      # Follow all logs
docker compose logs -f app  # Follow only app logs
```

---

## Adding Swap Space

The t2.micro instance has only 1 GB RAM. Adding swap prevents out-of-memory crashes during Docker builds or under load.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

This is included in the setup script above, but if the user skipped it:
```bash
free -h  # Check current memory + swap
```

---

## Verifying Deployment

### From the EC2 instance
```bash
# Check containers are running
docker compose ps

# Check app is responding locally
curl -s http://localhost

# Check specific health endpoint if the app has one
curl -s http://localhost/api/health
```

### From outside (local machine)
```bash
# Check HTTP
curl -s -o /dev/null -w "%{http_code}" http://<elastic-ip>

# Should return 200 (or 301/302 if redirecting to HTTPS)
```

### If something is wrong
```bash
# Check container logs
docker compose logs app
docker compose logs caddy

# Check if ports are actually open
sudo ss -tlnp | grep -E ':(80|443|3000)'

# Check Docker is running
sudo systemctl status docker

# Restart everything
docker compose down
docker compose up -d --build
```

---

## Manual Update Procedure

When the user wants to update their deployed app without CI/CD:

```bash
ssh -i ~/.ssh/deploy-key.pem ubuntu@<elastic-ip>
cd /opt/apps/<project-name>
git pull
docker compose up -d --build
```

If there are database migrations:
```bash
# For Django
docker compose exec app python manage.py migrate

# For Node with Prisma
docker compose exec app npx prisma migrate deploy

# For any ORM - check the specific migration command
```

If the user changed the Dockerfile significantly:
```bash
docker compose down
docker compose up -d --build --force-recreate
```

To clean up old Docker images (saves disk space):
```bash
docker image prune -f
docker system prune -f  # More aggressive cleanup
```

---

## Troubleshooting

### Container won't start
```bash
docker compose logs app  # Check for error messages
docker compose logs caddy
```

Common causes:
- Missing environment variables → Check `.env` file
- Port conflict → Another container or process is using the port
- Build error → Check Dockerfile, ensure dependencies are correct

### Out of memory
```bash
free -h              # Check memory
docker stats         # Check per-container memory usage
```

Solutions:
- Add swap if not already done (see above)
- Reduce worker count in gunicorn/uvicorn (set to 1)
- Upgrade to t3.small (~$15/month, 2 GB RAM)

### Can't SSH
- Verify security group has port 22 open
- Check key permissions: `chmod 400 ~/.ssh/deploy-key.pem`
- Verify you're using the right username: `ubuntu` for Ubuntu AMIs
- Check instance is running: `aws ec2 describe-instances --instance-ids <id>`

### App accessible locally but not externally
- Security group likely missing port 80/443 rules
- Check: `aws ec2 describe-security-groups --group-ids <sg-id>`

### Docker build is slow
First build downloads base images and installs all dependencies — this is normal. Subsequent builds should be fast due to layer caching.

If builds are consistently slow:
- Check available disk space: `df -h`
- Clean old images: `docker system prune -f`
- Check if swap is active: `free -h`
