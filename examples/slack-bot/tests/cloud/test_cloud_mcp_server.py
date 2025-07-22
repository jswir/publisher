#!/usr/bin/env python3
"""
Quick test script to validate Cloud Run MCP server functionality
"""

import os
import asyncio
import sys
from pathlib import Path

# Add the project root to the path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

async def test_cloud_mcp_server():
    """Test the Cloud Run MCP server with our agent."""
    
    print("🚀 Testing Cloud Run MCP Server")
    print("=" * 50)
    
    # Get configuration from environment
    mcp_url = os.getenv("MCP_URL", "https://malloy-mcp-server-fixed-234201753528.us-central1.run.app/mcp")
    openai_api_key = os.getenv("OPENAI_API_KEY")
    
    if not openai_api_key:
        print("❌ OPENAI_API_KEY not found in environment")
        return False
    
    print(f"📡 MCP URL: {mcp_url}")
    print(f"🤖 Model: gpt-4o")
    
    # Create the agent adapter
    agent = LangChainCompatibilityAdapter(
        mcp_url=mcp_url,
        openai_api_key=openai_api_key,
        llm_provider="openai",
        model_name="gpt-4o"
    )
    
    try:
        print("\n🔍 Test 1: Health Check")
        print("-" * 30)
        health = agent.health_check()
        print(f"Health Check: {'✅ PASS' if health else '❌ FAIL'}")
        
        if not health:
            print("❌ Health check failed, cannot continue")
            return False
        
        print("\n🔍 Test 2: Agent Info")
        print("-" * 30)
        info = agent.get_agent_info()
        print(f"Tools Available: {info.get('tools_count', 0)}")
        print(f"Tool Names: {info.get('tool_names', [])}")
        
        print("\n🔍 Test 3: Simple Question")
        print("-" * 30)
        question = "What projects are available?"
        print(f"Question: {question}")
        
        success, response, history = agent.process_user_question(question)
        
        print(f"Success: {'✅ PASS' if success else '❌ FAIL'}")
        print(f"Response: {response[:200]}...")
        
        if success and "malloy-samples" in response:
            print("✅ Successfully discovered malloy-samples project!")
            
            print("\n🔍 Test 4: Data Query")
            print("-" * 30)
            data_question = "Show me the top 5 brands from ecommerce data"
            print(f"Question: {data_question}")
            
            success2, response2, history2 = agent.process_user_question(data_question, history)
            
            print(f"Success: {'✅ PASS' if success2 else '❌ FAIL'}")
            print(f"Response: {response2[:300]}...")
            
            if success2:
                print("✅ Successfully queried ecommerce data!")
                return True
            else:
                print("❌ Failed to query ecommerce data")
                return False
        else:
            print("❌ Failed to discover projects")
            return False
            
    except Exception as e:
        print(f"❌ Test failed with exception: {e}")
        return False

def main():
    """Run the test."""
    try:
        result = asyncio.run(test_cloud_mcp_server())
        if result:
            print("\n🎉 All tests passed! Cloud Run MCP server is working correctly.")
        else:
            print("\n💥 Some tests failed. Check the output above.")
        return result
    except Exception as e:
        print(f"💥 Test execution failed: {e}")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1) 