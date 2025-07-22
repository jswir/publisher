#!/bin/bash

# Deploy Malloy Slack Bot to Cloud Run with Enhanced Monitoring
# Automated deployment script with robust monitoring and keep-alive setup

set -e

# Configuration
PROJECT_ID=${GCLOUD_PROJECT:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
SERVICE_NAME="malloy-slack-bot"

echo "🤖 Deploying Enhanced Malloy Slack Bot to Cloud Run"
echo "   Project: $PROJECT_ID"
echo "   Region: $REGION"
echo "   Service: $SERVICE_NAME"

# Configure Docker for Google Container Registry
echo "🔐 Configuring Docker for Google Container Registry..."
gcloud auth configure-docker --quiet

# Build and push bot image
IMAGE_NAME="gcr.io/$PROJECT_ID/malloy-slack-bot:latest"

echo "🔨 Building Enhanced Slack Bot image..."
docker build --platform linux/amd64 -f cloud/Dockerfile -t $IMAGE_NAME .

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
echo "🚀 Deploying to Cloud Run with enhanced configuration..."
gcloud run services replace cloud/slack-bot-service.yaml --region=$REGION

# Wait for deployment to be ready
echo "⏳ Waiting for deployment to be ready..."
gcloud run services wait $SERVICE_NAME --region=$REGION --timeout=300

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform=managed --region=$REGION --format="value(status.url)")

# Test basic connectivity
echo "🧪 Testing service connectivity..."
sleep 30  # Give the service time to fully start

# Test health endpoints
echo "Testing /health endpoint..."
if curl -f "$SERVICE_URL/health" --max-time 30; then
    echo "✅ Health endpoint responding"
else
    echo "⚠️  Health endpoint not responding - service may still be starting"
fi

echo "Testing /ready endpoint..."
if curl -f "$SERVICE_URL/ready" --max-time 30; then
    echo "✅ Ready endpoint responding"
else
    echo "⚠️  Ready endpoint not responding - service may still be initializing"
fi

# Setup monitoring and keep-alive
echo "📊 Setting up monitoring and keep-alive..."
if [ -f "./cloud/setup-monitoring.sh" ]; then
    chmod +x ./cloud/setup-monitoring.sh
    ./cloud/setup-monitoring.sh
else
    echo "⚠️  Monitoring setup script not found - skipping automated monitoring setup"
fi

echo ""
echo "✅ Enhanced Slack Bot deployment complete!"
echo ""
echo "🌐 Service Information:"
echo "   Service URL: $SERVICE_URL"
echo "   Health Check: $SERVICE_URL/health"
echo "   Ready Check: $SERVICE_URL/ready"
echo "   Metrics: $SERVICE_URL/metrics"
echo "   Keep-alive: $SERVICE_URL/ping"
echo ""
echo "📊 Monitoring Features:"
echo "   - Auto-reconnection for Slack Socket Mode"
echo "   - Circuit breaker pattern for MCP failures"
echo "   - Memory management for conversation cache"
echo "   - Periodic health monitoring"
echo "   - Keep-alive scheduler to prevent scale-to-zero"
echo ""
echo "🔧 Management Commands:"
echo "   View logs:     gcloud run logs tail $SERVICE_NAME --region=$REGION --follow"
echo "   Scale to zero: gcloud run services update $SERVICE_NAME --min-instances=0 --region=$REGION"
echo "   Scale to one:  gcloud run services update $SERVICE_NAME --min-instances=1 --region=$REGION"
echo "   Delete service: gcloud run services delete $SERVICE_NAME --region=$REGION"
echo ""
echo "📈 Monitoring Commands:"
echo "   List schedulers: gcloud scheduler jobs list --location=$REGION"
echo "   View scheduler logs: gcloud scheduler jobs logs --location=$REGION malloy-slack-bot-keep-alive"
echo ""
echo "🧪 Testing Commands:"
echo "   curl $SERVICE_URL/health"
echo "   curl $SERVICE_URL/ready" 
echo "   curl $SERVICE_URL/metrics"
echo "   curl $SERVICE_URL/ping"
echo ""
echo "Next steps:"
echo "1. Monitor the service logs for any startup issues"
echo "2. Test the Slack integration in your workspace"
echo "3. Monitor the /metrics endpoint for service health"
echo "4. The service will now stay alive automatically!" 