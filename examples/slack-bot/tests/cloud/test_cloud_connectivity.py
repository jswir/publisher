#!/usr/bin/env python3
"""
Quick test script to validate local bot → cloud MCP connectivity
Run this before deploying to ensure everything works end-to-end
"""

import os
import sys
from dotenv import load_dotenv

def test_cloud_connectivity():
    """Test connectivity to cloud MCP server"""
    print("🧪 Testing Local Bot → Cloud MCP Connectivity")
    print("=" * 50)
    
    # Load environment variables
    load_dotenv()
    
    # Override MCP_URL to point to cloud
    cloud_mcp_url = "https://malloy-mcp-server-fixed-234201753528.us-central1.run.app/mcp"
    os.environ["MCP_URL"] = cloud_mcp_url
    
    print(f"🌐 Cloud MCP URL: {cloud_mcp_url}")
    
    try:
        # Test 1: Import and initialize bot components
        print("\n1️⃣ Testing bot initialization...")
        from src.clients.enhanced_mcp_client import EnhancedMCPClient
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        print("   ✅ Imports successful")
        
        # Test 2: Create MCP client
        print("\n2️⃣ Testing MCP client connection...")
        from src.clients.enhanced_mcp_client import MCPConfig
        config = MCPConfig(url=cloud_mcp_url)
        mcp_client = EnhancedMCPClient(config=config)
        print("   ✅ MCP client created")
        
        # Test 3: Health check
        print("\n3️⃣ Testing MCP health check...")
        is_healthy = mcp_client.health_check()
        if is_healthy:
            print("   ✅ MCP server is healthy")
        else:
            print("   ❌ MCP server health check failed")
            return False
        
        # Test 4: Initialize full adapter
        print("\n4️⃣ Testing LangChain adapter...")
        adapter = LangChainCompatibilityAdapter(
            openai_api_key=os.environ.get("OPENAI_API_KEY"),
            mcp_url=cloud_mcp_url,
            llm_provider="openai",
            model_name="gpt-4o"
        )
        print("   ✅ LangChain adapter initialized")
        
        # Test 5: Simple query
        print("\n5️⃣ Testing simple query...")
        success, response, history = adapter.process_user_question(
            "What datasets are available?",
            history=None
        )
        
        if success:
            print("   ✅ Query successful!")
            print(f"   📝 Response length: {len(response)} characters")
            print(f"   🧠 History entries: {len(history) if history else 0}")
        else:
            print(f"   ❌ Query failed: {response}")
            return False
        
        print("\n🎉 ALL TESTS PASSED!")
        print("✅ Local bot can successfully connect to cloud MCP server")
        print("\n🚀 Ready for cloud deployment!")
        return True
        
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_cloud_connectivity()
    sys.exit(0 if success else 1) 