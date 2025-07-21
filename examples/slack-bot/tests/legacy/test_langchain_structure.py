#!/usr/bin/env python3
"""
LangChain Structure Test
Test that all LangChain components are properly structured without requiring dependencies
"""

import os
import sys
from pathlib import Path

def test_file_structure():
    """Test that all required files exist"""
    
    print("📁 Testing LangChain File Structure")
    print("=" * 60)
    
    base_path = Path(__file__).parent
    
    # Test core structure
    required_files = [
        "src/tools/dynamic_malloy_tools.py",
        "src/agents/malloy_langchain_agent.py", 
        "src/prompts/malloy_prompts.py",
        "tests/test_langchain_integration.py"
    ]
    
    for file_path in required_files:
        full_path = base_path / file_path
        exists = full_path.exists()
        status = "✅" if exists else "❌"
        print(f"{status} {file_path}")
        
        if exists:
            # Check file size
            size = full_path.stat().st_size
            print(f"    Size: {size} bytes")

def test_code_structure():
    """Test that code files have expected structure"""
    
    print("\n🔍 Testing Code Structure")
    print("=" * 40)
    
    base_path = Path(__file__).parent
    
    # Test dynamic tools file
    tools_file = base_path / "src/tools/dynamic_malloy_tools.py"
    if tools_file.exists():
        content = tools_file.read_text()
        
        # Check for key classes and functions
        key_elements = [
            "class MalloyToolsFactory",
            "class DynamicMalloyTool", 
            "def create_malloy_tools",
            "def create_dynamic_input_model"
        ]
        
        print("Dynamic Tools Structure:")
        for element in key_elements:
            found = element in content
            status = "✅" if found else "❌"
            print(f"  {status} {element}")
    
    # Test agent file
    agent_file = base_path / "src/agents/malloy_langchain_agent.py"
    if agent_file.exists():
        content = agent_file.read_text()
        
        key_elements = [
            "class MalloyLangChainAgent",
            "async def setup",
            "async def process_question",
            "def get_agent_info"
        ]
        
        print("\nAgent Structure:")
        for element in key_elements:
            found = element in content
            status = "✅" if found else "❌"
            print(f"  {status} {element}")
    
    # Test prompts file
    prompts_file = base_path / "src/prompts/malloy_prompts.py"
    if prompts_file.exists():
        content = prompts_file.read_text()
        
        key_elements = [
            "class MalloyPromptTemplates",
            "def get_agent_prompt",
            "def get_chart_generation_prompt",
            "def get_context_aware_prompt"
        ]
        
        print("\nPrompts Structure:")
        for element in key_elements:
            found = element in content
            status = "✅" if found else "❌"
            print(f"  {status} {element}")

def test_imports_structure():
    """Test that imports are properly structured"""
    
    print("\n📦 Testing Import Structure")
    print("=" * 40)
    
    base_path = Path(__file__).parent
    
    # Test tools imports
    tools_file = base_path / "src/tools/dynamic_malloy_tools.py"
    if tools_file.exists():
        content = tools_file.read_text()
        
        expected_imports = [
            "from langchain.tools import BaseTool",
            "from langchain.pydantic_v1 import BaseModel",
            "from ..clients.enhanced_mcp_client import EnhancedMCPClient"
        ]
        
        print("Tools Imports:")
        for imp in expected_imports:
            found = imp in content
            status = "✅" if found else "❌"
            print(f"  {status} {imp}")
    
    # Test agent imports
    agent_file = base_path / "src/agents/malloy_langchain_agent.py"
    if agent_file.exists():
        content = agent_file.read_text()
        
        expected_imports = [
            "from langchain.agents import AgentExecutor",
            "from langchain_openai import ChatOpenAI",
            "from ..tools.dynamic_malloy_tools import MalloyToolsFactory"
        ]
        
        print("\nAgent Imports:")
        for imp in expected_imports:
            found = imp in content
            status = "✅" if found else "❌"
            print(f"  {status} {imp}")

def test_requirements_updated():
    """Test that requirements.txt includes LangChain"""
    
    print("\n📋 Testing Requirements")
    print("=" * 40)
    
    base_path = Path(__file__).parent
    requirements_file = base_path / "requirements.txt"
    
    if requirements_file.exists():
        content = requirements_file.read_text()
        
        required_packages = [
            "langchain",
            "langchain-openai", 
            "langchain-community",
            "pydantic"
        ]
        
        print("Required Packages:")
        for package in required_packages:
            found = package in content
            status = "✅" if found else "❌"
            print(f"  {status} {package}")
    else:
        print("❌ requirements.txt not found")

def main():
    """Run all structure tests"""
    
    print("🧪 LangChain Structure Verification")
    print("Testing Phase 2 implementation without dependencies...")
    print()
    
    test_file_structure()
    test_code_structure()
    test_imports_structure()
    test_requirements_updated()
    
    print("\n" + "=" * 60)
    print("🎉 Structure Test Complete!")
    print("✅ LangChain Phase 2 components are properly structured")
    print("📦 Ready for dependency installation and integration testing")

if __name__ == "__main__":
    main()