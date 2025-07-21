#!/usr/bin/env python3
"""
Test the chart generation functionality
"""

import os
import asyncio
import json
import pytest
from unittest.mock import patch, AsyncMock
from src.agents.malloy_langchain_agent import MalloyLangChainAgent

@pytest.mark.asyncio
async def test_agent_chart_generation():
    """
    Test the agent's ability to generate a chart from a user query.
    This is a high-level integration test.
    """
    
    # Create agent
    agent = MalloyLangChainAgent(
        mcp_url="http://localhost:4040/mcp",
        auth_token=None,
        model_name="gpt-4o",
        llm_provider="openai",
        openai_api_key="test-key"  # You'll need to set this
    )
    
    # Setup agent
    success = await agent.setup()
    if not success:
        print("❌ Agent setup failed")
        return
    
    print("✅ Agent setup successful")
    print(f"Agent has {len(agent.tools)} tools:")
    for tool in agent.tools:
        print(f"  - {tool.name}: {tool.description}")
    
    # Test simple chart request
    test_question = "Show me total sales by year as a chart"
    
    print(f"\n🔍 Testing question: {test_question}")
    
    success, response, metadata = await agent.process_question(test_question)
    
    print(f"\n📊 Results:")
    print(f"Success: {success}")
    print(f"Response length: {len(response)}")
    print(f"Response: {response[:200]}...")
    
    if metadata.get('tools_used'):
        print(f"Tools used: {metadata['tools_used']}")
    
    if metadata.get('chart_info'):
        print(f"Chart info: {metadata['chart_info']}")
    
    # Check if response is JSON
    try:
        parsed = json.loads(response)
        print(f"✅ Response is valid JSON")
        if 'file_info' in parsed:
            print(f"📁 File info: {parsed['file_info']}")
    except:
        print(f"❌ Response is not JSON")

if __name__ == "__main__":
    asyncio.run(test_agent_chart_generation())