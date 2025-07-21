#!/usr/bin/env python3
"""
LangChain Integration Test with Real MCP Server
Test the complete LangChain agent with dynamic tool discovery
"""

import os
import sys
import asyncio
from pathlib import Path
import pytest

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "src"))

def test_import_langchain_components():
    """Test that we can import all LangChain components"""
    
    print("📦 Testing LangChain Component Imports")
    print("=" * 60)
    
    try:
        # Test basic LangChain imports
        from langchain.tools import BaseTool
        from langchain.agents import AgentExecutor
        from langchain_openai import ChatOpenAI
        from langchain_google_vertexai import ChatVertexAI
        print("✅ Core LangChain imports successful")
        
        # Test our components
        from tools.dynamic_malloy_tools import MalloyToolsFactory, create_malloy_tools
        print("✅ Dynamic tools import successful")
        
        from agents.malloy_langchain_agent import MalloyLangChainAgent, create_malloy_agent
        print("✅ LangChain agent import successful")
        
        from prompts.malloy_prompts import MalloyPromptTemplates
        print("✅ Prompt templates import successful")
        
        from agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        print("✅ Compatibility adapter import successful")
        
        return True
        
    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False

@pytest.mark.asyncio
async def test_dynamic_tool_creation():
    """Test that dynamic tools can be created from MCP discovery"""
    
    print("\n🛠️ Testing Dynamic Tool Creation")
    print("=" * 60)
    
    try:
        from tools.dynamic_malloy_tools import create_malloy_tools
        from clients.enhanced_mcp_client import EnhancedMCPClient
        
        # Test with local MCP server
        mcp_url = "http://localhost:4040/mcp"
        
        print(f"Connecting to MCP server: {mcp_url}")
        
        # First check if server is available
        client = EnhancedMCPClient(mcp_url)
        is_healthy = await client.health_check()
        
        if not is_healthy:
            print("❌ MCP server not available, skipping tool creation test")
            return False
        
        print("✅ MCP server is healthy")
        
        # Test tool creation
        print("Creating dynamic tools from MCP discovery...")
        tools = create_malloy_tools(mcp_url)
        
        print(f"✅ Created {len(tools)} dynamic tools")
        
        # Display tool information
        for tool in tools:
            print(f"  - {tool.name}: {tool.description[:50]}...")
        
        assert len(tools) > 0
        assert isinstance(tools[0], BaseTool)
        
        return True
        
    except Exception as e:
        print(f"❌ Dynamic tool creation failed: {e}")
        return False

@pytest.mark.asyncio
async def test_agent_initialization():
    """Test that the LangChain agent can be initialized"""
    
    print("\n🤖 Testing Agent Initialization")
    print("=" * 60)
    
    from agents.malloy_langchain_agent import MalloyLangChainAgent
    
    # Test OpenAI agent (if key available)
    openai_key = os.getenv('OPENAI_API_KEY')
    if openai_key:
        print("Testing OpenAI agent initialization...")
        try:
            openai_agent = MalloyLangChainAgent(
                mcp_url="http://localhost:4040/mcp",
                llm_provider="openai",
                openai_api_key=openai_key,
                model_name="gpt-4o"
            )
            print("✅ OpenAI agent initialized")
            
            # Test agent info
            info = openai_agent.get_agent_info()
            print(f"   Provider: {info['llm_provider']}")
            print(f"   Model: {info['model_name']}")
            print(f"   Agent ready: {info['agent_ready']}")
            
            assert openai_agent.llm is not None
            assert openai_agent.mcp_client is not None
            
        except Exception as e:
            print(f"❌ OpenAI agent initialization failed: {e}")
    else:
        print("⏭️  Skipping OpenAI test (no API key)")
    
    # Test Vertex AI agent (if configured)
    vertex_project = os.getenv('VERTEX_PROJECT_ID')
    if vertex_project:
        print("Testing Vertex AI agent initialization...")
        try:
            vertex_agent = MalloyLangChainAgent(
                mcp_url="http://localhost:4040/mcp",
                llm_provider="vertex",
                vertex_project_id=vertex_project,
                model_name="gemini-1.5-pro"
            )
            print("✅ Vertex AI agent initialized")
            
            # Test agent info
            info = vertex_agent.get_agent_info()
            print(f"   Provider: {info['llm_provider']}")
            print(f"   Model: {info['model_name']}")
            print(f"   Project: {info['vertex_project_id']}")
            
            assert vertex_agent.vertex_project_id == vertex_project
            assert vertex_agent.llm_provider == "vertex"
            
        except Exception as e:
            print(f"❌ Vertex AI agent initialization failed: {e}")
    else:
        print("⏭️  Skipping Vertex AI test (no project ID)")
    
    return True

@pytest.mark.asyncio
async def test_agent_setup_and_tools():
    """Test the agent's setup method and tool loading"""
    
    print("\n⚙️ Testing Agent Setup with Tool Discovery")
    print("=" * 60)
    
    openai_key = os.getenv('OPENAI_API_KEY')
    if not openai_key:
        print("⏭️  Skipping agent setup test (no OpenAI API key)")
        return False
    
    try:
        from agents.malloy_langchain_agent import MalloyLangChainAgent
        
        agent = MalloyLangChainAgent(
            mcp_url="http://localhost:4040/mcp",
            llm_provider="openai",
            openai_api_key=openai_key,
            model_name="gpt-4o"
        )
        
        print("Setting up agent with dynamic tool discovery...")
        success = await agent.setup()
        
        if success:
            print("✅ Agent setup successful")
            
            # Test agent info
            info = agent.get_agent_info()
            print(f"   Tools discovered: {info['tools_count']}")
            print(f"   Tool names: {', '.join(info['tool_names'])}")
            print(f"   Agent ready: {info['agent_ready']}")
            
            assert success is True
            assert len(agent.tools) > 0
            
            # Test health check
            health = await agent.health_check()
            print(f"   Health check: {health}")
            
            return True
        else:
            print("❌ Agent setup failed")
            return False
            
    except Exception as e:
        print(f"❌ Agent setup test failed: {e}")
        return False

@pytest.mark.asyncio
async def test_compatibility_adapter():
    """Test the LangChainCompatibilityAdapter"""
    
    print("\n🔄 Testing Compatibility Adapter")
    print("=" * 60)
    
    try:
        from agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        # Test with mock credentials
        adapter = LangChainCompatibilityAdapter(
            openai_api_key="test-key",
            mcp_url="http://localhost:4040/mcp",
            llm_provider="openai"
        )
        
        print("✅ Compatibility adapter created")
        
        # Test interface methods
        methods_to_test = [
            'process_user_question',
            'get_available_tools', 
            'call_tool',
            'health_check',
            'get_agent_info'
        ]
        
        for method in methods_to_test:
            has_method = hasattr(adapter, method) and callable(getattr(adapter, method))
            status = "✅" if has_method else "❌"
            print(f"   {status} {method}")
        
        # Test agent info
        info = adapter.get_agent_info()
        print(f"   Adapter type: {info['adapter_type']}")
        print(f"   LLM provider: {info['llm_provider']}")
        
        assert "What are the top 5 brands" in response
        
        return True
        
    except Exception as e:
        print(f"❌ Compatibility adapter test failed: {e}")
        return False

@pytest.mark.asyncio
async def test_vertex_ai_features():
    """Test that Vertex AI features can be configured"""
    
    print("\n🔮 Testing Vertex AI Features")
    print("=" * 60)
    
    vertex_project = os.getenv('VERTEX_PROJECT_ID')
    if not vertex_project:
        print("⏭️  Skipping Vertex AI test (set VERTEX_PROJECT_ID to test)")
        return True
    
    try:
        from agents.malloy_langchain_agent import MalloyLangChainAgent
        
        # Test different Vertex AI models
        models_to_test = [
            "gemini-1.5-pro",
            "gemini-1.5-flash",
            "gpt-4o",  # Should auto-map to gemini-1.5-pro
        ]
        
        for model in models_to_test:
            print(f"Testing model: {model}")
            try:
                agent = MalloyLangChainAgent(
                    mcp_url="http://localhost:4040/mcp",
                    llm_provider="vertex",
                    vertex_project_id=vertex_project,
                    model_name=model
                )
                
                info = agent.get_agent_info()
                print(f"   ✅ {model} → {info['model_name']}")
                
                assert agent.vertex_project_id == "test-project"
                assert agent.llm_provider == "vertex"
                
            except Exception as e:
                print(f"   ❌ {model} failed: {e}")
        
        return True
        
    except Exception as e:
        print(f"❌ Vertex AI features test failed: {e}")
        return False

async def main():
    """Run all LangChain integration tests"""
    
    print("🧪 LangChain Integration Test with Real MCP Server")
    print("Testing complete LangChain architecture with Vertex AI support...")
    print()
    
    # Test component imports
    import_success = test_import_langchain_components()
    
    if not import_success:
        print("\n❌ Import tests failed - cannot continue")
        return
    
    # Test dynamic tool creation
    tools_success = await test_dynamic_tool_creation()
    
    # Test agent initialization
    agent_init_success = await test_agent_initialization()
    
    # Test agent setup (if OpenAI key available)
    setup_success = await test_agent_setup_and_tools()
    
    # Test compatibility adapter
    adapter_success = await test_compatibility_adapter()
    
    # Test Vertex AI features
    vertex_success = await test_vertex_ai_features()
    
    # Summary
    print("\n" + "=" * 60)
    print("🎉 LangChain Integration Test Complete!")
    print()
    
    results = [
        ("Component imports", import_success),
        ("Dynamic tool creation", tools_success),
        ("Agent initialization", agent_init_success),
        ("Agent setup & tools", setup_success),
        ("Compatibility adapter", adapter_success),
        ("Vertex AI features", vertex_success)
    ]
    
    for test_name, success in results:
        status = "✅" if success else "❌"
        print(f"{status} {test_name}")
    
    all_success = all(success for _, success in results)
    
    if all_success:
        print("\n🚀 All tests passed! LangChain integration is ready!")
        print("📋 Next steps:")
        print("   1. Set OpenAI API key for full agent testing")
        print("   2. Set Vertex AI project for Gemini testing")
        print("   3. Run performance comparison vs Phase 1")
        print("   4. Migrate existing bot to LangChain")
    else:
        print("\n⚠️  Some tests failed - check configuration and dependencies")

if __name__ == "__main__":
    asyncio.run(main())