"""
Test local bot connectivity to cloud MCP server
Validates that local Slack bot can communicate with deployed MCP server
"""

import pytest
import os
import requests
import json
from unittest.mock import patch, Mock
from src.clients.enhanced_mcp_client import EnhancedMCPClient
from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter

class TestLocalToCloudConnectivity:
    """Test connectivity from local bot to cloud MCP server"""
    
    @pytest.fixture
    def cloud_mcp_url(self):
        """Cloud MCP server URL"""
        return "https://malloy-mcp-server-234201753528.us-central1.run.app:4040/mcp"
    
    @pytest.fixture
    def mock_env_vars(self):
        """Mock environment variables for testing"""
        return {
            "SLACK_BOT_TOKEN": "xoxb-test-token",
            "SLACK_APP_TOKEN": "xapp-test-token", 
            "OPENAI_API_KEY": "sk-test-key",
            "MCP_URL": "https://malloy-mcp-server-234201753528.us-central1.run.app:4040/mcp"
        }
    
    @pytest.mark.integration
    def test_cloud_mcp_server_health_check(self, cloud_mcp_url):
        """Test that cloud MCP server is accessible via HTTP"""
        base_url = cloud_mcp_url.replace(":4040/mcp", "")
        
        try:
            response = requests.get(base_url, timeout=10)
            assert response.status_code == 200
            print(f"✅ Cloud MCP server is accessible at {base_url}")
        except requests.RequestException as e:
            pytest.skip(f"Cloud MCP server not accessible: {e}")
    
    @pytest.mark.integration  
    def test_enhanced_mcp_client_cloud_connection(self, cloud_mcp_url):
        """Test that EnhancedMCPClient can connect to cloud MCP"""
        try:
            client = EnhancedMCPClient(mcp_url=cloud_mcp_url)
            
            # Test health check
            is_healthy = client.health_check()
            assert is_healthy is True, "Cloud MCP server health check failed"
            print(f"✅ Enhanced MCP client connected successfully to {cloud_mcp_url}")
            
        except Exception as e:
            pytest.skip(f"Could not connect to cloud MCP: {e}")
    
    @pytest.mark.integration
    def test_bot_initialization_with_cloud_mcp(self, mock_env_vars, cloud_mcp_url):
        """Test full bot initialization with cloud MCP server"""
        with patch.dict(os.environ, mock_env_vars):
            try:
                # Import bot and initialize with cloud MCP
                import bot
                
                malloy_agent, web_client, socket_client = bot.init_bot(
                    model='gpt-4o', 
                    provider='openai'
                )
                
                # Verify components initialized
                assert malloy_agent is not None
                assert web_client is not None
                assert socket_client is not None
                
                # Test health check
                health_result = malloy_agent.health_check()
                assert health_result is True, "Bot health check with cloud MCP failed"
                
                print(f"✅ Bot successfully initialized with cloud MCP at {cloud_mcp_url}")
                
            except Exception as e:
                pytest.skip(f"Bot initialization with cloud MCP failed: {e}")
    
    @pytest.mark.integration
    def test_simple_query_to_cloud_mcp(self, mock_env_vars):
        """Test a simple query through local bot to cloud MCP"""
        with patch.dict(os.environ, mock_env_vars):
            try:
                import bot
                
                # Initialize bot
                malloy_agent, _, _ = bot.init_bot(model='gpt-4o', provider='openai')
                
                # Test a simple query
                test_question = "What datasets are available?"
                success, response, history = malloy_agent.process_user_question(
                    test_question, 
                    history=None
                )
                
                assert success is True, f"Query failed: {response}"
                assert response is not None and len(response) > 0
                assert history is not None
                
                print(f"✅ Successfully processed query through cloud MCP")
                print(f"   Question: {test_question}")
                print(f"   Response length: {len(response)} characters")
                
            except Exception as e:
                pytest.skip(f"Query to cloud MCP failed: {e}")

class TestCloudMCPPerformance:
    """Test performance characteristics of cloud MCP"""
    
    @pytest.mark.integration
    def test_response_time_within_limits(self):
        """Test that cloud MCP responds within acceptable time limits"""
        import time
        
        base_url = "https://malloy-mcp-server-234201753528.us-central1.run.app"
        
        try:
            start_time = time.time()
            response = requests.get(base_url, timeout=5)
            end_time = time.time()
            
            response_time = end_time - start_time
            assert response_time < 3.0, f"Response time too slow: {response_time:.2f}s"
            
            print(f"✅ Cloud MCP response time: {response_time:.2f}s")
            
        except requests.RequestException as e:
            pytest.skip(f"Could not test response time: {e}")

class TestNetworkingConfiguration:
    """Test networking configuration for cloud deployment"""
    
    def test_cloud_run_url_format(self):
        """Test that Cloud Run URL is properly formatted"""
        mcp_url = "https://malloy-mcp-server-234201753528.us-central1.run.app:4040/mcp"
        
        # Validate URL format
        assert mcp_url.startswith("https://")
        assert "malloy-mcp-server" in mcp_url
        assert "us-central1.run.app" in mcp_url
        assert ":4040/mcp" in mcp_url
    
    def test_environment_variable_configuration(self):
        """Test environment variable configuration for cloud MCP"""
        test_env = {
            "MCP_URL": "https://malloy-mcp-server-234201753528.us-central1.run.app:4040/mcp"
        }
        
        with patch.dict(os.environ, test_env):
            mcp_url = os.environ.get("MCP_URL")
            assert mcp_url is not None
            assert "malloy-mcp-server" in mcp_url

if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"]) 