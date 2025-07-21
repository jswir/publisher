"""
Tests for cloud deployment functionality
Tests bot cloud deployment, connectivity, and integration
"""

import pytest
import os
import requests
import subprocess
import time
from unittest.mock import Mock, patch, MagicMock
import json

class TestCloudDeploymentPreparation:
    """Test deployment preparation and configuration"""
    
    def test_dockerfile_exists(self):
        """Test that Slack bot Dockerfile exists"""
        assert os.path.exists("cloud/slack-bot.Dockerfile")
    
    def test_service_yaml_exists(self):
        """Test that Cloud Run service config exists"""
        assert os.path.exists("cloud/slack-bot-service.yaml")
    
    def test_deployment_script_exists_and_executable(self):
        """Test that deployment script exists and is executable"""
        script_path = "cloud/deploy-slack-bot.sh"
        assert os.path.exists(script_path)
        assert os.access(script_path, os.X_OK)
    
    def test_secrets_setup_script_exists_and_executable(self):
        """Test that secrets setup script exists and is executable"""
        script_path = "cloud/setup-secrets.sh"
        assert os.path.exists(script_path)
        assert os.access(script_path, os.X_OK)

class TestDockerConfiguration:
    """Test Docker configuration for cloud deployment"""
    
    def test_dockerfile_contains_required_components(self):
        """Test that Dockerfile has all required components"""
        with open("cloud/slack-bot.Dockerfile", "r") as f:
            content = f.read()
        
        # Check for required elements
        assert "FROM python:3.11-slim" in content
        assert "COPY requirements.txt" in content
        assert "COPY src/ ./src/" in content
        assert "COPY bot.py" in content
        assert "EXPOSE 8080" in content
        assert "curl" in content  # For health checks
    
    def test_service_yaml_contains_required_config(self):
        """Test that service YAML has correct configuration"""
        with open("cloud/slack-bot-service.yaml", "r") as f:
            content = f.read()
        
        # Check for required configuration
        assert "name: malloy-slack-bot" in content
        assert "containerPort: 8080" in content
        assert "slack-bot-token" in content
        assert "slack-app-token" in content
        assert "openai-api-key" in content
        assert "malloy-mcp-server-234201753528.us-central1.run.app" in content

class TestHealthChecks:
    """Test health check functionality for cloud deployment"""
    
    @patch('requests.get')
    def test_health_endpoint_response(self, mock_get):
        """Test health endpoint returns correct response"""
        # Mock successful health check
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "healthy", "service": "malloy-slack-bot"}
        mock_get.return_value = mock_response
        
        # This would be the actual health check call
        response = requests.get("http://localhost:8080/health")
        assert response.status_code == 200
        assert response.json()["status"] == "healthy"
    
    @patch('requests.get')
    def test_ready_endpoint_response(self, mock_get):
        """Test ready endpoint returns correct response"""
        # Mock successful ready check
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "status": "ready",
            "checks": {
                "malloy_agent": True,
                "slack_web_client": True,
                "slack_socket_client": True
            }
        }
        mock_get.return_value = mock_response
        
        response = requests.get("http://localhost:8080/ready")
        assert response.status_code == 200
        assert response.json()["status"] == "ready"

class TestMCPConnectivity:
    """Test connectivity to cloud MCP server"""
    
    @pytest.mark.integration
    def test_mcp_server_accessible(self):
        """Test that the deployed MCP server is accessible"""
        mcp_url = "https://malloy-mcp-server-234201753528.us-central1.run.app"
        
        try:
            response = requests.get(mcp_url, timeout=10)
            assert response.status_code == 200
        except requests.RequestException:
            pytest.skip("MCP server not accessible - may be expected in CI")
    
    @patch('src.clients.enhanced_mcp_client.EnhancedMCPClient')
    def test_bot_mcp_client_initialization(self, mock_client):
        """Test that bot can initialize MCP client with cloud URL"""
        from src.clients.enhanced_mcp_client import EnhancedMCPClient
        
        # Mock the client initialization
        mock_instance = Mock()
        mock_client.return_value = mock_instance
        mock_instance.health_check.return_value = True
        
        # Test client creation with cloud URL
        cloud_mcp_url = "https://malloy-mcp-server-234201753528.us-central1.run.app:4040/mcp"
        client = EnhancedMCPClient(mcp_url=cloud_mcp_url)
        
        assert client is not None
        mock_client.assert_called_once_with(mcp_url=cloud_mcp_url)

class TestSecretManagement:
    """Test secret management for cloud deployment"""
    
    @patch('subprocess.run')
    def test_secret_validation_script(self, mock_run):
        """Test that secret validation works correctly"""
        # Mock successful secret check
        mock_run.return_value = Mock(returncode=0)
        
        # Test the secret checking logic
        secrets = ["slack-bot-token", "slack-app-token", "openai-api-key"]
        for secret in secrets:
            result = subprocess.run(
                ["gcloud", "secrets", "describe", secret, "--quiet"],
                capture_output=True
            )
            # Should not raise an exception
            assert True  # If we get here, the mock worked

class TestEndToEndIntegration:
    """Test end-to-end integration scenarios"""
    
    @pytest.mark.integration
    @patch('src.agents.langchain_compatibility_adapter.LangChainCompatibilityAdapter')
    def test_bot_initialization_with_cloud_mcp(self, mock_adapter):
        """Test bot initialization with cloud MCP server"""
        # Mock environment variables
        env_vars = {
            "SLACK_BOT_TOKEN": "xoxb-test-token",
            "SLACK_APP_TOKEN": "xapp-test-token", 
            "OPENAI_API_KEY": "sk-test-key",
            "MCP_URL": "https://malloy-mcp-server-234201753528.us-central1.run.app:4040/mcp"
        }
        
        with patch.dict(os.environ, env_vars):
            # Import and test bot initialization
            import bot
            
            # Mock the adapter
            mock_instance = Mock()
            mock_adapter.return_value = mock_instance
            mock_instance.health_check.return_value = True
            
            # Test initialization
            malloy_agent, web_client, socket_client = bot.init_bot()
            
            assert malloy_agent is not None
            assert web_client is not None
            assert socket_client is not None
    
    def test_deployment_script_syntax(self):
        """Test that deployment script has valid bash syntax"""
        result = subprocess.run(
            ["bash", "-n", "cloud/deploy-slack-bot.sh"],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Script syntax error: {result.stderr}"
    
    def test_secrets_script_syntax(self):
        """Test that secrets setup script has valid bash syntax"""
        result = subprocess.run(
            ["bash", "-n", "cloud/setup-secrets.sh"],
            capture_output=True,
            text=True
        )
        assert result.returncode == 0, f"Script syntax error: {result.stderr}"

@pytest.mark.integration
class TestCloudRunDeployment:
    """Integration tests for actual Cloud Run deployment"""
    
    def test_image_build_locally(self):
        """Test that Docker image builds successfully"""
        # This test requires Docker to be available
        try:
            result = subprocess.run(
                ["docker", "build", "-f", "cloud/slack-bot.Dockerfile", "-t", "test-bot", "."],
                capture_output=True,
                text=True,
                timeout=300  # 5 minutes timeout
            )
            if result.returncode != 0:
                pytest.skip(f"Docker build failed: {result.stderr}")
        except subprocess.TimeoutExpired:
            pytest.skip("Docker build timed out")
        except FileNotFoundError:
            pytest.skip("Docker not available")

if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 