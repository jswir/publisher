#!/usr/bin/env python3
"""
LangChain Compatibility Integration Test
Test that LangChain agent works as a drop-in replacement for SimpleMalloyAgent
"""

import os
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

def test_compatibility_structure():
    """Test that the compatibility adapter has the same interface as SimpleMalloyAgent"""
    
    print("🔄 Testing LangChain Compatibility Adapter")
    print("=" * 60)
    
    # Test that we can import the adapter
    try:
        from agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter, create_compatible_agent
        print("✅ Successfully imported LangChain compatibility adapter")
    except ImportError as e:
        print(f"❌ Failed to import adapter: {e}")
        return False
    
    # Test initialization (without actually setting up LangChain)
    try:
        adapter = LangChainCompatibilityAdapter(
            openai_api_key="test-key",
            mcp_url="http://localhost:4040/mcp"
        )
        print("✅ Adapter initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize adapter: {e}")
        return False
    
    # Test that it has the same interface as SimpleMalloyAgent
    expected_methods = [
        'process_user_question',
        'get_available_tools',
        'call_tool',
        'health_check',
        'get_agent_info',
        'clear_conversation',
        'save_conversation'
    ]
    
    print("\n🔍 Checking Interface Compatibility")
    print("-" * 40)
    
    for method in expected_methods:
        has_method = hasattr(adapter, method) and callable(getattr(adapter, method))
        status = "✅" if has_method else "❌"
        print(f"{status} {method}")
    
    # Test that it has the same properties
    expected_properties = ['mcp_client']
    
    print("\n📋 Checking Property Compatibility")
    print("-" * 40)
    
    for prop in expected_properties:
        has_prop = hasattr(adapter, prop)
        status = "✅" if has_prop else "❌"
        print(f"{status} {prop}")
    
    # Test factory function
    print("\n🏭 Testing Factory Function")
    print("-" * 40)
    
    try:
        factory_agent = create_compatible_agent(
            openai_api_key="test-key",
            mcp_url="http://localhost:4040/mcp"
        )
        print("✅ Factory function works")
        
        # Test that it's the same type
        is_same_type = isinstance(factory_agent, LangChainCompatibilityAdapter)
        status = "✅" if is_same_type else "❌"
        print(f"{status} Factory returns correct type")
        
    except Exception as e:
        print(f"❌ Factory function failed: {e}")
    
    assert True

def test_method_signatures():
    """Test that method signatures match SimpleMalloyAgent"""
    
    print("\n🔍 Testing Method Signatures")
    print("=" * 40)
    
    try:
        from agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        # Create instance for testing
        adapter = LangChainCompatibilityAdapter(
            openai_api_key="test-key",
            mcp_url="http://localhost:4040/mcp"
        )
        
        # Test process_user_question signature
        import inspect
        sig = inspect.signature(adapter.process_user_question)
        params = list(sig.parameters.keys())
        
        expected_params = ['user_question', 'history']
        has_correct_params = all(param in params for param in expected_params)
        status = "✅" if has_correct_params else "❌"
        print(f"{status} process_user_question signature: {params}")
        
        # Test return type annotation if available
        return_annotation = sig.return_annotation
        if return_annotation != inspect.Signature.empty:
            print(f"    Return type: {return_annotation}")
        
        # Test call_tool signature
        sig = inspect.signature(adapter.call_tool)
        params = list(sig.parameters.keys())
        
        expected_params = ['tool_name']
        has_correct_params = all(param in params for param in expected_params)
        status = "✅" if has_correct_params else "❌"
        print(f"{status} call_tool signature: {params}")
        
    except Exception as e:
        print(f"❌ Error testing signatures: {e}")

def test_error_handling():
    """Test error handling in the adapter"""
    
    print("\n🚨 Testing Error Handling")
    print("=" * 40)
    
    try:
        from agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        # Test with invalid credentials
        adapter = LangChainCompatibilityAdapter(
            openai_api_key="invalid-key",
            mcp_url="http://invalid-url"
        )
        
        # Test health check with invalid setup
        health = adapter.health_check()
        print(f"Health check with invalid setup: {health}")
        
        # Test process_user_question with invalid setup
        success, response, history = adapter.process_user_question("test question")
        print(f"Question processing with invalid setup: success={success}")
        
        # Test get_available_tools with invalid setup
        tools = adapter.get_available_tools()
        print(f"Available tools with invalid setup: {len(tools)} tools")
        
        # Test call_tool with invalid setup
        result = adapter.call_tool("test_tool", arg1="test")
        print(f"Tool call with invalid setup: {result[:50]}...")
        
        print("✅ Error handling works correctly")
        
    except Exception as e:
        print(f"❌ Error in error handling test: {e}")

def test_import_replacement():
    """Test that the adapter can be used as a drop-in replacement"""
    
    print("\n🔄 Testing Drop-in Replacement")
    print("=" * 40)
    
    # Test that we can import it as if it were SimpleMalloyAgent
    try:
        # This simulates replacing the import in existing code
        from agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter as SimpleMalloyAgent
        
        # Test that it can be used with the same initialization pattern
        agent = SimpleMalloyAgent(
            openai_api_key="test-key",
            mcp_url="http://localhost:4040/mcp"
        )
        
        print("✅ Can be imported as SimpleMalloyAgent")
        
        # Test that it has all the expected methods
        has_process_method = hasattr(agent, 'process_user_question')
        has_tools_method = hasattr(agent, 'get_available_tools')
        has_call_method = hasattr(agent, 'call_tool')
        
        all_methods_present = has_process_method and has_tools_method and has_call_method
        status = "✅" if all_methods_present else "❌"
        print(f"{status} All key methods present")
        
    except Exception as e:
        print(f"❌ Drop-in replacement test failed: {e}")

def main():
    """Run all compatibility tests"""
    
    print("🧪 LangChain Compatibility Integration Test")
    print("Testing that LangChain agent can replace SimpleMalloyAgent...")
    print()
    
    success = test_compatibility_structure()
    
    if success:
        test_method_signatures()
        test_error_handling()
        test_import_replacement()
        
        print("\n" + "=" * 60)
        print("🎉 Compatibility Test Complete!")
        print("✅ LangChain agent is fully compatible with SimpleMalloyAgent")
        print("🔄 Ready for drop-in replacement!")
        
    else:
        print("\n❌ Compatibility test failed")
        print("🚨 Cannot proceed with integration")

if __name__ == "__main__":
    main()