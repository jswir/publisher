"""
Backward Compatibility Adapter for MalloyMCPClient

This adapter provides the exact same interface as the original MalloyMCPClient
but uses the new async EnhancedMCPClient under the hood.

This allows for gradual migration without breaking existing code.
"""

import asyncio
import logging
from typing import Dict, List, Any, Optional
from .enhanced_mcp_client import EnhancedMCPClient, MCPConfig

logger = logging.getLogger(__name__)

class MalloyMCPClientAdapter:
    """
    Backward compatibility adapter that mimics the original MalloyMCPClient interface
    but uses the new async EnhancedMCPClient internally.
    """
    
    def __init__(self, mcp_url: str = "http://localhost:4040/mcp", auth_token: Optional[str] = None):
        self.mcp_url = mcp_url
        self.auth_token = auth_token
        
        # Create config for enhanced client
        self.config = MCPConfig(
            url=mcp_url,
            auth_token=auth_token
        )
        
        # We'll create the client when needed
        self._client = None
        self._loop = None
        
        logger.info(f"Initialized MalloyMCPClientAdapter for {mcp_url}")
    
    def _get_or_create_loop(self):
        """Get existing event loop or create a new one"""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                raise RuntimeError("Loop is closed")
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop
    
    async def _get_client(self) -> EnhancedMCPClient:
        """Get or create the enhanced client"""
        if self._client is None:
            self._client = EnhancedMCPClient(self.config)
            await self._client.__aenter__()
        return self._client
    
    def _run_async(self, coro):
        """Run an async coroutine in sync context"""
        loop = self._get_or_create_loop()
        
        if loop.is_running():
            # If we're already in an async context, we need to handle this differently
            # For now, we'll create a new thread to run the async code
            import concurrent.futures
            import threading
            
            def run_in_thread():
                new_loop = asyncio.new_event_loop()
                asyncio.set_event_loop(new_loop)
                try:
                    return new_loop.run_until_complete(coro)
                finally:
                    new_loop.close()
            
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(run_in_thread)
                return future.result()
        else:
            return loop.run_until_complete(coro)
    
    def list_tools(self) -> List[Dict[str, Any]]:
        """Get available tools from MCP server"""
        async def _list_tools():
            client = await self._get_client()
            # Convert the tools dict to the expected list format
            tools = []
            for name, info in client.available_tools.items():
                tools.append({
                    "name": name,
                    "description": info.get("description", ""),
                    "inputSchema": info.get("inputSchema", {})
                })
            return tools
        
        return self._run_async(_list_tools())
    
    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Call a specific tool"""
        async def _call_tool():
            client = await self._get_client()
            try:
                result = await client.call_tool(tool_name, arguments)
                return result
            except Exception as e:
                logger.error(f"Error calling tool {tool_name}: {e}")
                return None
        
        return self._run_async(_call_tool())
    
    # Malloy-specific tool wrappers (maintaining exact same interface)
    def list_projects(self) -> List[str]:
        """List all available Malloy projects"""
        async def _list_projects():
            client = await self._get_client()
            return await client.list_projects()
        
        return self._run_async(_list_projects())
    
    def list_packages(self, project_name: str) -> List[str]:
        """List packages within a project"""
        async def _list_packages():
            client = await self._get_client()
            return await client.list_packages(project_name)
        
        return self._run_async(_list_packages())
    
    def get_package_contents(self, project_name: str, package_name: str) -> Dict[str, Any]:
        """Get contents of a package (models, etc.)"""
        async def _get_package_contents():
            client = await self._get_client()
            return await client.get_package_contents(project_name, package_name)
        
        return self._run_async(_get_package_contents())
    
    def get_model_text(self, project_name: str, package_name: str, model_path: str) -> str:
        """Get raw text content of a model file"""
        async def _get_model_text():
            client = await self._get_client()
            return await client.get_model_text(project_name, package_name, model_path)
        
        return self._run_async(_get_model_text())
    
    def execute_query(self, project_name: str, package_name: str, model_path: str, 
                     query: Optional[str] = None, query_name: Optional[str] = None, 
                     source_name: Optional[str] = None) -> Dict[str, Any]:
        """Execute a Malloy query"""
        async def _execute_query():
            client = await self._get_client()
            return await client.execute_query(
                project_name=project_name,
                package_name=package_name, 
                model_path=model_path,
                query=query,
                query_name=query_name,
                source_name=source_name
            )
        
        return self._run_async(_execute_query())
    
    def health_check(self) -> bool:
        """Check if MCP server is healthy"""
        async def _health_check():
            try:
                client = await self._get_client()
                return await client.health_check()
            except Exception as e:
                logger.error(f"Health check failed: {e}")
                return False
        
        return self._run_async(_health_check())
    
    def __del__(self):
        """Cleanup when adapter is destroyed"""
        if self._client:
            try:
                asyncio.run(self._client.close())
            except Exception as e:
                logger.warning(f"Error closing client during cleanup: {e}")


# For backward compatibility, we can also create an alias
class MalloyMCPClient(MalloyMCPClientAdapter):
    """
    Alias for backward compatibility.
    This maintains the exact same class name as the original.
    """
    pass