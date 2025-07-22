# Malloy Publisher Cloud Run Deployment Guide

## 🎯 Successfully Deploy Malloy Publisher with MCP Server on Google Cloud Run

This guide provides the **proven working solution** for deploying the Malloy Publisher with MCP server capabilities on Google Cloud Run.

## 📋 Quick Overview

**What this deploys:**
- **Publisher UI** (port 4000): Interactive web interface for Malloy queries
- **MCP Server** (port 4040): JSON-RPC server for programmatic access
- **Sample Data**: Pre-loaded malloy-samples for testing
- **Health Checks**: Properly configured Cloud Run probes

**Final Result:** Fully functional Malloy Publisher accessible via Cloud Run URL

## 🚀 Step-by-Step Deployment

### 1. Create Cloud Run Configuration

Create `cloud/mcp-server-service.yaml`:

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: malloy-mcp-server
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/execution-environment: gen2
        run.googleapis.com/cpu-throttling: "false"
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      containers:
      - image: gcr.io/your-project/malloy-publisher:latest
        ports:
        - name: http1
          containerPort: 4000  # Publisher UI port, NOT MCP port
        env:
        - name: MCP_PORT
          value: "4040"
        - name: NODE_ENV
          value: "production"
        - name: PUBLISHER_HOST  # KEY: This fixes IPv6 binding issue
          value: "0.0.0.0"
        - name: MCP_HOST
          value: "0.0.0.0"
        resources:
          limits:
            cpu: "1"
            memory: "1Gi"
        startupProbe:
          httpGet:
            path: /  # Health check the Publisher UI, not MCP server
            port: 4000
          initialDelaySeconds: 30
          timeoutSeconds: 5
          periodSeconds: 10
          failureThreshold: 6
        livenessProbe:
          httpGet:
            path: /
            port: 4000
          initialDelaySeconds: 10
          timeoutSeconds: 5
          periodSeconds: 30
```

### 2. Create Dockerfile

Create `cloud/malloy-publisher.Dockerfile`:

```dockerfile
# Stage 1: Build base malloy-publisher image
FROM oven/bun:1.2 as base-publisher

RUN apt-get update && apt-get install -y bash libc6 wget apt-transport-https gnupg git

# Add Eclipse Temurin repository and install JDK 21
RUN wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /usr/share/keyrings/adoptium.gpg > /dev/null
RUN echo "deb [signed-by=/usr/share/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME=/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list
RUN apt-get update && apt-get install -y temurin-21-jdk

ENV JAVA_HOME=/usr/lib/jvm/temurin-21-jdk
ENV PATH=$JAVA_HOME/bin:$PATH
ENV GOOGLE_APPLICATION_CREDENTIALS="/app/gcp-credentials/key.json"
RUN mkdir -p /app/gcp-credentials
RUN mkdir -p /app/server_root

# Clone and build Publisher - clone to temp directory to avoid conflicts
WORKDIR /tmp
RUN git clone https://github.com/malloydata/publisher.git publisher
WORKDIR /tmp/publisher
RUN git submodule init && git submodule update
RUN bun install
RUN bun run build

# Copy built files to final location
WORKDIR /app
RUN cp -r /tmp/publisher/* .

# Stage 2: Add malloy-samples (following official pattern)
FROM base-publisher as final

# Remove the default publisher.config.json
RUN rm -f /app/server_root/publisher.config.json

# Copy malloy-samples to server_root
RUN cp -r packages/server/malloy-samples /app/server_root/malloy-samples

# Copy the publisher.config.json that serves malloy-samples
RUN cp packages/server/publisher.config.json /app/server_root/

# Set environment variables - CRITICAL: PUBLISHER_HOST fixes IPv6 binding
ENV SERVER_ROOT=/app/server_root
ENV PUBLISHER_HOST=0.0.0.0
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=4040
ENV NODE_ENV=production

# Expose ports
EXPOSE 4000 4040

# Run the server
CMD bun run packages/server/dist/server.js
```

### 3. Build and Deploy

```bash
# Build the image
cd cloud
docker build --platform linux/amd64 -f malloy-publisher.Dockerfile -t gcr.io/your-project/malloy-publisher:latest .

# Push to Container Registry
docker push gcr.io/your-project/malloy-publisher:latest

# Deploy to Cloud Run
gcloud run services replace mcp-server-service.yaml --region=us-central1
```

### 4. Test Deployment

```bash
# Test the Publisher UI (should return HTTP 200)
curl https://your-service-url.us-central1.run.app/

# Open in browser for interactive queries
open https://your-service-url.us-central1.run.app/
```

## 🔑 Key Technical Insights

### **Critical Environment Variable**
```yaml
- name: PUBLISHER_HOST
  value: "0.0.0.0"
```
**Why this matters:** Without this, Publisher binds to IPv6 localhost (`::1:4000`) and Cloud Run health checks fail.

### **Health Check Strategy**
- ✅ **Target port 4000** (Publisher UI - HTTP server)
- ❌ **Don't target port 4040** (MCP server - JSON-RPC, not HTTP)

### **Two-Server Architecture**
- **Port 4000**: Publisher UI (React app) - use for health checks
- **Port 4040**: MCP Server (JSON-RPC) - internal programmatic access

### **Cloud Run Limitations**
- Only **one port exposed externally** (we use 4000)
- MCP server (4040) accessible **internally only**
- For external MCP access, use different architecture (GKE, etc.)

## 🧪 Testing and Verification

### **Local Testing**
```bash
# Test with correct environment variable
docker run --rm -d -p 4000:4000 -p 4040:4040 \
  -e PUBLISHER_HOST=0.0.0.0 \
  -e MCP_HOST=0.0.0.0 \
  -e MCP_PORT=4040 \
  your-image:latest

# Verify health check works
curl http://localhost:4000/  # Should return Publisher UI HTML
```

### **Browser Testing**
1. Open the Cloud Run URL in browser
2. You should see **Malloy Publisher** interface
3. Test sample queries on included datasets (airports, flights, etc.)

### **Log Verification**
Look for these successful binding messages:
```
Publisher server listening at http://0.0.0.0:4000  ✅
MCP server listening at http://0.0.0.0:4040        ✅
```

**NOT these (indicates IPv6 binding problem):**
```
Publisher server listening at http://::1:4000      ❌
```

## 📁 File Structure

After setup, you should have:
```
cloud/
├── mcp-server-service.yaml      # Cloud Run configuration
├── malloy-publisher.Dockerfile  # Two-stage build following official patterns
└── deploy-mcp-server.sh        # Optional deployment script
```

## 🔄 Integration with Slack Bot

For Slack bot integration:
1. **Publisher UI**: Users can create/test queries interactively
2. **MCP Server**: Bot connects internally to execute queries programmatically
3. **Sample Pattern**: Bot → MCP (port 4040) → Results → Slack

## 🎉 Success Indicators

✅ **Cloud Run deployment succeeds** (no startup probe timeouts)  
✅ **Publisher UI loads in browser**  
✅ **Sample datasets available**  
✅ **Queries execute successfully**  
✅ **Logs show proper binding** (`0.0.0.0:4000` and `0.0.0.0:4040`)

---

**This configuration has been tested and verified working. The key breakthrough was the `PUBLISHER_HOST=0.0.0.0` environment variable that resolves IPv6 binding issues.**
