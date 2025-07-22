"""
Clean Malloy Slack Bot using SimpleMalloyAgent
- LLM has direct access to raw MCP tool responses
- Minimal parsing - let LLM handle everything naturally
- Multi-turn tool calling conversation
"""

import os
import json
import logging
import argparse
from typing import cast, Dict, List, Any
from threading import Thread
from dotenv import load_dotenv
from flask import Flask, jsonify
from slack_sdk.socket_mode import SocketModeClient
from slack_sdk.web import WebClient
from slack_sdk.socket_mode.request import SocketModeRequest
from slack_sdk.socket_mode.client import BaseSocketModeClient
from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('bot.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

def parse_args():
    """Parse command line arguments for model selection"""
    parser = argparse.ArgumentParser(description='Malloy Slack Bot')
    parser.add_argument('--model', choices=[
        'gpt-4o', 'gpt-4o-mini', 
        'gemini-1.5-pro', 'gemini-2.5-flash',
        'claude-4', 'claude-4-sonnet', 'claude-4-opus',
        'claude-3.7-sonnet', 'claude-3.5-sonnet', 'claude-3.5-haiku'
    ], default='gpt-4o', help='LLM model to use')
    parser.add_argument('--provider', choices=['openai', 'vertex', 'anthropic'], 
                       help='LLM provider (auto-detected from model if not specified)')
    return parser.parse_args()

def get_provider_from_model(model_name: str) -> str:
    """Auto-detect provider from model name"""
    if model_name.startswith('gpt'):
        return 'openai'
    elif model_name.startswith('gemini'):
        return 'vertex'
    elif model_name.startswith('claude'):
        return 'anthropic'
    else:
        return 'openai'  # Default

# --- Initialization ---
load_dotenv()

# Global variables
malloy_agent = None
CONVERSATION_CACHE: Dict[str, List[Dict[str, Any]]] = {}
web_client = None
socket_mode_client = None

def init_bot(model: str = 'gpt-4o', provider: str = None):
    """Initialize the bot with specified model and provider"""
    global malloy_agent, web_client, socket_mode_client
    
    LLM_MODEL = model
    LLM_PROVIDER = provider or get_provider_from_model(LLM_MODEL)

    # Set API keys and tokens (will raise KeyError if missing)
    try:
        SLACK_BOT_TOKEN = os.environ["SLACK_BOT_TOKEN"].strip()
        SLACK_APP_TOKEN = os.environ["SLACK_APP_TOKEN"].strip()
        OPENAI_API_KEY = os.environ["OPENAI_API_KEY"].strip()
        MCP_URL = os.environ.get("MCP_URL", "http://localhost:4040/mcp")
        
        # Anthropic configuration  
        ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
        
        # Vertex AI configuration
        VERTEX_PROJECT_ID = os.environ.get("VERTEX_PROJECT_ID")
        VERTEX_LOCATION = os.environ.get("VERTEX_LOCATION", "us-central1")
        
    except KeyError as e:
        raise ValueError(f"Missing required environment variable: {e}")

    # Log model configuration for debugging
    logger.info(f"🤖 Initializing Malloy Agent with:")
    logger.info(f"   - LLM Provider: {LLM_PROVIDER} (from {'command line' if provider else 'auto-detect'})")
    logger.info(f"   - LLM Model: {LLM_MODEL} (from command line)")
    logger.info(f"   - MCP URL: {MCP_URL}")
    if LLM_PROVIDER == "vertex":
        logger.info(f"   - Vertex Project: {VERTEX_PROJECT_ID}")
        logger.info(f"   - Vertex Location: {VERTEX_LOCATION}")
    elif LLM_PROVIDER == "anthropic":
        logger.info(f"   - Anthropic API Key: {'configured' if ANTHROPIC_API_KEY else 'NOT SET'}")

    # Initialize LangChain Malloy Agent
    malloy_agent = LangChainCompatibilityAdapter(
        openai_api_key=OPENAI_API_KEY,
        mcp_url=MCP_URL,
        llm_provider=LLM_PROVIDER,
        model_name=LLM_MODEL,
        anthropic_api_key=ANTHROPIC_API_KEY,
        vertex_project_id=VERTEX_PROJECT_ID,
        vertex_location=VERTEX_LOCATION
    )

    # Initialize Slack clients
    web_client = WebClient(token=SLACK_BOT_TOKEN)
    socket_mode_client = SocketModeClient(
        app_token=SLACK_APP_TOKEN,
        web_client=web_client
    )
    
    return malloy_agent, web_client, socket_mode_client

def _strip_markdown_json(text: str) -> str:
    """
    Strips the markdown JSON block (e.g., ```json ... ```) from a string.
    Handles variations with and without the 'json' language identifier.
    """
    text = text.strip()
    # Check for ```json at the beginning
    if text.startswith("```json"):
        text = text[7:].strip()
    # Check for ``` at the beginning
    elif text.startswith("```"):
        text = text[3:].strip()
    
    # Check for ``` at the end
    if text.endswith("```"):
        text = text[:-3].strip()
        
    return text

# --- Slack Event Listener ---

def process_slack_events(client: BaseSocketModeClient, req: SocketModeRequest):
    """
    The main event handler for incoming Slack events.
    Uses SimpleMalloyAgent with direct LLM tool access.
    """
    # Acknowledge the event first
    if req.type == "events_api":
        client.send_socket_mode_response({"envelope_id": req.envelope_id})

        event = req.payload.get("event", {})
        
        # Handle both app_mention and message events
        event_type = event.get("type")
        
        # Check if this is an event we should respond to
        if event_type == "app_mention" or (event_type == "message" and event.get("thread_ts")):
            text = event.get("text", "").strip()
            channel_id = event.get("channel")
            user_id = event.get("user")
            
            # Skip bot's own messages
            if user_id == web_client.auth_test()["user_id"]:
                return
            
            # Extract timestamps for conversation management
            thread_ts = event.get("thread_ts")
            message_ts = event.get("ts")
            
            logger.info(f"Received {event_type} from user {user_id} in channel {channel_id}")
            
            # Process text based on event type
            if event_type == "app_mention":
                # Remove the bot's mention from the text (e.g., "<@U123456> question" -> "question")
                user_question = text.split(">", 1)[-1].strip()
            else:
                # For thread messages, use the text as-is
                user_question = text
            
            # Determine conversation ID and retrieve history
            if thread_ts:
                # Follow-up question in existing thread
                conversation_id = thread_ts
                history = CONVERSATION_CACHE.get(conversation_id)
                logger.info(f"Continuing conversation {conversation_id} with history: {bool(history)}")
            else:
                # New question in main channel - start new thread
                conversation_id = message_ts
                history = None
                logger.info(f"Starting new conversation {conversation_id}")
            
            # Send thinking indicator in thread
            try:
                web_client.chat_postMessage(
                    channel=channel_id,
                    thread_ts=conversation_id,
                    text="🤔 Let me explore the available data and answer your question..."
                )
            except Exception as e:
                logger.warning(f"Failed to send thinking indicator: {e}")

            # Process the question through SimpleMalloyAgent with conversation history
            success, response_text, final_history = malloy_agent.process_user_question(user_question, history=history)
            
            if success:
                logger.info(f"Successfully processed question for user {user_id}")
                
                logger.debug(f"Response from agent: '{response_text}'")
                logger.debug(f"Response length: {len(response_text)}")
                logger.debug(f"Response type: {type(response_text)}")

                # Sanitize the response to handle markdown ```json ... ```
                clean_response_text = _strip_markdown_json(response_text)

                try:
                    response_data = json.loads(clean_response_text)
                    if "file_info" in response_data and response_data["file_info"].get("status") == "success":
                        filepath = response_data["file_info"]["filepath"]
                        
                        # Check if the file actually exists before trying to upload
                        if os.path.exists(filepath):
                            try:
                                # Upload the file to Slack
                                web_client.files_upload_v2(
                                    channel=channel_id,
                                    file=filepath,
                                    title="Malloy Chart",
                                    initial_comment=response_data.get("text", "Here's your chart:"),
                                    thread_ts=thread_ts
                                )
                                logger.info(f"Successfully uploaded chart for user {user_id}")
                                
                                # Cleanup temporary file
                                os.remove(filepath)
                                logger.debug(f"Cleaned up temporary chart file: {filepath}")
                                
                            except Exception as e:
                                logger.error(f"Failed to upload file: {e}")
                                web_client.chat_postMessage(
                                    channel=channel_id,
                                    thread_ts=conversation_id,
                                    text=f"I created a chart but failed to upload it: {e}"
                                )
                        else:
                            logger.error(f"Chart file does not exist: {filepath}")
                            web_client.chat_postMessage(
                                channel=channel_id,
                                thread_ts=conversation_id,
                                text="I tried to create a chart but the file was not generated successfully."
                            )
                    else:
                        # It's JSON, but not a file upload, so send the text part
                        web_client.chat_postMessage(
                            channel=channel_id,
                            thread_ts=conversation_id,
                            text=response_data.get("text", clean_response_text)
                        )
                        
                except json.JSONDecodeError:
                    logger.debug(f"Not JSON, treating as text response: '{response_text}'")
                    
                    if not response_text or response_text.strip() == "":
                        response_text = "I'm sorry, I couldn't generate a proper response."
                    
                    web_client.chat_postMessage(
                        channel=channel_id,
                        thread_ts=conversation_id,
                        text=response_text
                    )
                
                # Update conversation cache with final history
                if final_history:
                    CONVERSATION_CACHE[conversation_id] = final_history
                    logger.debug(f"Updated conversation cache for {conversation_id}")
                
            else:
                logger.warning(f"Failed to process question for user {user_id}: {response_text}")
                web_client.chat_postMessage(
                    channel=channel_id,
                    thread_ts=conversation_id,
                    text=f"❌ {response_text}"
                )
                
                # Still update cache even for failed responses to maintain context
                if final_history:
                    CONVERSATION_CACHE[conversation_id] = final_history

def health_check():
    """Check if all systems are healthy"""
    logger.info("Running health check...")
    
    # Check MCP connection by calling the adapter's public health_check method.
    # The adapter is responsible for its own initialization and setup.
    try:
        if not malloy_agent.health_check():
            logger.error("❌ MCP server is not healthy")
            return False
    except Exception as e:
        logger.error(f"❌ Health check failed with an exception: {e}")
        return False
    
    logger.info("✅ MCP server is healthy")
    return True

def create_health_app():
    """Create simple Flask app for cloud health checks"""
    app = Flask(__name__)
    
    @app.route('/health')
    def health():
        return jsonify({"status": "healthy", "service": "malloy-slack-bot"})
    
    @app.route('/ready')
    def ready():
        global malloy_agent, web_client, socket_mode_client
        ready_checks = {
            "malloy_agent": malloy_agent is not None,
            "slack_web_client": web_client is not None,
            "slack_socket_client": socket_mode_client is not None,
        }
        all_ready = all(ready_checks.values())
        return jsonify({
            "status": "ready" if all_ready else "not_ready", 
            "checks": ready_checks
        }), 200 if all_ready else 503
    
    return app

def run_health_server():
    """Run health check server in background"""
    app = create_health_app()
    app.run(host='0.0.0.0', port=8080, debug=False, use_reloader=False)

# --- Main Execution ---

if __name__ == "__main__":
    logger.info("🤖 Clean Malloy Bot is starting...")
    
    # Parse command line arguments only when running as main
    args = parse_args()
    
    # Initialize bot with command line arguments
    init_bot(model=args.model, provider=args.provider)
    
    # Start health check server in background (for cloud deployment)
    logger.info("🏥 Starting health check server on port 8080")
    health_thread = Thread(target=run_health_server, daemon=True)
    health_thread.start()
    
    # Run health check
    if not health_check():
        logger.error("❌ Health check failed. Please check your MCP server and configuration.")
        exit(1)
    
    try:
        socket_mode_client.socket_mode_request_listeners.append(process_slack_events)
        socket_mode_client.connect()
        logger.info("✅ Bot connected and listening for events")
        
        # Keep the main thread alive
        from threading import Event
        Event().wait()
        
    except Exception as e:
        logger.error(f"❌ Bot failed to start: {e}")
        raise