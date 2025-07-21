"""
Integration tests for the complete bot workflow.
- Test bot initialization and health checks
- Test multi-step conversation flows (e.g., query + chart)
"""

import pytest
import asyncio
from unittest.mock import MagicMock, AsyncMock, patch
import os

# Set dummy environment variables BEFORE importing the bot module
# This prevents the module-level checks in bot.py from failing during test collection.
os.environ['SLACK_BOT_TOKEN'] = 'test-bot-token'
os.environ['SLACK_APP_TOKEN'] = 'test-app-token'
os.environ['OPENAI_API_KEY'] = 'test-openai-key'

# Mock the expensive imports before they are loaded
import sys

# Create a mock object that mimics the package structure for slack_sdk
slack_sdk_mock = MagicMock()
slack_sdk_mock.web = MagicMock()
slack_sdk_mock.socket_mode = MagicMock()
slack_sdk_mock.socket_mode.request = MagicMock()
slack_sdk_mock.socket_mode.client = MagicMock()

sys.modules['slack_sdk'] = slack_sdk_mock
sys.modules['slack_sdk.web'] = slack_sdk_mock.web
sys.modules['slack_sdk.socket_mode'] = slack_sdk_mock.socket_mode
sys.modules['slack_sdk.socket_mode.request'] = slack_sdk_mock.socket_mode.request
sys.modules['slack_sdk.socket_mode.client'] = slack_sdk_mock.socket_mode.client

# Mock dotenv to prevent it from trying to load a .env file during tests
sys.modules['dotenv'] = MagicMock()

from bot import health_check, process_slack_events
from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
from langchain.schema import HumanMessage, AIMessage


@pytest.fixture
def mock_dependencies():
    """Mock all external dependencies for bot functions."""
    with patch('bot.malloy_agent', spec=LangChainCompatibilityAdapter) as mock_agent_instance, \
         patch('bot.web_client', new_callable=MagicMock) as mock_web_client, \
         patch('bot.socket_mode_client', new_callable=MagicMock) as mock_socket_client:

        # The agent's health_check method is now a regular sync method returning a boolean.
        mock_agent_instance.health_check = MagicMock(return_value=True)

        yield {
            "agent_instance": mock_agent_instance,
            "web_client": mock_web_client,
            "socket_client": mock_socket_client,
        }


def test_bot_health_check_success(mock_dependencies):
    """
    Test that the bot's health check passes when dependencies are healthy.
    """
    # Arrange
    mock_dependencies["agent_instance"].health_check.return_value = True

    # Act
    is_healthy = health_check()

    # Assert
    assert is_healthy is True
    mock_dependencies["agent_instance"].health_check.assert_called_once()


def test_bot_health_check_failure(mock_dependencies):
    """
    Test that the bot's health check fails when dependencies are unhealthy.
    """
    # Arrange
    mock_dependencies["agent_instance"].health_check.return_value = False

    # Act
    is_healthy = health_check()

    # Assert
    assert is_healthy is False
    mock_dependencies["agent_instance"].health_check.assert_called_once()


@pytest.mark.asyncio
async def test_multi_step_chart_generation_workflow(mock_dependencies):
    """
    Verify the bot can handle a multi-step task: fetch data, then generate a chart.
    """
    # Arrange
    mock_agent = mock_dependencies["agent_instance"]
    mock_web_client = mock_dependencies["web_client"]
    mock_socket_client = mock_dependencies["socket_client"]

    # This is a regular method, not async.
    chart_response = '{"text": "Here is your chart.", "file_info": {"status": "success", "filepath": "/tmp/test_chart.png"}}'
    mock_agent.process_user_question.return_value = (True, chart_response, [])

    with patch('os.path.exists', return_value=True) as mock_path_exists, \
         patch('os.remove') as mock_remove:
        
        user_question_event = {
            "type": "events_api",
            "envelope_id": "test-envelope-id",
            "payload": {
                "event": {
                    "type": "app_mention",
                    "text": "<@BOT_ID> show me sales by year as a chart",
                    "user": "U12345",
                    "channel": "C12345",
                    "ts": "1234567890.123456",
                    "thread_ts": "1234567890.123456"
                }
            }
        }
        
        request = MagicMock()
        request.type = user_question_event["type"]
        request.envelope_id = user_question_event["envelope_id"]
        request.payload = user_question_event["payload"]
        
        # Act
        process_slack_events(mock_socket_client, request)
        await asyncio.sleep(0)

        # Assert
        mock_agent.process_user_question.assert_called_once_with("show me sales by year as a chart", history=None)

        mock_web_client.chat_postMessage.assert_called_with(
            channel="C12345",
            thread_ts="1234567890.123456",
            text="🤔 Let me explore the available data and answer your question..."
        )
        
        mock_path_exists.assert_called_with("/tmp/test_chart.png")

        mock_web_client.files_upload_v2.assert_called_once_with(
            channel="C12345",
            file="/tmp/test_chart.png",
            title="Malloy Chart",
            initial_comment="Here is your chart.",
            thread_ts="1234567890.123456"
        )

        mock_remove.assert_called_with("/tmp/test_chart.png")


@pytest.mark.asyncio
async def test_conversational_chart_generation(mock_dependencies):
    """
    Tests a two-step conversation:
    1. User asks for data.
    2. User asks to graph that data in a follow-up message.
    """
    # Arrange
    mock_agent = mock_dependencies["agent_instance"]
    mock_web_client = mock_dependencies["web_client"]
    mock_socket_client = mock_dependencies["socket_client"]
    from bot import CONVERSATION_CACHE
    
    # --- Turn 1: User asks for data ---
    q1 = "show me sales by year"
    a1 = "Here is your data on sales by year..."
    h1 = [{"role": "user", "content": q1}, {"role": "assistant", "content": a1}]
    mock_agent.process_user_question.return_value = (True, a1, h1)

    event1 = {
        "type": "events_api", "envelope_id": "test-envelope-1", "payload": {
            "event": {"type": "app_mention", "text": f"<@BOT_ID> {q1}", "user": "U12345", "channel": "C12345", "ts": "12345.0001"}
        }
    }
    request1 = MagicMock()
    request1.type, request1.envelope_id, request1.payload = event1["type"], event1["envelope_id"], event1["payload"]

    # Act for Turn 1
    process_slack_events(mock_socket_client, request1)
    await asyncio.sleep(0)
    
    # Assert for Turn 1
    mock_agent.process_user_question.assert_called_once_with(q1, history=None)
    mock_web_client.chat_postMessage.assert_any_call(channel="C12345", thread_ts="12345.0001", text=a1)
    mock_web_client.files_upload_v2.assert_not_called()

    # --- Turn 2: User asks for a chart ---
    mock_agent.process_user_question.reset_mock()
    mock_web_client.reset_mock()

    q2 = "now graph that"
    chart_response = '{"text": "Here is your chart.", "file_info": {"status": "success", "filepath": "/tmp/test_chart.png"}}'
    h2 = h1 + [{"role": "user", "content": q2}, {"role": "assistant", "content": chart_response}]
    mock_agent.process_user_question.return_value = (True, chart_response, h2)

    event2 = {
        "type": "events_api", "envelope_id": "test-envelope-2", "payload": {
            "event": {"type": "message", "text": q2, "user": "U12345", "channel": "C12345", "ts": "12345.0002", "thread_ts": "12345.0001"}
        }
    }
    request2 = MagicMock()
    request2.type, request2.envelope_id, request2.payload = event2["type"], event2["envelope_id"], event2["payload"]

    # Manually populate the cache to simulate the state after the first turn
    CONVERSATION_CACHE["12345.0001"] = h1

    with patch('os.path.exists', return_value=True), patch('os.remove'):
        # Act for Turn 2
        process_slack_events(mock_socket_client, request2)
        await asyncio.sleep(0)

    # Assert for Turn 2
    mock_agent.process_user_question.assert_called_once_with(q2, history=h1)
    mock_web_client.files_upload_v2.assert_called_once()
    
    # Clean up cache
    CONVERSATION_CACHE.clear()

def test_adapter_history_deserialization_logic():
    """
    Tests the adapter's _deserialize_history method directly.
    This is a simple, synchronous test to ensure the core logic is correct.
    """
    from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
    from langchain.schema import HumanMessage, AIMessage
    
    # Arrange
    adapter = LangChainCompatibilityAdapter(openai_api_key="test")
    history_payload = [
        {"role": "user", "content": {"content": "q1", "additional_kwargs": {}}},
        {"role": "assistant", "content": {"content": "a1", "additional_kwargs": {"tool_data": "some_data"}}}
    ]

    # Act
    deserialized = adapter._deserialize_history(history_payload)
    
    # Assert
    assert len(deserialized) == 2
    assert isinstance(deserialized[0], HumanMessage)
    assert deserialized[0].content == "q1"
    assert isinstance(deserialized[1], AIMessage)
    assert deserialized[1].content == "a1"
    assert deserialized[1].additional_kwargs['tool_data'] == 'some_data' 