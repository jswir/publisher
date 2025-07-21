# 🚀 Deploy Malloy Slack Bot to Cloud Run

## Current Status
✅ All deployment files created  
✅ MCP Server working at: `https://malloy-mcp-server-fixed-234201753528.us-central1.run.app/mcp`  
⏳ Setting up secrets...

## Step 1: Complete Secrets Setup
```bash
./cloud/setup-secrets.sh
```
**You'll need:**
- Slack Bot Token (xoxb-...)
- Slack App Token (xapp-...)  
- OpenAI API Key (sk-...)

## Step 2: Deploy Bot
```bash
./cloud/deploy-slack-bot.sh
```

## Step 3: Test Deployment
```bash
# Get the bot URL from deploy output, then:
curl https://your-bot-url/health
curl https://your-bot-url/ready

# Check logs
gcloud run logs tail malloy-slack-bot --region=us-central1
```

## Step 4: Test in Slack
- Mention your bot in any channel: `@your-bot what datasets are available?`
- Bot should respond with Malloy data insights

## Troubleshooting
- **Health check fails**: Check logs for startup errors
- **MCP connection issues**: Verify MCP server URL in service config
- **Slack not responding**: Check bot tokens and app permissions 