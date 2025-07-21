#!/bin/bash

# Setup Google Secret Manager secrets for Slack Bot
# Interactive script to securely configure secrets

set -e

PROJECT_ID=${GCLOUD_PROJECT:-$(gcloud config get-value project)}

echo "🔐 Setting up Google Secret Manager secrets for Slack Bot"
echo "   Project: $PROJECT_ID"
echo ""

# Function to create secret safely
create_secret() {
    local secret_name=$1
    local description=$2
    
    if gcloud secrets describe $secret_name --quiet 2>/dev/null; then
        echo "✅ Secret '$secret_name' already exists"
        read -p "   Update with new value? (y/N): " update
        if [[ $update =~ ^[Yy]$ ]]; then
            read -s -p "   Enter new value: " secret_value
            echo ""
            echo "$secret_value" | gcloud secrets versions add $secret_name --data-file=-
            echo "✅ Updated secret '$secret_name'"
        fi
    else
        echo "📝 Creating secret '$secret_name': $description"
        gcloud secrets create $secret_name --replication-policy=automatic
        read -s -p "   Enter value: " secret_value
        echo ""
        echo "$secret_value" | gcloud secrets versions add $secret_name --data-file=-
        echo "✅ Created secret '$secret_name'"
    fi
    echo ""
}

# Setup Slack secrets
echo "🚀 Setting up Slack secrets..."
echo "   You'll need these from your Slack app configuration:"
echo "   1. Bot User OAuth Token (starts with xoxb-)"
echo "   2. App-Level Token (starts with xapp-)"
echo ""

create_secret "slack-bot-token" "Slack Bot User OAuth Token"
create_secret "slack-app-token" "Slack App-Level Token"

# Setup LLM secrets
echo "🤖 Setting up LLM secrets..."
echo "   You'll need your OpenAI API key"
echo ""

create_secret "openai-api-key" "OpenAI API Key"

# Note: IAM permissions will be handled automatically by Cloud Run
echo "🔑 IAM permissions will be configured during deployment..."

echo "✅ All secrets configured!"
echo ""
echo "Next steps:"
echo "1. Deploy the bot: ./cloud/deploy-slack-bot.sh"
echo "2. Test the deployment: curl https://your-bot-url/health" 