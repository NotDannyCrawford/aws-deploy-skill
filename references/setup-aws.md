# AWS Setup Reference

Guide for getting the user's AWS CLI configured and ready for deployment.

## Table of Contents
- [Account Creation (Manual)](#account-creation-manual)
- [IAM User Setup (Manual)](#iam-user-setup-manual)
- [AWS CLI Installation](#aws-cli-installation)
- [AWS CLI Configuration](#aws-cli-configuration)
- [Verifying Setup](#verifying-setup)
- [Region Selection](#region-selection)
- [AMI Lookup](#ami-lookup)
- [EC2 Launch Commands](#ec2-launch-commands)
- [Security Group Setup](#security-group-setup)
- [Elastic IP](#elastic-ip)
- [Cost Awareness](#cost-awareness)

---

## Account Creation (Manual)

The user MUST do this in a browser. Direct them to:

1. Go to https://aws.amazon.com/ and click "Create an AWS Account"
2. Provide email, password, account name
3. Enter payment information (required even for free tier)
4. Verify phone number
5. Select the "Basic Support - Free" plan

**Important:** Let the user know that the free tier includes 750 hours/month of t2.micro for 12 months. If they already had an AWS account, the free tier may have expired.

---

## IAM User Setup (Manual)

The user needs to create an IAM user to get CLI credentials. This must be done in the AWS Console:

1. Sign into AWS Console at https://console.aws.amazon.com/
2. Search for "IAM" in the top search bar
3. Click "Users" in the left sidebar → "Create user"
4. Username: `deployer` (or whatever they prefer)
5. Check "Provide user access to the AWS Management Console" (optional)
6. Click "Attach policies directly" and add:
   - `AmazonEC2FullAccess`
   - `AmazonVPCFullAccess`
7. Click through to create the user
8. Go to the user → "Security credentials" tab → "Create access key"
9. Select "Command Line Interface (CLI)" as the use case
10. Copy the **Access Key ID** and **Secret Access Key** — they won't be able to see the secret again

Tell the user to save these credentials securely. They'll need them for the CLI configuration.

---

## AWS CLI Installation

### macOS
```bash
# Using Homebrew (recommended)
brew install awscli

# Or official installer
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

### Linux
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

### Windows
```
Download and run: https://awscli.amazonaws.com/AWSCLIV2.msi
```

### Verify installation
```bash
aws --version
# Should output something like: aws-cli/2.x.x Python/3.x.x ...
```

---

## AWS CLI Configuration

```bash
aws configure
```

This will prompt for:
- **AWS Access Key ID**: From IAM user setup
- **AWS Secret Access Key**: From IAM user setup
- **Default region name**: See region selection below
- **Default output format**: `json` (recommended)

---

## Verifying Setup

Run this to confirm everything works:
```bash
aws sts get-caller-identity
```

Expected output:
```json
{
    "UserId": "AIDA...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/deployer"
}
```

If this fails:
- "Unable to locate credentials" → Run `aws configure` again
- "InvalidClientTokenId" → Access key is wrong, regenerate in IAM console
- "SignatureDoesNotMatch" → Secret key is wrong, regenerate in IAM console

---

## Region Selection

Ask the user where most of their users will be. Recommend the closest region:

| Location | Region Code | Region Name |
|----------|-------------|-------------|
| US East Coast | `us-east-1` | N. Virginia (cheapest, most services) |
| US West Coast | `us-west-2` | Oregon |
| Europe | `eu-west-1` | Ireland |
| UK | `eu-west-2` | London |
| Asia Pacific | `ap-southeast-1` | Singapore |
| Japan | `ap-northeast-1` | Tokyo |
| Australia | `ap-southeast-2` | Sydney |
| India | `ap-south-1` | Mumbai |

**Default recommendation:** `us-east-1` — it's the cheapest, has the most services, and has the best free tier coverage. Use this unless the user has a specific reason to pick another region.

---

## AMI Lookup

To find the latest Ubuntu 24.04 LTS AMI for the user's region:

```bash
aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text
```

This returns the most recent Ubuntu 24.04 AMI ID. Store this for the launch command.

---

## EC2 Launch Commands

### Full launch sequence

```bash
# 1. Look up AMI
AMI_ID=$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text)

# 2. Create key pair (skip if user has one)
aws ec2 create-key-pair \
  --key-name deploy-key \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/deploy-key.pem
chmod 400 ~/.ssh/deploy-key.pem

# 3. Create security group
SG_ID=$(aws ec2 create-security-group \
  --group-name web-server-sg \
  --description "Web server security group" \
  --query 'GroupId' \
  --output text)

# 4. Open ports
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0

# 5. Launch instance
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --key-name deploy-key \
  --security-group-ids $SG_ID \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":false}}]' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=my-app-server}]" \
  --query 'Instances[0].InstanceId' \
  --output text)

# 6. Wait for it to be running
aws ec2 wait instance-running --instance-ids $INSTANCE_ID

# 7. Allocate and associate Elastic IP
ALLOC_ID=$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)
ELASTIC_IP=$(aws ec2 describe-addresses --allocation-ids $ALLOC_ID --query 'Addresses[0].PublicIp' --output text)
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $ALLOC_ID

echo "Instance ID: $INSTANCE_ID"
echo "Elastic IP: $ELASTIC_IP"
echo "SSH command: ssh -i ~/.ssh/deploy-key.pem ubuntu@$ELASTIC_IP"
```

### Important notes
- The `--block-device-mappings` sets `DeleteOnTermination: false` so the EBS volume survives if the instance is accidentally terminated
- The tag `Name=my-app-server` makes it easy to identify in the console — replace with the project name
- `aws ec2 wait instance-running` blocks until the instance is ready (usually 30-60 seconds)

---

## Security Group Setup

The security group opens these ports:

| Port | Protocol | Purpose | Source |
|------|----------|---------|--------|
| 22 | TCP | SSH | `0.0.0.0/0` (consider restricting to user's IP for security) |
| 80 | TCP | HTTP | `0.0.0.0/0` |
| 443 | TCP | HTTPS | `0.0.0.0/0` |

**Security note:** Opening SSH to `0.0.0.0/0` is convenient but not ideal. For better security, the user can restrict port 22 to their own IP:
```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr $MY_IP/32
```

However, this means they'll need to update the rule if their IP changes. For a personal project, `0.0.0.0/0` with key-based auth is fine.

---

## Elastic IP

An Elastic IP is a static public IP that persists across instance stops/starts. Without one, the public IP changes every time the instance reboots.

**Cost:** Elastic IPs are free while associated with a running instance. They cost ~$3.65/month if allocated but NOT associated (i.e., the instance is stopped). If the user stops their instance, remind them to either release the Elastic IP or be aware of the charge.

To release an Elastic IP:
```bash
aws ec2 release-address --allocation-id <alloc-id>
```

---

## Cost Awareness

Be upfront with the user about costs:

### Free Tier (first 12 months)
- t2.micro: 750 hours/month (enough for 1 instance 24/7)
- EBS: 30 GB of gp2/gp3
- Data transfer: 15 GB/month outbound
- Elastic IP: Free while associated with a running instance

### After Free Tier
- t2.micro: ~$8.50/month (us-east-1)
- t3.micro: ~$7.50/month (us-east-1, slightly better value)
- t3.small: ~$15/month (us-east-1, 2 GB RAM)
- 20 GB gp3 EBS: ~$1.60/month
- Elastic IP (associated): Free
- Data transfer: First 100 GB/month is free (as of 2024)

### Avoiding surprise charges
- Set up a billing alarm: `aws cloudwatch put-metric-alarm` (or do it in the console under Billing > Budgets)
- Check the Free Tier usage dashboard regularly
- Remember: stopped instances still pay for EBS storage and Elastic IP
