#!/usr/bin/env python3
"""
Simple test script to verify basic chart generation
"""

import asyncio
import os
import json
import pytest
from unittest.mock import patch, MagicMock
from src.agents.malloy_langchain_agent import MalloyLangChainAgent
from src.tools.matplotlib_chart_tool import MatplotlibChartTool

@pytest.mark.asyncio
async def test_simple_chart():
    """
    Test basic chart generation with a simple, hardcoded script.
    """
    
    # Check environment
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        print("❌ Need OPENAI_API_KEY environment variable")
        return
    
    print("🧪 Simple Chart Generation Test")
    print("=" * 40)
    
    # Create agent
    agent = MalloyLangChainAgent(
        mcp_url="http://localhost:4040/mcp",
        auth_token=None,
        model_name="gpt-4o-mini",
        llm_provider="openai",
        openai_api_key=openai_key
    )
    
    # Setup
    print("Setting up agent...")
    success = await agent.setup()
    if not success:
        print("❌ Setup failed")
        return
    
    print(f"✅ Setup complete - {len(agent.tools)} tools available")
    
    # Test the exact query from the logs
    test_query = "whats my total sales in ecommerce per year - make a chart"
    
    print(f"\nTesting query: {test_query}")
    print("=" * 40)
    
    try:
        success, response, metadata = await agent.process_question(test_query)
        
        print(f"Success: {success}")
        print(f"Response length: {len(response)}")
        print(f"Tools used: {metadata.get('tools_used', [])}")
        
        # Check if response is JSON
        try:
            parsed = json.loads(response)
            print("✅ Response is JSON")
            print(f"Text: {parsed.get('text', 'N/A')}")
            
            file_info = parsed.get('file_info')
            if file_info:
                print(f"File status: {file_info.get('status')}")
                file_path = file_info.get('filepath')
                if file_path:
                    print(f"File path: {file_path}")
                    if os.path.exists(file_path):
                        print("✅ Chart file exists!")
                    else:
                        print("❌ Chart file missing!")
                        
        except json.JSONDecodeError:
            print("❌ Response is not JSON")
            print(f"Response: {response}")
            
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_simple_chart())