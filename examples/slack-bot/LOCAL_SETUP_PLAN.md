# Local Slack Bot Setup Plan

## Goal
Get the Malloy Slack Bot running locally with minimal changes to the publisher repo. Both the bot and MCP server run from terminal on localhost.

## Architecture
```
Local Terminal 1: Publisher MCP Server (localhost:4040/mcp)
Local Terminal 2: Slack Bot → LangChain Agent → LLM API → MCP Server
Slack App: Socket Mode connection to local bot

Flow: Slack Message → bot.py → LangChainCompatibilityAdapter → MalloyLangChainAgent → LLM (OpenAI/Anthropic/Vertex) → MCP Tools → Publisher Server → Response
```

## Required Changes

### 1. Create Local Environment Configuration
**File**: `examples/slack-bot/.env.example`
```bash
# Slack Configuration (Required)
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# LLM Configuration (At least one required)
OPENAI_API_KEY=sk-your-openai-key
# Optional: ANTHROPIC_API_KEY=your-anthropic-key

# Local MCP Server (Required)
MCP_URL=http://localhost:4040/mcp

# Optional: Vertex AI (for Google models)
# VERTEX_PROJECT_ID=your-project
# VERTEX_LOCATION=us-central1

# Agent Configuration (Optional)
# Default model and provider (bot.py will auto-detect from available keys)
# LLM_MODEL=gpt-4o
# LLM_PROVIDER=openai
```

### 2. Create Simple Local Setup Script
**File**: `examples/slack-bot/setup-local.sh`
- Install Python dependencies
- Copy .env.example to .env
- Guide user through Slack app setup
- Test MCP connectivity

### 3. Verify Bot Configuration
**File**: `examples/slack-bot/bot.py`
- ✅ Already uses LangChainCompatibilityAdapter → MalloyLangChainAgent
- ✅ Already supports OpenAI, Anthropic, Vertex AI LLMs
- ✅ Already defaults MCP_URL to localhost:4040/mcp  
- ✅ Full agent functionality preserved
- Optional: Simplify logging for local development

### 4. Create Local README
**File**: `examples/slack-bot/README_LOCAL.md`
- Step-by-step local setup instructions
- Slack app configuration guide
- Troubleshooting for local development

### 5. Optional: Simple MCP Server Start Script
**File**: `examples/slack-bot/start-mcp-server.sh`
- Script to start publisher MCP server from correct directory
- Check if server is ready before bot starts

## Implementation Steps

### Step 1: Environment Setup (5 min)
1. Create `.env.example` with local defaults
2. Create `setup-local.sh` script for dependencies
3. Test script installs requirements correctly

### Step 2: Agent Verification (10 min)  
1. Verify `bot.py` → LangChain agent → LLM → MCP flow works locally
2. Test that existing LangChainCompatibilityAdapter works with localhost
3. Confirm agent can call LLMs (OpenAI/Anthropic/Vertex) from local environment
4. Ensure no cloud dependencies are required for agent functionality

### Step 3: Documentation (10 min)
1. Create `README_LOCAL.md` with setup steps
2. Document Slack app configuration
3. Add troubleshooting section

### Step 4: Testing (15 min)
1. Test full workflow: MCP server + bot + Slack
2. Verify data queries work end-to-end
3. Test chart generation locally
4. Document any issues found

## Files to Create/Modify

### New Files (minimal set)
- `examples/slack-bot/.env.example` - Local environment template
- `examples/slack-bot/setup-local.sh` - Local setup script  
- `examples/slack-bot/README_LOCAL.md` - Local setup guide
- `examples/slack-bot/start-mcp-server.sh` - MCP server helper (optional)

### Files to Modify (minimal changes)
- `examples/slack-bot/bot.py` - Ensure localhost MCP URL default
- `examples/slack-bot/requirements.txt` - Review if any deps can be simplified

### Files to Leave Unchanged
- All cloud deployment files (keep for future)
- **All agent logic**: LangChainCompatibilityAdapter, MalloyLangChainAgent, prompts
- **All LLM integrations**: OpenAI, Anthropic, Vertex AI configurations
- **All MCP client code**: Enhanced MCP client and tool discovery
- **All chart generation**: Matplotlib tool and chart workflow
- Test files (keep existing)
- Existing documentation (supplement, don't replace)

## Success Criteria

### Must Work
1. Start publisher MCP server: `cd publisher && npm start` (or similar)
2. Start slack bot: `cd examples/slack-bot && python bot.py`
3. **Full agent workflow**: Slack message → LangChain agent → LLM API call → MCP tools → data analysis
4. Bot responds to Slack messages with intelligent data queries and insights
5. **Chart generation works locally**: Agent can generate and save matplotlib charts
6. **Multi-turn conversations**: Agent maintains context across conversation turns

### Nice to Have
1. Single command setup script
2. Automatic MCP server health check
3. Clear error messages for missing config

## Risk Assessment

### Low Risk Changes
- Environment configuration files
- Documentation updates  
- Helper scripts

### Medium Risk Changes
- Bot.py configuration defaults
- Requirements simplification

### No Risk
- Keeping all existing cloud files
- Not modifying core publisher code
- Not changing agent logic

## Timeline
- **Total Effort**: ~45 minutes
- **Step 1**: 5 min (env setup)
- **Step 2**: 10 min (bot config)  
- **Step 3**: 10 min (docs)
- **Step 4**: 15 min (testing)
- **Buffer**: 5 min (issues/polish)

## Branch Strategy
```bash
# Create new branch from main
git checkout main
git pull origin main
git checkout -b feature/local-slack-bot-setup

# Make minimal changes
# Test thoroughly
# Create PR back to main
```

This keeps the changes isolated and easily reviewable while preserving all existing cloud deployment capabilities.