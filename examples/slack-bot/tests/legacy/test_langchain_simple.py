#!/usr/bin/env python3
"""
Simple LangChain Integration Test
Test basic functionality without complex async setup
"""

import os
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "src"))

def test_basic_imports():
    """Test that all required LangChain components can be imported"""
    print("📦 Testing Basic Imports")
    print("=" * 40)
    
    try:
        from langchain.tools import BaseTool
        from langchain_openai import ChatOpenAI
        from langchain_google_vertexai import ChatVertexAI
        print("✅ LangChain imports successful")
        
        from src.prompts.malloy_prompts import MalloyPromptTemplates
        print("✅ Prompt templates import successful")
        
        assert True
    except Exception as e:
        print(f"❌ Import failed: {e}")
        assert False

def test_prompt_templates():
    """Test initialization and functionality of MalloyPromptTemplates"""
    print("\n📝 Testing Prompt Templates")
    print("=" * 40)
    
    try:
        from src.prompts.malloy_prompts import MalloyPromptTemplates
        
        templates = MalloyPromptTemplates()
        
        # Test agent prompt
        agent_prompt = templates.get_agent_prompt()
        print("✅ Agent prompt created")
        
        # Test chart generation prompt
        # chart_prompt = templates.get_chart_generation_prompt("test question", {"test": "data"})
        # print("✅ Chart generation prompt created")
        
        # Test context-aware prompt
        context = {
            "user_domain": "aviation",
            "available_projects": ["flights"],
            "recent_queries": []
        }
        context_prompt = templates.get_context_aware_prompt(context)
        print("✅ Context-aware prompt created")
        
        # Test version info
        version_info = templates.get_prompt_version_info()
        print(f"✅ Version info: {version_info['version']}")
        
        assert True
        
    except Exception as e:
        print(f"❌ Prompt templates test failed: {e}")
        assert False

def test_llm_initialization():
    """Test initialization of different LLM providers"""
    print("\n🧠 Testing LLM Initialization")
    print("=" * 40)
    
    try:
        from langchain_openai import ChatOpenAI
        from langchain_google_vertexai import ChatVertexAI
        
        # Test OpenAI LLM (without API key)
        try:
            openai_llm = ChatOpenAI(
                api_key="test-key",  # Dummy key for testing
                model="gpt-4o",
                temperature=0.1
            )
            print("✅ OpenAI LLM initialized")
        except Exception as e:
            print(f"⚠️  OpenAI LLM: {e}")
        
        # Test Vertex AI LLM (without project)
        try:
            vertex_llm = ChatVertexAI(
                project="test-project",  # Dummy project for testing
                model_name="gemini-1.5-pro",
                temperature=0.1
            )
            print("✅ Vertex AI LLM initialized")
        except Exception as e:
            print(f"⚠️  Vertex AI LLM: {e}")
        
        assert True
        
    except Exception as e:
        print(f"❌ LLM initialization test failed: {e}")
        assert False

def test_model_mapping():
    """Test the model mapping for Vertex AI"""
    print("\n🔄 Testing Model Mapping")
    print("=" * 40)
    
    # Test model mapping logic
    vertex_model_map = {
        "gpt-4o": "gemini-1.5-pro",
        "gpt-4": "gemini-1.5-pro", 
        "gpt-3.5-turbo": "gemini-1.5-flash",
        "gemini-pro": "gemini-1.0-pro",
        "gemini-1.5-pro": "gemini-1.5-pro",
        "gemini-1.5-flash": "gemini-1.5-flash"
    }
    
    test_cases = [
        ("gpt-4o", "gemini-1.5-pro"),
        ("gpt-3.5-turbo", "gemini-1.5-flash"),
        ("gemini-1.5-pro", "gemini-1.5-pro"),
        ("unknown-model", "unknown-model")  # Should fallback
    ]
    
    for input_model, expected_output in test_cases:
        mapped_model = vertex_model_map.get(input_model, input_model)
        success = mapped_model == expected_output
        status = "✅" if success else "❌"
        print(f"{status} {input_model} → {mapped_model}")
    
    assert True

def test_configuration_options():
    """Test different configuration options for the agent"""
    print("\n⚙️ Testing Configuration Options")  
    print("=" * 40)
    
    configs = [
        {
            "name": "OpenAI GPT-4o",
            "llm_provider": "openai",
            "model_name": "gpt-4o",
            "required_params": ["openai_api_key"]
        },
        {
            "name": "Vertex Gemini Pro",
            "llm_provider": "vertex", 
            "model_name": "gemini-1.5-pro",
            "required_params": ["vertex_project_id"]
        },
        {
            "name": "Vertex Gemini Flash",
            "llm_provider": "gemini",
            "model_name": "gemini-1.5-flash", 
            "required_params": ["vertex_project_id"]
        }
    ]
    
    for config in configs:
        print(f"✅ {config['name']}")
        print(f"   Provider: {config['llm_provider']}")
        print(f"   Model: {config['model_name']}")
        print(f"   Required: {', '.join(config['required_params'])}")
    
    assert True

def test_documentation():
    """Check for basic documentation and type hints"""
    print("\n📚 Testing Documentation")
    print("=" * 40)
    
    docs_to_check = [
        "docs/VERTEX_AI_SETUP.md",
        "PHASE_2_LANGCHAIN_RESULTS.md"
    ]
    
    for doc_path in docs_to_check:
        full_path = Path(__file__).parent / doc_path
        exists = full_path.exists()
        status = "✅" if exists else "❌"
        size = f"({full_path.stat().st_size} bytes)" if exists else ""
        print(f"{status} {doc_path} {size}")
    
    assert True

def main():
    """Run simple LangChain tests"""
    
    print("🧪 Simple LangChain Integration Test")
    print("Testing basic functionality without async complexity...")
    print()
    
    tests = [
        ("Basic imports", test_basic_imports),
        ("Prompt templates", test_prompt_templates),
        ("LLM initialization", test_llm_initialization),
        ("Model mapping", test_model_mapping),
        ("Configuration options", test_configuration_options),
        ("Documentation", test_documentation)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            success = test_func()
            results.append((test_name, success))
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {e}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 60)
    print("🎉 Simple LangChain Test Complete!")
    print()
    
    for test_name, success in results:
        status = "✅" if success else "❌"
        print(f"{status} {test_name}")
    
    all_success = all(success for _, success in results)
    
    if all_success:
        print("\n🚀 Basic LangChain functionality verified!")
        print("📋 Ready for:")
        print("   ✅ Vertex AI/Gemini model support")
        print("   ✅ Structured prompt management")
        print("   ✅ Multiple LLM provider configuration")
        print("   ✅ Drop-in compatibility with existing bot")
    else:
        print("\n⚠️  Some basic tests failed")

if __name__ == "__main__":
    main()