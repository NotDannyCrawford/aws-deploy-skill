# Git Authentication Reference

**Purpose:** Set up git authentication on EC2 so the instance can clone private repos and pull updates without manual token entry.

## Why This Matters

In our deployment, we had to manually paste the GitHub token multiple times:
```bash
git clone https://TOKEN@github.com/user/repo.git
git pull https://TOKEN@github.com/user/repo.git main
```

This is:
- ❌ Annoying (paste token every time)
- ❌ Insecure (token appears in bash history)
- ❌ Breaks CI/CD (can't auto-deploy)

**With proper auth setup:**
- ✅ Clone once, pull forever
- ✅ Token stored securely
- ✅ CI/CD works automatically

---

## Detection

**When to set up auth:** If repo is private.

**Check if repo is private:**
```bash
# Try cloning without auth
git ls-remote https://github.com/user/repo.git HEAD 2>&1

# Exit code 0 = public
# Exit code 128 = private (auth required)
```

---

## Option 1: GitHub Deploy Keys (Recommended for CD)

**Best for:** Production deployments with CI/CD

**Pros:**
- ✅ Most secure (read-only access to single repo)
- ✅ No expiration
- ✅ Easy to revoke per-server
- ✅ Works with GitHub Actions

**Cons:**
- ⚠️ Requires SSH (not HTTPS)
- ⚠️ One key per repo (can't reuse)

### Setup Steps

**1. Generate SSH key on EC2:**
```bash
ssh-keygen -t ed25519 -C "deploy@ocaml-app" -f ~/.ssh/github_deploy_key -N ""
```

**2. Add public key to GitHub:**
```bash
# Show public key
cat ~/.ssh/github_deploy_key.pub
```

Then:
1. Go to GitHub repo → Settings → Deploy keys → Add deploy key
2. Paste the public key
3. Title: "EC2 Production Server"
4. ✅ Allow write access (if you need push, usually not needed)

**3. Configure git to use the key:**
```bash
# Add to ~/.ssh/config
cat >> ~/.ssh/config << 'EOF'
Host github.com-deploy
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_deploy_key
    StrictHostKeyChecking no
EOF
```

**4. Clone using SSH:**
```bash
git clone git@github.com-deploy:user/repo.git /opt/apps/project-name
```

**5. Test:**
```bash
cd /opt/apps/project-name
git pull  # Should work without password!
```

---

## Option 2: Personal Access Token (Faster Setup)

**Best for:** Quick MVP/testing deployments

**Pros:**
- ✅ Fast to set up
- ✅ Works with HTTPS (simpler)
- ✅ Can access multiple repos

**Cons:**
- ⚠️ Token expiration (need to update)
- ⚠️ More powerful (repo-level access)
- ⚠️ Stored in plaintext on server

### Setup Steps

**1. Create token on GitHub:**
1. GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic)
2. Generate new token (classic)
3. Select scopes: `repo` (full control of private repositories)
4. Generate token
5. **Copy immediately** (won't be shown again!)

**2. Configure git credential helper:**
```bash
# Store credentials permanently
git config --global credential.helper store

# First time: clone with token
git clone https://TOKEN@github.com/user/repo.git /opt/apps/project-name

# Credential is now cached
cd /opt/apps/project-name
git remote set-url origin https://github.com/user/repo.git  # Remove token from URL

# Test
git pull  # Should work without password!
```

**Where is it stored?**
```bash
cat ~/.git-credentials
# https://USERNAME:TOKEN@github.com
```

**Security note:** The token is stored in plaintext in `~/.git-credentials`. This is fine for a dedicated deployment server, but don't use this on shared/multi-user systems.

---

## Option 3: GitHub CLI (gh auth)

**Best for:** Interactive setup, multiple repos

**Pros:**
- ✅ Secure OAuth flow
- ✅ Manages token automatically
- ✅ Works with all gh commands

**Cons:**
- ⚠️ Requires browser or token
- ⚠️ Extra dependency

### Setup Steps

**1. Install gh CLI:**
```bash
# Ubuntu/Debian
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt install gh
```

**2. Authenticate:**
```bash
# Using token (non-interactive)
echo "ghp_YOUR_TOKEN" | gh auth login --with-token

# Or interactive (requires browser)
gh auth login
```

**3. Clone repo:**
```bash
gh repo clone user/repo /opt/apps/project-name
```

**4. Regular git commands now work:**
```bash
cd /opt/apps/project-name
git pull  # Authenticated via gh!
```

---

## Comparison

| Method | Security | Setup Time | Best For |
|--------|----------|------------|----------|
| **Deploy Keys (SSH)** | 🟢 High | 5 min | Production, CI/CD |
| **PAT (HTTPS)** | 🟡 Medium | 2 min | MVP, quick deploy |
| **gh CLI** | 🟢 High | 3 min | Multi-repo, interactive |

---

## Recommendation by Use Case

**Production app with CI/CD:**
→ Use Deploy Keys (SSH)

**Quick MVP or personal project:**
→ Use Personal Access Token (HTTPS)

**Working with multiple repos:**
→ Use gh CLI

---

## Testing Authentication

After setup, verify it works:

```bash
cd /opt/apps/project-name

# Test 1: Pull works
git pull
# Should succeed without password prompt

# Test 2: Check remote
git remote -v
# Should show SSH (git@github.com) or HTTPS (https://github.com)

# Test 3: Fetch works
git fetch origin
# Should succeed

# Test 4: CI/CD simulation
cd /tmp
rm -rf test-clone
git clone $(git -C /opt/apps/project-name remote get-url origin) test-clone
# Should clone without password
```

---

## Troubleshooting

### "Permission denied (publickey)"
- Deploy key not added to GitHub
- Wrong SSH key being used
- Check: `ssh -T git@github.com`

### "Authentication failed" (HTTPS)
- Token expired or invalid
- Check: `cat ~/.git-credentials`
- Regenerate token on GitHub

### "fatal: could not read Username"
- Credential helper not configured
- Run: `git config --global credential.helper store`

---

## Security Best Practices

1. **Use deploy keys for production** (not personal tokens)
2. **Rotate tokens regularly** (set expiration, create new)
3. **Revoke compromised credentials immediately**
4. **Use read-only deploy keys** when possible
5. **Don't commit tokens to git** (check with `git log --all -S 'ghp_'`)

---

## Integration with Deployment

**When to set up:** Phase 4 (Deploy), step 2 (Clone repo)

**Workflow:**
```
1. Detect if repo is private
   ↓
2. Ask user: "Use deploy keys or personal token?"
   ↓
3. Set up chosen auth method
   ↓
4. Clone repo
   ↓
5. Verify: `git pull` works
```

**Skip if:**
- Repo is public (no auth needed)
- User already set up auth (check `git pull` works)
