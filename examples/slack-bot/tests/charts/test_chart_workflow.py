#!/usr/bin/env python3
"""
Test script to verify chart generation workflow end-to-end
"""

import asyncio
import os
import json
import pytest
from unittest.mock import patch, AsyncMock
from src.agents.malloy_langchain_agent import MalloyLangChainAgent

@pytest.mark.asyncio
async def test_chart_workflow():
    """
    Test the full chart generation workflow, from query to chart file.
    """
    
    # Check if we have OpenAI key
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        print("❌ OPENAI_API_KEY not set")
        print("   Run: export OPENAI_API_KEY=your_key_here")
        return
    
    print("🚀 Starting Chart Generation Workflow Test")
    print("=" * 50)
    
    # Create agent
    print("🔍 Creating agent...")
    agent = MalloyLangChainAgent(
        mcp_url="http://localhost:4040/mcp",
        auth_token=None,
        model_name="gpt-4o-mini",  # Use cheaper model for testing
        llm_provider="openai",
        openai_api_key=openai_key
    )
    
    # Setup agent
    print("🔍 Setting up agent...")
    success = await agent.setup()
    if not success:
        print("❌ Agent setup failed")
        return
    
    print(f"✅ Agent setup successful with {len(agent.tools)} tools")
    for tool in agent.tools:
        print(f"   - {tool.name}: {tool.description}")
    
    # Test queries
    test_queries = [
        {
            "name": "Sales by Year Chart",
            "query": "Show me total sales by year as a bar chart",
            "expected": "Should create a bar chart showing yearly sales data"
        },
        {
            "name": "Top Brands Chart", 
            "query": "Create a pie chart of top 5 brands by sales",
            "expected": "Should create a pie chart of top brands"
        },
        {
            "name": "Monthly Sales Line Chart",
            "query": "Graph monthly sales as a line chart",
            "expected": "Should create a line chart of monthly sales"
        },
        {
            "name": "Non-Chart Query",
            "query": "What are the top 3 customers by sales?",
            "expected": "Should return text response, no chart"
        }
    ]
    
    results = []
    
    for i, test in enumerate(test_queries, 1):
        print(f"\n📊 Test {i}/{len(test_queries)}: {test['name']}")
        print(f"Query: {test['query']}")
        print(f"Expected: {test['expected']}")
        print("-" * 40)
        
        try:
            success, response, metadata = await agent.process_question(test['query'])
            
            # Analyze response
            is_json = False
            has_chart = False
            file_path = None
            
            try:
                parsed = json.loads(response)
                is_json = True
                if 'file_info' in parsed:
                    file_info = parsed['file_info']
                    if file_info.get('status') == 'success':
                        has_chart = True
                        file_path = file_info.get('filepath')
            except:
                pass
            
            result = {
                "name": test['name'],
                "query": test['query'],
                "success": success,
                "response_length": len(response),
                "is_json": is_json,
                "has_chart": has_chart,
                "file_path": file_path,
                "tools_used": metadata.get('tools_used', []),
                "chart_info": metadata.get('chart_info'),
                "response_preview": response[:150] + "..." if len(response) > 150 else response
            }
            
            results.append(result)
            
            # Print results
            print(f"✅ Success: {success}")
            print(f"📝 Response length: {len(response)}")
            print(f"🔧 Tools used: {metadata.get('tools_used', [])}")
            print(f"📊 Is JSON: {is_json}")
            print(f"🎨 Has chart: {has_chart}")
            if file_path:
                print(f"📁 Chart file: {file_path}")
                # Check if file exists
                if os.path.exists(file_path):
                    print(f"✅ Chart file exists!")
                else:
                    print(f"❌ Chart file missing!")
            
            print(f"📄 Response preview: {result['response_preview']}")
            
        except Exception as e:
            print(f"❌ Error: {e}")
            result = {
                "name": test['name'],
                "query": test['query'],
                "success": False,
                "error": str(e)
            }
            results.append(result)
    
    # Summary
    print("\n" + "=" * 50)
    print("📊 TEST SUMMARY")
    print("=" * 50)
    
    chart_tests = [r for r in results if any(word in r['query'].lower() for word in ['chart', 'graph', 'plot', 'show', 'create'])]
    non_chart_tests = [r for r in results if r not in chart_tests]
    
    print(f"🎨 Chart Tests: {len(chart_tests)}")
    for result in chart_tests:
        status = "✅" if result.get('has_chart') else "❌"
        print(f"   {status} {result['name']}: Chart={result.get('has_chart', False)}")
    
    print(f"📝 Non-Chart Tests: {len(non_chart_tests)}")
    for result in non_chart_tests:
        status = "✅" if result.get('success') and not result.get('has_chart') else "❌"
        print(f"   {status} {result['name']}: Success={result.get('success', False)}")
    
    # Check for common issues
    print("\n🔍 ISSUE ANALYSIS")
    print("-" * 30)
    
    # Check if any chart tests failed
    failed_charts = [r for r in chart_tests if not r.get('has_chart')]
    if failed_charts:
        print(f"❌ {len(failed_charts)} chart tests failed:")
        for result in failed_charts:
            print(f"   - {result['name']}")
            if 'error' in result:
                print(f"     Error: {result['error']}")
            else:
                print(f"     Tools used: {result.get('tools_used', [])}")
                print(f"     Response: {result.get('response_preview', '')}")
    
    # Check if matplotlib tool is being used
    chart_tool_usage = [r for r in results if 'generate_chart' in r.get('tools_used', [])]
    print(f"📊 Tests using generate_chart tool: {len(chart_tool_usage)}")
    
    # Check for empty responses
    empty_responses = [r for r in results if r.get('response_length', 0) == 0]
    if empty_responses:
        print(f"❌ {len(empty_responses)} tests had empty responses")
    
    print("\n🎯 RECOMMENDATIONS")
    print("-" * 30)
    
    if len(failed_charts) == len(chart_tests):
        print("❌ All chart tests failed - check agent prompt or tool integration")
    elif len(failed_charts) > 0:
        print(f"⚠️  {len(failed_charts)} chart tests failed - partial issue")
    else:
        print("✅ All chart tests passed!")
    
    if len(empty_responses) > 0:
        print("❌ Empty responses detected - check agent completion logic")
    
    if len(chart_tool_usage) == 0:
        print("❌ generate_chart tool never used - check tool availability")

if __name__ == "__main__":
    asyncio.run(test_chart_workflow())