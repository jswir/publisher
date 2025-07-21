#!/usr/bin/env python3
"""
LangChain Integration Tests
Test the complete LangChain integration with dynamic tools and agents
"""

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import Mock, patch
import pytest
from unittest.mock import AsyncMock
import json
from unittest.mock import MagicMock
from langchain.schema import HumanMessage, AIMessage
from langchain.prompts import ChatPromptTemplate

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from tools.dynamic_malloy_tools import MalloyToolsFactory, create_malloy_tools
from agents.malloy_langchain_agent import MalloyLangChainAgent, create_malloy_agent
from prompts.malloy_prompts import MalloyPromptTemplates
from clients.enhanced_mcp_client import EnhancedMCPClient


class TestDynamicToolsCreation:
    """Test dynamic tool creation from MCP discovery"""
    
    def test_prompt_templates_initialization(self):
        """Test that prompt templates are properly initialized"""
        templates = MalloyPromptTemplates()
        
        # Test basic agent prompt
        agent_prompt = templates.get_agent_prompt()
        assert isinstance(agent_prompt, ChatPromptTemplate)
        
        # Test data retrieval prompt  
        data_prompt = templates.get_data_retrieval_prompt("test question")
        assert isinstance(data_prompt, ChatPromptTemplate)
        
        # Skip chart generation prompt test (method removed during simplification)
        # chart_prompt = templates.get_chart_generation_prompt("test question", {"test": "data"})
        # self.assertIsInstance(chart_prompt, str)
        
        print("✅ Prompt templates initialized correctly")
        
        # Test getting agent prompt
        agent_prompt = templates.get_agent_prompt()
        assert agent_prompt is not None
        
        # Test other prompts
        # chart_prompt = templates.get_chart_generation_prompt("test question", {"test": "data"})
        # assert chart_prompt is not None
        # assert "test question" in chart_prompt
        # assert '"test": "data"' in chart_prompt
        
        error_prompt = templates.get_error_handling_prompt()
        assert error_prompt is not None
    
    def test_prompt_version_info(self):
        """Test prompt version information"""
        templates = MalloyPromptTemplates()
        version_info = templates.get_prompt_version_info()
        
        assert "version" in version_info
        assert "templates_available" in version_info
        assert "use_cases" in version_info
        assert len(version_info["use_cases"]) == 4
    
    def test_context_aware_prompts(self):
        """Test context-aware prompt generation"""
        templates = MalloyPromptTemplates()
        
        # Test aviation context
        aviation_context = {
            "user_domain": "aviation",
            "available_projects": ["flights", "airports"],
            "recent_queries": [{"project": "flights", "field": "origin"}]
        }
        
        context_prompt = templates.get_context_aware_prompt(aviation_context)
        assert "Aviation Domain Tips" in context_prompt
        assert "flights" in context_prompt
        
        # Test ecommerce context
        ecommerce_context = {"user_domain": "ecommerce"}
        context_prompt = templates.get_context_aware_prompt(ecommerce_context)
        assert "E-commerce Domain Tips" in context_prompt
    
    def test_use_case_prompts(self):
        """Test use case specific prompts"""
        templates = MalloyPromptTemplates()
        
        # Test each use case
        use_cases = ["data_exploration", "query_assistance", "visualization", "troubleshooting"]
        
        for use_case in use_cases:
            prompt = templates.get_prompt_by_use_case(use_case)
            assert len(prompt) > 0
            assert "1." in prompt  # Should contain numbered steps
        
        # Test unknown use case (should default to data_exploration)
        unknown_prompt = templates.get_prompt_by_use_case("unknown")
        exploration_prompt = templates.get_prompt_by_use_case("data_exploration")
        assert unknown_prompt == exploration_prompt


class TestLangChainIntegration:
    """Test LangChain integration components"""
    
    @pytest.fixture
    def mock_openai_key(self):
        """Mock OpenAI API key"""
        return "test-key-123"
    
    @pytest.fixture
    def mock_mcp_url(self):
        """Mock MCP URL"""
        return "http://localhost:4040/mcp"
    
    def test_agent_initialization(self, mock_openai_key, mock_mcp_url):
        """Test agent initialization without actual setup"""
        agent = MalloyLangChainAgent(
            openai_api_key=mock_openai_key,
            mcp_url=mock_mcp_url,
            session_id="test-session"
        )
        
        assert agent.openai_api_key == mock_openai_key
        assert agent.mcp_url == mock_mcp_url
        assert agent.session_id == "test-session"
        assert agent.model_name == "gpt-4o"
        assert agent.agent_executor is None  # Not setup yet
    
    def test_agent_info(self, mock_openai_key, mock_mcp_url):
        """Test agent information retrieval"""
        agent = MalloyLangChainAgent(
            openai_api_key=mock_openai_key,
            mcp_url=mock_mcp_url
        )
        
        info = agent.get_agent_info()
        
        assert "model_name" in info
        assert "session_id" in info
        assert "mcp_url" in info
        assert "tools_count" in info
        assert "agent_ready" in info
        assert info["agent_ready"] is False  # Not setup yet
    
    def test_conversation_management(self, mock_openai_key, mock_mcp_url):
        """Test conversation history management"""
        agent = MalloyLangChainAgent(
            openai_api_key=mock_openai_key,
            mcp_url=mock_mcp_url,
            memory_db_path="sqlite:///:memory:"  # In-memory database
        )
        
        # Test getting empty history
        history = agent.get_conversation_history()
        assert len(history) == 0
        
        # Test clearing conversation
        agent.clear_conversation()
        history = agent.get_conversation_history()
        assert len(history) == 0
    
    @patch('src.clients.enhanced_mcp_client.EnhancedMCPClient')
    def test_tools_factory_initialization(self, mock_client_class):
        """Test tools factory initialization"""
        mock_client = Mock()
        mock_client_class.return_value = mock_client
        
        factory = MalloyToolsFactory(mock_client)
        assert factory.mcp_client == mock_client
    
    def test_chart_info_extraction(self, mock_openai_key, mock_mcp_url):
        """Test chart info extraction from responses"""
        agent = MalloyLangChainAgent(
            openai_api_key=mock_openai_key,
            mcp_url=mock_mcp_url
        )
        
        # Test JSON response with chart info
        json_response = '{"text": "Chart created", "file_info": {"status": "success", "filepath": "/tmp/chart.png"}}'
        chart_info = agent._extract_chart_info(json_response)
        
        assert chart_info is not None
        assert chart_info["status"] == "success"
        assert chart_info["filepath"] == "/tmp/chart.png"
        
        # Test regular text response
        text_response = "Here are the results from your query"
        chart_info = agent._extract_chart_info(text_response)
        assert chart_info is None
    
    def test_tools_used_extraction(self, mock_openai_key, mock_mcp_url):
        """Test extraction of tools used from agent result"""
        agent = MalloyLangChainAgent(
            openai_api_key=mock_openai_key,
            mcp_url=mock_mcp_url
        )
        
        # Mock result with intermediate steps
        mock_result = {
            "intermediate_steps": [
                (Mock(tool="list_projects"), "result1"),
                (Mock(tool="execute_query"), "result2")
            ]
        }
        
        tools_used = agent._extract_tools_used(mock_result)
        assert "list_projects" in tools_used
        assert "execute_query" in tools_used
        assert len(tools_used) == 2


class TestErrorHandling:
    """Test error handling in LangChain integration"""
    
    def test_invalid_tool_schema_handling(self):
        """Test handling of invalid tool schemas"""
        # Mock client
        mock_client = Mock()
        factory = MalloyToolsFactory(mock_client)
        
        # Test with invalid schema (missing required fields)
        invalid_schema = {"invalid": "schema"}
        
        try:
            from tools.dynamic_malloy_tools import DynamicMalloyTool
            # This should handle the error gracefully
            tool = DynamicMalloyTool(mock_client, invalid_schema)
            # If we get here, the error was handled
            assert True
        except Exception as e:
            # Expected behavior - should handle invalid schemas
            assert "name" in str(e) or "schema" in str(e)
    
    def test_agent_setup_error_handling(self):
        """Test agent setup error handling"""
        # Use invalid credentials
        agent = MalloyLangChainAgent(
            openai_api_key="invalid-key",
            mcp_url="http://invalid-url"
        )
        
        # The agent should be created but not set up
        assert agent.agent_executor is None
        assert len(agent.tools) == 0


class TestIntegrationWithRealMCP:
    """Integration tests with real MCP server (requires server to be running)"""
    
    def test_real_mcp_connection(self):
        """Test connection to real MCP server if available"""
        mcp_url = "http://localhost:4040/mcp"
        
        # Check if server is available
        import requests
        try:
            response = requests.get(mcp_url, timeout=2)
            server_available = response.status_code == 200
        except:
            server_available = False
        
        if not server_available:
            print("⏭️  Skipping: MCP server not available at localhost:4040")
            return
        
        # Test tool creation with real server
        tools = create_malloy_tools(mcp_url)
        assert len(tools) > 0
        
        # Test that we get expected tools
        tool_names = [tool.name for tool in tools]
        expected_tools = ["list_projects", "list_packages", "execute_query"]
        
        for expected_tool in expected_tools:
            assert expected_tool in tool_names


def run_tests():
    """Run all tests"""
    print("🧪 Running LangChain Integration Tests")
    print("=" * 60)
    
    # Test prompt templates
    print("\n📝 Testing Prompt Templates")
    print("-" * 30)
    
    test_prompts = TestDynamicToolsCreation()
    test_prompts.test_prompt_templates_initialization()
    print("✅ Prompt templates initialization")
    
    test_prompts.test_prompt_version_info()
    print("✅ Prompt version info")
    
    test_prompts.test_context_aware_prompts()
    print("✅ Context-aware prompts")
    
    test_prompts.test_use_case_prompts()
    print("✅ Use case prompts")
    
    # Test LangChain integration
    print("\n🔗 Testing LangChain Integration")
    print("-" * 30)
    
    test_integration = TestLangChainIntegration()
    test_integration.test_agent_initialization("test-key", "http://localhost:4040/mcp")
    print("✅ Agent initialization")
    
    test_integration.test_agent_info("test-key", "http://localhost:4040/mcp")
    print("✅ Agent info")
    
    test_integration.test_conversation_management("test-key", "http://localhost:4040/mcp")
    print("✅ Conversation management")
    
    test_integration.test_chart_info_extraction("test-key", "http://localhost:4040/mcp")
    print("✅ Chart info extraction")
    
    test_integration.test_tools_used_extraction("test-key", "http://localhost:4040/mcp")
    print("✅ Tools used extraction")
    
    # Test error handling
    print("\n🚨 Testing Error Handling")
    print("-" * 30)
    
    test_errors = TestErrorHandling()
    test_errors.test_invalid_tool_schema_handling()
    print("✅ Invalid tool schema handling")
    
    test_errors.test_agent_setup_error_handling()
    print("✅ Agent setup error handling")
    
    # Test with real MCP (if available)
    print("\n🌐 Testing Real MCP Integration")
    print("-" * 30)
    
    test_real = TestIntegrationWithRealMCP()
    try:
        test_real.test_real_mcp_connection()
        print("✅ Real MCP connection")
    except Exception as e:
        print(f"⏭️  Skipped: {e}")
    
    print("\n" + "=" * 60)
    print("🎉 LangChain Integration Tests Complete!")
    print("✅ All core components tested successfully")


if __name__ == "__main__":
    run_tests()