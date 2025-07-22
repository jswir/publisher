# Malloy Slack Bot Troubleshooting Guide

This guide helps diagnose and resolve common issues with your enhanced Malloy Slack Bot deployment.

## 🔍 Quick Diagnostics

### Check Service Status
```bash
# Check if service is running
gcloud run services describe malloy-slack-bot --region=us-central1

# View recent logs
gcloud run logs tail malloy-slack-bot --region=us-central1 --follow

# Check health endpoints
curl https://your-service-url/health
curl https://your-service-url/ready
curl https://your-service-url/metrics
```

### Monitor Key Metrics
```bash
# Check scheduler jobs
gcloud scheduler jobs list --location=us-central1

# View scheduler logs
gcloud scheduler jobs logs --location=us-central1 malloy-slack-bot-keep-alive
```

## 🚨 Common Issues & Solutions

### 1. Service Stops After 1-2 Hours

**Symptoms:**
- Bot stops responding to Slack messages
- Cloud Run service scales to zero
- No response from health endpoints

**Root Causes & Solutions:**

#### A. Socket Mode Connection Timeout
**Fix:** The enhanced bot now includes auto-reconnection
```bash
# Check logs for reconnection attempts
gcloud run logs tail malloy-slack-bot --region=us-central1 | grep "reconnect"
```

#### B. Memory Leaks from Conversation Cache
**Fix:** Implemented automatic cleanup
- Conversations limited to 100 active
- Auto-cleanup after 24 hours
- Monitor via `/metrics` endpoint

#### C. MCP Server Connection Issues
**Fix:** Circuit breaker pattern implemented
- Fails gracefully when MCP is down
- Returns "agent is down" message to users
- Auto-recovery when MCP comes back

#### D. Cloud Run Scale-to-Zero
**Fix:** Keep-alive scheduler
```bash
# Verify scheduler is working
gcloud scheduler jobs describe malloy-slack-bot-keep-alive --location=us-central1

# Check minimum instances
gcloud run services update malloy-slack-bot --min-instances=1 --region=us-central1
```

### 2. "Agent is Down" Messages

**Symptoms:**
- Bot responds with "agent is down" message
- Circuit breaker is in OPEN state

**Diagnosis:**
```bash
# Check circuit breaker state
curl https://your-service-url/metrics | jq '.circuit_breaker'

# Check MCP server health
curl https://your-mcp-server-url/health
```

**Solutions:**

#### A. MCP Server Issues
```bash
# Restart MCP server
gcloud run services update your-mcp-service --region=us-central1

# Check MCP logs
gcloud run logs tail your-mcp-service --region=us-central1
```

#### B. Network Connectivity
```bash
# Test from Slack bot to MCP
# This requires shell access to the container
curl -f $MCP_URL/health
```

#### C. Reset Circuit Breaker
The circuit breaker automatically resets after successful requests. You can also restart the service:
```bash
gcloud run services update malloy-slack-bot --region=us-central1
```

### 3. High Memory Usage

**Symptoms:**
- Service restarts frequently
- Memory utilization near limits
- Conversation cache size growing

**Solutions:**

#### A. Adjust Memory Limits
```yaml
# In slack-bot-service.yaml
resources:
  limits:
    memory: "4Gi"  # Increase if needed
  requests:
    memory: "2Gi"
```

#### B. Monitor Conversation Cache
```bash
# Check cache size
curl https://your-service-url/metrics | jq '.memory.conversation_cache_size'
```

#### C. Manual Cache Cleanup
The service automatically cleans up, but you can restart to force cleanup:
```bash
gcloud run services update malloy-slack-bot --region=us-central1
```

### 4. Slow Response Times

**Symptoms:**
- Slack shows "thinking" for long periods
- Users report delayed responses
- High latency in monitoring

**Solutions:**

#### A. Increase CPU
```yaml
# In slack-bot-service.yaml
resources:
  limits:
    cpu: "4"  # Increase CPU
  requests:
    cpu: "2"
```

#### B. Scale Up Instances
```bash
# Increase max instances
gcloud run services update malloy-slack-bot \
  --max-instances=5 \
  --region=us-central1
```

#### C. Optimize MCP Calls
Check logs for slow MCP responses:
```bash
gcloud run logs tail malloy-slack-bot --region=us-central1 | grep "Tool error"
```

### 5. Deployment Failures

**Symptoms:**
- Deployment times out
- Service not ready
- Health checks failing

**Solutions:**

#### A. Increase Startup Time
```yaml
# In slack-bot-service.yaml
startupProbe:
  initialDelaySeconds: 120  # Increase if needed
  failureThreshold: 10
```

#### B. Check Dependencies
```bash
# Verify MCP server is running
gcloud run services list | grep mcp

# Check secrets
gcloud secrets list | grep -E "(slack|openai)"
```

#### C. Review Build Logs
```bash
# Check build logs in Cloud Build
gcloud builds list --limit=5
gcloud builds log [BUILD_ID]
```

## 📊 Monitoring & Alerts

### Key Metrics to Monitor

1. **Service Health**
   - `/health` endpoint response time
   - `/ready` endpoint status
   - Circuit breaker state

2. **Performance**
   - Response latency
   - Memory utilization
   - CPU utilization
   - Request rate

3. **Reliability**
   - Instance count
   - Error rate
   - Restart frequency

### Setting Up Alerts

```bash
# Create alerting policy for high error rate
gcloud alpha monitoring policies create --policy-from-file=alert-policy.yaml

# Create notification channel
gcloud alpha monitoring channels create --display-name="Slack Bot Alerts" \
  --type=email --labels=email_address=your-email@domain.com
```

### Dashboard Setup

```bash
# Import monitoring dashboard
gcloud monitoring dashboards create --config-from-file=cloud/monitoring-dashboard.json
```

## 🔧 Emergency Procedures

### Quick Recovery Steps

1. **Service Completely Down**
   ```bash
   # Force restart
   gcloud run services update malloy-slack-bot --region=us-central1
   
   # Check status
   gcloud run services describe malloy-slack-bot --region=us-central1
   ```

2. **Partial Functionality**
   ```bash
   # Check circuit breaker status
   curl https://your-service-url/metrics
   
   # Reset if needed by restarting
   gcloud run services update malloy-slack-bot --region=us-central1
   ```

3. **High Resource Usage**
   ```bash
   # Scale up resources temporarily
   gcloud run services update malloy-slack-bot \
     --memory=4Gi \
     --cpu=4 \
     --region=us-central1
   ```

### Rollback Procedure

```bash
# List recent revisions
gcloud run revisions list --service=malloy-slack-bot --region=us-central1

# Rollback to previous revision
gcloud run services update-traffic malloy-slack-bot \
  --to-revisions=[PREVIOUS_REVISION]=100 \
  --region=us-central1
```

## 📞 Support Information

### Log Analysis Commands

```bash
# Filter for errors
gcloud run logs tail malloy-slack-bot --region=us-central1 | grep -i error

# Filter for circuit breaker events
gcloud run logs tail malloy-slack-bot --region=us-central1 | grep "Circuit breaker"

# Filter for reconnection events
gcloud run logs tail malloy-slack-bot --region=us-central1 | grep "reconnect"

# Get health check logs
gcloud run logs tail malloy-slack-bot --region=us-central1 | grep "health check"
```

### Useful Debugging Commands

```bash
# Test all endpoints
for endpoint in health ready metrics ping; do
  echo "Testing /$endpoint"
  curl -f "https://your-service-url/$endpoint" || echo "FAILED"
done

# Check scheduler jobs status
gcloud scheduler jobs list --location=us-central1 --format="table(name,state,schedule)"

# Monitor in real-time
watch -n 5 'curl -s https://your-service-url/metrics | jq "{health: .health, circuit_breaker: .circuit_breaker.state, cache_size: .memory.conversation_cache_size}"'
```

This troubleshooting guide should help you maintain a robust and reliable Slack bot deployment! 