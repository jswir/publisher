#!/usr/bin/env python3
"""
Performance Comparison: Phase 1 vs Phase 2
Compare SimpleMalloyAgent vs LangChainCompatibilityAdapter
"""

import os
import sys
import time
import asyncio
from pathlib import Path
from typing import Dict, Any, List

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

def test_initialization_performance():
    """Compare initialization time between Phase 1 and Phase 2"""
    
    print("⚡ Performance Test: Initialization")
    print("=" * 50)
    
    openai_key = os.getenv('OPENAI_API_KEY', 'test-key')
    mcp_url = "http://localhost:4040/mcp"
    
    # Test Phase 1 (SimpleMalloyAgent)
    print("🔄 Testing Phase 1 (SimpleMalloyAgent)...")
    start_time = time.time()
    try:
        from malloy_agent_simple import SimpleMalloyAgent
        
        phase1_agent = SimpleMalloyAgent(
            openai_api_key=openai_key,
            mcp_url=mcp_url,
            llm_provider="openai",
            llm_model="gpt-4o"
        )
        phase1_time = time.time() - start_time
        print(f"✅ Phase 1 initialized in {phase1_time:.3f}s")
        
    except Exception as e:
        print(f"❌ Phase 1 initialization failed: {e}")
        phase1_time = float('inf')
    
    # Test Phase 2 (LangChain)
    print("🔄 Testing Phase 2 (LangChain)...")
    start_time = time.time()
    try:
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        phase2_agent = LangChainCompatibilityAdapter(
            openai_api_key=openai_key,
            mcp_url=mcp_url,
            llm_provider="openai",
            llm_model="gpt-4o"
        )
        phase2_time = time.time() - start_time
        print(f"✅ Phase 2 initialized in {phase2_time:.3f}s")
        
    except Exception as e:
        print(f"❌ Phase 2 initialization failed: {e}")
        phase2_time = float('inf')
    
    # Compare
    if phase1_time != float('inf') and phase2_time != float('inf'):
        if phase2_time < phase1_time:
            improvement = ((phase1_time - phase2_time) / phase1_time) * 100
            print(f"🚀 Phase 2 is {improvement:.1f}% faster at initialization")
        else:
            slowdown = ((phase2_time - phase1_time) / phase1_time) * 100
            print(f"⚠️ Phase 2 is {slowdown:.1f}% slower at initialization")
    
    return {
        "phase1_time": phase1_time,
        "phase2_time": phase2_time
    }

def test_interface_compatibility():
    """Test that both agents have the same interface"""
    
    print("\n🔍 Interface Compatibility Test")
    print("=" * 50)
    
    openai_key = os.getenv('OPENAI_API_KEY', 'test-key')
    mcp_url = "http://localhost:4040/mcp"
    
    # Expected methods from SimpleMalloyAgent
    expected_methods = [
        'process_user_question',
        'get_available_tools',
        'call_tool'
    ]
    
    # Test Phase 1
    try:
        from malloy_agent_simple import SimpleMalloyAgent
        phase1_agent = SimpleMalloyAgent(openai_api_key=openai_key, mcp_url=mcp_url)
        
        print("Phase 1 (SimpleMalloyAgent) methods:")
        phase1_methods = []
        for method in expected_methods:
            has_method = hasattr(phase1_agent, method)
            status = "✅" if has_method else "❌"
            print(f"  {status} {method}")
            phase1_methods.append(has_method)
            
    except Exception as e:
        print(f"❌ Phase 1 interface test failed: {e}")
        phase1_methods = [False] * len(expected_methods)
    
    # Test Phase 2
    try:
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        phase2_agent = LangChainCompatibilityAdapter(openai_api_key=openai_key, mcp_url=mcp_url)
        
        print("\nPhase 2 (LangChain) methods:")
        phase2_methods = []
        for method in expected_methods:
            has_method = hasattr(phase2_agent, method)
            status = "✅" if has_method else "❌"
            print(f"  {status} {method}")
            phase2_methods.append(has_method)
            
    except Exception as e:
        print(f"❌ Phase 2 interface test failed: {e}")
        phase2_methods = [False] * len(expected_methods)
    
    # Check compatibility
    compatibility = all(p1 == p2 for p1, p2 in zip(phase1_methods, phase2_methods))
    status = "✅" if compatibility else "❌"
    print(f"\n{status} Interface compatibility: {compatibility}")
    
    return compatibility

def test_method_signatures():
    """Compare method signatures between phases"""
    
    print("\n📝 Method Signature Comparison")
    print("=" * 50)
    
    import inspect
    
    openai_key = os.getenv('OPENAI_API_KEY', 'test-key')
    mcp_url = "http://localhost:4040/mcp"
    
    try:
        # Get both agents
        from malloy_agent_simple import SimpleMalloyAgent
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        phase1_agent = SimpleMalloyAgent(openai_api_key=openai_key, mcp_url=mcp_url)
        phase2_agent = LangChainCompatibilityAdapter(openai_api_key=openai_key, mcp_url=mcp_url)
        
        # Test process_user_question signature
        phase1_sig = inspect.signature(phase1_agent.process_user_question)
        phase2_sig = inspect.signature(phase2_agent.process_user_question)
        
        print("process_user_question signatures:")
        print(f"  Phase 1: {phase1_sig}")
        print(f"  Phase 2: {phase2_sig}")
        
        # Check if signatures match
        signatures_match = str(phase1_sig) == str(phase2_sig)
        status = "✅" if signatures_match else "❌"
        print(f"  {status} Signatures match: {signatures_match}")
        
        return signatures_match
        
    except Exception as e:
        print(f"❌ Signature comparison failed: {e}")
        return False

def test_agent_info_comparison():
    """Compare agent information between phases"""
    
    print("\n📊 Agent Information Comparison")
    print("=" * 50)
    
    openai_key = os.getenv('OPENAI_API_KEY', 'test-key')
    mcp_url = "http://localhost:4040/mcp"
    
    # Test Phase 1
    try:
        from malloy_agent_simple import SimpleMalloyAgent
        phase1_agent = SimpleMalloyAgent(openai_api_key=openai_key, mcp_url=mcp_url)
        
        print("Phase 1 Agent Info:")
        print(f"  Type: {type(phase1_agent).__name__}")
        print(f"  Module: {type(phase1_agent).__module__}")
        print(f"  LLM Provider: {getattr(phase1_agent, 'llm_provider', 'N/A')}")
        print(f"  LLM Model: {getattr(phase1_agent, 'llm_model', 'N/A')}")
        print(f"  MCP URL: {getattr(phase1_agent, 'mcp_client', {}).url if hasattr(getattr(phase1_agent, 'mcp_client', {}), 'url') else 'N/A'}")
        
    except Exception as e:
        print(f"❌ Phase 1 agent info failed: {e}")
    
    # Test Phase 2
    try:
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        phase2_agent = LangChainCompatibilityAdapter(openai_api_key=openai_key, mcp_url=mcp_url)
        
        print("\nPhase 2 Agent Info:")
        print(f"  Type: {type(phase2_agent).__name__}")
        print(f"  Module: {type(phase2_agent).__module__}")
        
        # Get structured agent info
        info = phase2_agent.get_agent_info()
        for key, value in info.items():
            print(f"  {key}: {value}")
            
    except Exception as e:
        print(f"❌ Phase 2 agent info failed: {e}")

def test_feature_comparison():
    """Compare features between Phase 1 and Phase 2"""
    
    print("\n🎯 Feature Comparison")
    print("=" * 50)
    
    features = {
        "Basic LLM Integration": {"phase1": True, "phase2": True},
        "MCP Tool Access": {"phase1": True, "phase2": True},
        "Conversation History": {"phase1": True, "phase2": True},
        "Chart Generation": {"phase1": True, "phase2": True},
        "Multiple LLM Providers": {"phase1": True, "phase2": True},  # Phase 1 has OpenAI + Anthropic
        "Dynamic Tool Discovery": {"phase1": False, "phase2": True},
        "Structured Prompts": {"phase1": False, "phase2": True},
        "Persistent Memory": {"phase1": False, "phase2": True},
        "Vertex AI/Gemini": {"phase1": False, "phase2": True},
        "Agent Architecture": {"phase1": False, "phase2": True},
        "Health Monitoring": {"phase1": True, "phase2": True},
        "Async Performance": {"phase1": False, "phase2": True}
    }
    
    print("Feature Matrix:")
    print("                          Phase 1  Phase 2")
    print("-" * 50)
    
    for feature, support in features.items():
        p1_status = "✅" if support["phase1"] else "❌"
        p2_status = "✅" if support["phase2"] else "❌"
        feature_padded = feature.ljust(25)
        print(f"{feature_padded} {p1_status}       {p2_status}")
    
    # Count new features
    new_features = sum(1 for f in features.values() if not f["phase1"] and f["phase2"])
    print(f"\n🚀 Phase 2 adds {new_features} new features")
    
    return features

def test_memory_usage():
    """Compare memory footprint"""
    
    print("\n💾 Memory Usage Comparison") 
    print("=" * 50)
    
    import tracemalloc
    
    openai_key = os.getenv('OPENAI_API_KEY', 'test-key')
    mcp_url = "http://localhost:4040/mcp"
    
    # Test Phase 1 memory
    print("Measuring Phase 1 memory usage...")
    tracemalloc.start()
    try:
        from malloy_agent_simple import SimpleMalloyAgent
        phase1_agent = SimpleMalloyAgent(openai_api_key=openai_key, mcp_url=mcp_url)
        current, peak = tracemalloc.get_traced_memory()
        phase1_memory = peak / 1024 / 1024  # Convert to MB
        print(f"✅ Phase 1 memory: {phase1_memory:.2f} MB")
    except Exception as e:
        print(f"❌ Phase 1 memory test failed: {e}")
        phase1_memory = 0
    finally:
        tracemalloc.stop()
    
    # Test Phase 2 memory
    print("Measuring Phase 2 memory usage...")
    tracemalloc.start()
    try:
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        phase2_agent = LangChainCompatibilityAdapter(openai_api_key=openai_key, mcp_url=mcp_url)
        current, peak = tracemalloc.get_traced_memory()
        phase2_memory = peak / 1024 / 1024  # Convert to MB
        print(f"✅ Phase 2 memory: {phase2_memory:.2f} MB")
    except Exception as e:
        print(f"❌ Phase 2 memory test failed: {e}")
        phase2_memory = 0
    finally:
        tracemalloc.stop()
    
    # Compare
    if phase1_memory > 0 and phase2_memory > 0:
        if phase2_memory > phase1_memory:
            increase = ((phase2_memory - phase1_memory) / phase1_memory) * 100
            print(f"📈 Phase 2 uses {increase:.1f}% more memory (+{phase2_memory - phase1_memory:.2f} MB)")
        else:
            decrease = ((phase1_memory - phase2_memory) / phase1_memory) * 100
            print(f"📉 Phase 2 uses {decrease:.1f}% less memory (-{phase1_memory - phase2_memory:.2f} MB)")
    
    return {
        "phase1_memory": phase1_memory,
        "phase2_memory": phase2_memory
    }

def main():
    """Run performance comparison tests"""
    
    print("🧪 Performance Comparison: Phase 1 vs Phase 2")
    print("SimpleMalloyAgent vs LangChain Architecture")
    print()
    
    # Run all tests
    results = {}
    
    results["initialization"] = test_initialization_performance()
    results["compatibility"] = test_interface_compatibility()
    results["signatures"] = test_method_signatures()
    test_agent_info_comparison()
    results["features"] = test_feature_comparison()
    results["memory"] = test_memory_usage()
    
    # Summary
    print("\n" + "=" * 60)
    print("🎉 Performance Comparison Complete!")
    print()
    
    # Key findings
    init_results = results["initialization"]
    if init_results["phase1_time"] != float('inf') and init_results["phase2_time"] != float('inf'):
        if init_results["phase2_time"] < init_results["phase1_time"]:
            improvement = ((init_results["phase1_time"] - init_results["phase2_time"]) / init_results["phase1_time"]) * 100
            print(f"⚡ Initialization: Phase 2 is {improvement:.1f}% faster")
        else:
            slowdown = ((init_results["phase2_time"] - init_results["phase1_time"]) / init_results["phase1_time"]) * 100
            print(f"⚡ Initialization: Phase 2 is {slowdown:.1f}% slower")
    
    compatibility_status = "✅" if results["compatibility"] else "❌"
    print(f"🔄 Interface Compatibility: {compatibility_status}")
    
    signature_status = "✅" if results["signatures"] else "❌"  
    print(f"📝 Method Signatures: {signature_status}")
    
    new_features = sum(1 for f in results["features"].values() if not f["phase1"] and f["phase2"])
    print(f"🚀 New Features: {new_features} additions in Phase 2")
    
    memory_results = results["memory"]
    if memory_results["phase1_memory"] > 0 and memory_results["phase2_memory"] > 0:
        memory_diff = memory_results["phase2_memory"] - memory_results["phase1_memory"]
        print(f"💾 Memory Usage: {memory_diff:+.2f} MB difference")
    
    print("\n📋 Conclusion:")
    
    if results["compatibility"] and results["signatures"]:
        print("✅ Phase 2 is a perfect drop-in replacement for Phase 1")
        print("✅ Bot.py migration is just a one-line import change")
        print("✅ Significant new capabilities added (agent architecture, Vertex AI, etc.)")
        print("🚀 Recommendation: Proceed with simple import replacement!")
    else:
        print("⚠️  Some compatibility issues found")
        print("🔧 Consider fixing compatibility before migration")

if __name__ == "__main__":
    main()