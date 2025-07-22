# 🚀 Deploy Malloy Slack Bot to Google Cloud Run

This guide walks you through building and deploying a Malloy-powered Slack bot to Google Cloud Run.

## Prerequisites
- Google Cloud CLI installed and authenticated
- Docker installed
- A Slack app with bot permissions
- OpenAI API key

## Step 1: Configure Google Cloud
```bash
# Set your project ID
export PROJECT_ID="your-project-id"
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

## Step 2: Build and Deploy MCP Server
First, deploy the Malloy MCP server that the bot will connect to:

```bash
# From the project root
cd cloud
./deploy-mcp-server.sh
```

Note the MCP server URL from the deployment output - you'll need this for the bot configuration.

## Step 3: Set Up Secrets
Create the required secrets in Google Secret Manager:

```bash
cd examples/slack-bot
./cloud/setup-secrets.sh
```

**You'll need to provide:**
- Slack Bot Token (starts with `xoxb-`)
- Slack App Token (starts with `xapp-`)  
- OpenAI API Key (starts with `sk-`)
- MCP Server URL (from Step 2)

## Step 4: Build and Deploy Bot
```bash
# Build and deploy the Slack bot
./cloud/deploy-slack-bot.sh
```

This script will:
1. Build the Docker image using Cloud Build
2. Deploy to Cloud Run with proper configuration
3. Set up environment variables and secrets

## Step 5: Test Deployment
```bash
# Get the service URL
BOT_URL=$(gcloud run services describe malloy-slack-bot --region=us-central1 --format='value(status.url)')

# Test health endpoints
curl $BOT_URL/health
curl $BOT_URL/ready

# Check deployment logs
gcloud run logs tail malloy-slack-bot --region=us-central1 --follow
```

## Step 6: Test in Slack
- Mention your bot in any channel: `@your-bot what datasets are available?`
- The bot should respond with Malloy data insights

## Manual Build Instructions
If you prefer to build and push the Docker image manually:

```bash
# Build the image
docker build -f cloud/Dockerfile -t gcr.io/$PROJECT_ID/malloy-slack-bot .

# Push to Google Container Registry
docker push gcr.io/$PROJECT_ID/malloy-slack-bot

# Deploy to Cloud Run
gcloud run deploy malloy-slack-bot \
  --image gcr.io/$PROJECT_ID/malloy-slack-bot \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars MCP_SERVER_URL=$MCP_SERVER_URL \
  --set-secrets SLACK_BOT_TOKEN=slack-bot-token:latest \
  --set-secrets SLACK_APP_TOKEN=slack-app-token:latest \
  --set-secrets OPENAI_API_KEY=openai-api-key:latest
```

## Environment Variables
The bot uses these environment variables:
- `MCP_SERVER_URL`: URL of your deployed Malloy MCP server
- `SLACK_BOT_TOKEN`: Slack bot token (from Secret Manager)
- `SLACK_APP_TOKEN`: Slack app token (from Secret Manager)
- `OPENAI_API_KEY`: OpenAI API key (from Secret Manager)

## Troubleshooting
- **Health check fails**: Check logs for startup errors and verify all secrets are properly set
- **MCP connection issues**: Verify MCP server URL is correct and accessible
- **Slack not responding**: Check bot tokens and ensure your Slack app has proper permissions
- **Build failures**: Ensure all dependencies are available and Docker daemon is running 