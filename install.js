#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

console.log('\n🚀 Installing AWS Deploy Skill for Claude Code...\n');

// Determine Claude skills directory based on OS
const homeDir = os.homedir();
const isWindows = os.platform() === 'win32';
const claudeSkillsDir = path.join(homeDir, '.claude', 'skills', 'aws-deploy');

// Ensure .claude/skills directory exists
const skillsBaseDir = path.join(homeDir, '.claude', 'skills');
if (!fs.existsSync(skillsBaseDir)) {
  console.log('📁 Creating .claude/skills directory...');
  fs.mkdirSync(skillsBaseDir, { recursive: true });
}

// Check if skill already exists
if (fs.existsSync(claudeSkillsDir)) {
  console.log('⚠️  AWS Deploy Skill already exists at:', claudeSkillsDir);
  console.log('   To reinstall, remove the directory first:\n');
  if (isWindows) {
    console.log('   rmdir /s /q "%USERPROFILE%\\.claude\\skills\\aws-deploy"');
  } else {
    console.log('   rm -rf ~/.claude/skills/aws-deploy');
  }
  console.log('\n   Then run the install command again.\n');
  process.exit(0);
}

try {
  // Clone the repository
  console.log('📦 Cloning skill from GitHub...');
  execSync(
    `git clone https://github.com/NotDannyCrawford/aws-deploy-skill.git "${claudeSkillsDir}"`,
    { stdio: 'inherit' }
  );

  // Remove .git directory to clean up
  const gitDir = path.join(claudeSkillsDir, '.git');
  if (fs.existsSync(gitDir)) {
    console.log('🧹 Cleaning up...');
    if (isWindows) {
      execSync(`rmdir /s /q "${gitDir}"`, { stdio: 'ignore' });
    } else {
      execSync(`rm -rf "${gitDir}"`, { stdio: 'ignore' });
    }
  }

  console.log('\n✅ AWS Deploy Skill installed successfully!\n');
  console.log('📍 Location:', claudeSkillsDir);
  console.log('\n🎯 Usage:');
  console.log('   1. Navigate to your project: cd ~/my-project');
  console.log('   2. Start Claude Code: claude-code');
  console.log('   3. Say: "Deploy this to AWS"\n');
  console.log('📖 Documentation: https://github.com/NotDannyCrawford/aws-deploy-skill#readme\n');

} catch (error) {
  console.error('\n❌ Installation failed:', error.message);
  console.error('\nTry manual installation instead:');
  console.error('   git clone https://github.com/NotDannyCrawford/aws-deploy-skill.git ~/.claude/skills/aws-deploy\n');
  process.exit(1);
}
