#!/bin/bash

# Deploy Malloy Slack Bot to Cloud Run
# Automated deployment script following MCP server patterns

set -e

# Configuration
PROJECT_ID=${GCLOUD_PROJECT:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
SERVICE_NAME="malloy-slack-bot"

echo "🤖 Deploying Malloy Slack Bot to Cloud Run"
echo "   Project: $PROJECT_ID"
echo "   Region: $REGION"
echo "   Service: $SERVICE_NAME"

# Configure Docker for Google Container Registry
echo "🔐 Configuring Docker for Google Container Registry..."
gcloud auth configure-docker --quiet

# Build and push bot image
IMAGE_NAME="gcr.io/$PROJECT_ID/malloy-slack-bot:latest"

echo "🔨 Building Slack Bot image..."
docker build --platform linux/amd64 -f cloud/slack-bot.Dockerfile -t $IMAGE_NAME .

echo "📤 Pushing image to Google Container Registry..."
docker push $IMAGE_NAME

# Check if secrets exist, create if needed
echo "🔐 Checking secrets..."

# Check required secrets
REQUIRED_SECRETS=("slack-bot-token" "slack-app-token" "openai-api-key")
for secret in "${REQUIRED_SECRETS[@]}"; do
    if ! gcloud secrets describe $secret --quiet 2>/dev/null; then
        echo "⚠️  Secret '$secret' not found. Please create it first:"
        echo "   Use the setup script: ./cloud/setup-secrets.sh"
        exit 1
    fi
done

# Deploy to Cloud Run using service YAML
echo "🚀 Deploying to Cloud Run..."
gcloud run services replace cloud/slack-bot-service.yaml --region=$REGION

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform=managed --region=$REGION --format="value(status.url)")

echo "✅ Slack Bot deployment complete!"
echo "🌐 Bot Service URL: $SERVICE_URL"
echo "🏥 Health Check: $SERVICE_URL/health"
echo "📊 Ready Check: $SERVICE_URL/ready"
echo ""
echo "Next steps:"
echo "1. Test health: curl $SERVICE_URL/health"
echo "2. Check logs: gcloud run logs tail $SERVICE_NAME --region=$REGION"
echo "3. Test Slack integration in your workspace" 