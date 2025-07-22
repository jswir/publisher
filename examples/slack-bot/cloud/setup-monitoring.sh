#!/bin/bash

# Setup monitoring and alerting for Malloy Slack Bot
# This script creates Cloud Scheduler for keep-alive and monitoring alerts

set -e

# Configuration
PROJECT_ID=${GCLOUD_PROJECT:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
SERVICE_NAME="malloy-slack-bot"
SERVICE_URL="https://${SERVICE_NAME}-234201753528.${REGION}.run.app"

echo "🔧 Setting up monitoring for Malloy Slack Bot"
echo "   Project: $PROJECT_ID"
echo "   Region: $REGION"
echo "   Service: $SERVICE_NAME"
echo "   URL: $SERVICE_URL"

# Enable required APIs
echo "📡 Enabling required APIs..."
gcloud services enable cloudscheduler.googleapis.com --quiet
gcloud services enable monitoring.googleapis.com --quiet
gcloud services enable logging.googleapis.com --quiet

# Create Cloud Scheduler job for keep-alive
echo "⏰ Creating Cloud Scheduler keep-alive job..."

# Delete existing job if it exists
gcloud scheduler jobs delete malloy-slack-bot-keep-alive --location=$REGION --quiet 2>/dev/null || true

# Create new keep-alive job
gcloud scheduler jobs create http malloy-slack-bot-keep-alive \
  --location=$REGION \
  --schedule="*/5 * * * *" \
  --uri="${SERVICE_URL}/ping" \
  --http-method=GET \
  --headers="User-Agent=Cloud-Scheduler-Keep-Alive/1.0" \
  --max-retry-attempts=3 \
  --max-retry-duration=60s \
  --min-backoff-duration=5s \
  --max-backoff-duration=30s \
  --description="Keep Malloy Slack Bot alive by pinging every 5 minutes"

echo "✅ Keep-alive scheduler created successfully"

# Create health check monitoring job (every 2 minutes)
echo "🏥 Creating health check monitoring job..."

# Delete existing job if it exists
gcloud scheduler jobs delete malloy-slack-bot-health-check --location=$REGION --quiet 2>/dev/null || true

# Create health monitoring job
gcloud scheduler jobs create http malloy-slack-bot-health-check \
  --location=$REGION \
  --schedule="*/2 * * * *" \
  --uri="${SERVICE_URL}/metrics" \
  --http-method=GET \
  --headers="User-Agent=Cloud-Scheduler-Health-Monitor/1.0" \
  --max-retry-attempts=2 \
  --max-retry-duration=30s \
  --description="Monitor Malloy Slack Bot health status every 2 minutes"

echo "✅ Health monitoring scheduler created successfully"

# Test the schedulers
echo "🧪 Testing scheduler endpoints..."

echo "Testing keep-alive endpoint..."
curl -f "${SERVICE_URL}/ping" || echo "⚠️  Keep-alive endpoint test failed"

echo "Testing health endpoint..."
curl -f "${SERVICE_URL}/health" || echo "⚠️  Health endpoint test failed"

echo "Testing metrics endpoint..."
curl -f "${SERVICE_URL}/metrics" || echo "⚠️  Metrics endpoint test failed"

echo ""
echo "✅ Monitoring setup complete!"
echo ""
echo "Scheduler Jobs Created:"
echo "  🔄 Keep-alive: Pings /ping every 5 minutes"
echo "  🏥 Health Check: Monitors /metrics every 2 minutes"
echo ""
echo "Monitor your jobs:"
echo "  gcloud scheduler jobs list --location=$REGION"
echo ""
echo "View logs:"
echo "  gcloud scheduler jobs logs --location=$REGION malloy-slack-bot-keep-alive"
echo "  gcloud scheduler jobs logs --location=$REGION malloy-slack-bot-health-check"
echo ""
echo "Manual testing:"
echo "  curl ${SERVICE_URL}/ping"
echo "  curl ${SERVICE_URL}/health"
echo "  curl ${SERVICE_URL}/metrics" 