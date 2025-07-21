#!/usr/bin/env python3
"""
Clean test script for SimpleMalloyAgent
Tests the LLM's direct access to raw MCP tool responses
AND threaded conversations
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
import os

# Set dummy environment variables for testing
os.environ['SLACK_BOT_TOKEN'] = 'test-bot-token'
os.environ['SLACK_APP_TOKEN'] = 'test-app-token'
os.environ['OPENAI_API_KEY'] = 'test-openai-key'

@pytest.fixture
def agent():
    """Provides a mocked agent instance for tests."""
    with patch('bot.malloy_agent', spec=LangChainCompatibilityAdapter) as mock_agent:
        # The process_user_question method is what the bot calls. It's a regular method.
        mock_agent.process_user_question = MagicMock()
        yield mock_agent

@pytest.mark.asyncio
async def test_single_questions(agent):
    """Test that the agent can answer single, unrelated questions."""
    
    # Arrange
    agent.process_user_question.return_value = (True, "Here are the top 5 names.", [])
    
    # Act
    success, response, _ = agent.process_user_question("Show me the top 5 most popular names", history=None)

    # Assert
    assert success is True
    assert "top 5 names" in response
    agent.process_user_question.assert_called_once_with("Show me the top 5 most popular names", history=None)

    # Arrange for the second question
    agent.process_user_question.reset_mock()
    agent.process_user_question.return_value = (True, "Here are the airports with the most flights.", [])

    # Act
    success, response, _ = agent.process_user_question("What airports have the most flights?", history=None)

    # Assert
    assert success is True
    assert "most flights" in response
    agent.process_user_question.assert_called_once_with("What airports have the most flights?", history=None)


@pytest.mark.asyncio
async def test_threaded_conversations(agent):
    """Test that the agent can maintain context in a threaded conversation."""
    
    history = []
    
    # --- Question 1: Initial question ---
    # Arrange
    q1 = "What are the top 5 most popular names?"
    a1 = "Here are the top 5 names: A, B, C, D, E"
    h1 = [{"role": "user", "content": q1}, {"role": "assistant", "content": a1}]
    agent.process_user_question.return_value = (True, a1, h1)
    
    # Act
    success, response, history = agent.process_user_question(q1, history=None)
    
    # Assert
    assert success is True
    assert response == a1
    assert len(history) == 2
    agent.process_user_question.assert_called_with(q1, history=None)

    # --- Question 2: Follow-up question ---
    # Arrange
    agent.process_user_question.reset_mock()
    q2 = "What about the next 5 names?"
    a2 = "The next 5 names are: F, G, H, I, J"
    h2 = history + [{"role": "user", "content": q2}, {"role": "assistant", "content": a2}]
    agent.process_user_question.return_value = (True, a2, h2)

    # Act
    success, response, history = agent.process_user_question(q2, history=history)

    # Assert
    assert success is True
    assert response == a2
    assert len(history) == 4
    # The first call's history will be passed to the second.
    agent.process_user_question.assert_called_with(q2, history=h1)

    # --- Question 3: Switching context ---
    # Arrange
    agent.process_user_question.reset_mock()
    q3 = "Now show me flight data instead"
    a3 = "Switching to flight data. Here are the top airports."
    h3 = history + [{"role": "user", "content": q3}, {"role": "assistant", "content": a3}]
    agent.process_user_question.return_value = (True, a3, h3)

    # Act
    success, response, history = agent.process_user_question(q3, history=history)

    # Assert
    assert success is True
    assert "flight data" in response
    assert len(history) == 6
    agent.process_user_question.assert_called_with(q3, history=h2) 