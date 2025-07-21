#!/bin/bash

# Deploy Malloy MCP Server to Cloud Run
# Simple script to deploy official malloydata/publisher image

set -e

# Configuration
PROJECT_ID=${GCLOUD_PROJECT:-$(gcloud config get-value project)}
REGION=${REGION:-us-central1}
SERVICE_NAME="malloy-mcp-server"

echo "🚀 Deploying Malloy MCP Server to Cloud Run"
echo "   Project: $PROJECT_ID"
echo "   Region: $REGION"
echo "   Service: $SERVICE_NAME"

# Configure Docker for Google Container Registry
echo "🔐 Configuring Docker for Google Container Registry..."
gcloud auth configure-docker --quiet

# Build and push our custom image to Google Container Registry
IMAGE_NAME="gcr.io/$PROJECT_ID/malloy-publisher:latest"

echo "🔨 Building custom Malloy Publisher image..."
docker build --platform linux/amd64 -f cloud/malloy-publisher.Dockerfile -t $IMAGE_NAME .

echo "📤 Pushing image to Google Container Registry..."
docker push $IMAGE_NAME

# Deploy using our custom image
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image=$IMAGE_NAME \
    --platform=managed \
    --region=$REGION \
    --allow-unauthenticated \
    --port=4000 \
    --set-env-vars="MCP_PORT=4040,NODE_ENV=production,PUBLISHER_HOST=0.0.0.0,MCP_HOST=0.0.0.0" \
    --cpu=1 \
    --memory=1Gi \
    --timeout=300 \
    --max-instances=10 \
    --min-instances=0

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform=managed --region=$REGION --format="value(status.url)")

echo "✅ Deployment complete!"
echo "🌐 MCP Server URL: $SERVICE_URL"
echo "🔗 MCP Endpoint: $SERVICE_URL/mcp"
echo ""
echo "Next steps:"
echo "1. Test: curl $SERVICE_URL/health"
echo "2. Update your bot's MCP_URL to: $SERVICE_URL/mcp" 