#!/usr/bin/env python3
"""
Conversation Performance Test
Compare actual question processing speed between Phase 1 and Phase 2
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

def test_question_processing_performance():
    """Test actual question processing speed - the critical metric"""
    
    print("⚡ Conversation Performance Test")
    print("=" * 60)
    
    openai_key = os.getenv('OPENAI_API_KEY')
    if not openai_key:
        print("⏭️  Skipping conversation test (no OpenAI API key)")
        print("Set OPENAI_API_KEY to test actual conversation performance")
        return
    
    mcp_url = "http://localhost:4040/mcp"
    
    # Test questions (from simple to complex)
    test_questions = [
        "Hello, can you help me?",
        "What projects are available?", 
        "Show me the available packages in malloy-samples",
        "What fields are available in the ecommerce model?"
    ]
    
    print(f"Testing {len(test_questions)} questions with both agents...")
    print()
    
    # Initialize agents once (this is the slow part we already measured)
    print("🔄 Initializing agents...")
    init_start = time.time()
    
    try:
        from malloy_agent_simple import SimpleMalloyAgent
        phase1_agent = SimpleMalloyAgent(
            openai_api_key=openai_key,
            mcp_url=mcp_url,
            llm_provider="openai",
            llm_model="gpt-4o"
        )
        print("✅ Phase 1 agent ready")
    except Exception as e:
        print(f"❌ Phase 1 initialization failed: {e}")
        return
    
    try:
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        phase2_agent = LangChainCompatibilityAdapter(
            openai_api_key=openai_key,
            mcp_url=mcp_url,
            llm_provider="openai",
            llm_model="gpt-4o"
        )
        print("✅ Phase 2 agent ready")
    except Exception as e:
        print(f"❌ Phase 2 initialization failed: {e}")
        return
    
    init_time = time.time() - init_start
    print(f"⏱️  Total initialization: {init_time:.2f}s")
    print()
    
    # Test question processing performance
    phase1_times = []
    phase2_times = []
    
    for i, question in enumerate(test_questions, 1):
        print(f"🔍 Question {i}: {question}")
        print("-" * 40)
        
        # Test Phase 1
        print("Testing Phase 1...")
        start_time = time.time()
        try:
            success1, response1, history1 = phase1_agent.process_user_question(question)
            phase1_time = time.time() - start_time
            phase1_times.append(phase1_time)
            
            status = "✅" if success1 else "❌"
            response_preview = response1[:50] + "..." if len(response1) > 50 else response1
            print(f"  {status} Phase 1: {phase1_time:.2f}s - {response_preview}")
            
        except Exception as e:
            print(f"  ❌ Phase 1 failed: {e}")
            phase1_times.append(float('inf'))
        
        # Small delay between tests
        time.sleep(1)
        
        # Test Phase 2
        print("Testing Phase 2...")
        start_time = time.time()
        try:
            success2, response2, history2 = phase2_agent.process_user_question(question)
            phase2_time = time.time() - start_time
            phase2_times.append(phase2_time)
            
            status = "✅" if success2 else "❌"
            response_preview = response2[:50] + "..." if len(response2) > 50 else response2
            print(f"  {status} Phase 2: {phase2_time:.2f}s - {response_preview}")
            
        except Exception as e:
            print(f"  ❌ Phase 2 failed: {e}")
            phase2_times.append(float('inf'))
        
        # Compare this question
        if phase1_times[-1] != float('inf') and phase2_times[-1] != float('inf'):
            if phase2_times[-1] < phase1_times[-1]:
                improvement = ((phase1_times[-1] - phase2_times[-1]) / phase1_times[-1]) * 100
                print(f"  🚀 Phase 2 faster by {improvement:.1f}%")
            else:
                slowdown = ((phase2_times[-1] - phase1_times[-1]) / phase1_times[-1]) * 100
                print(f"  ⚠️ Phase 2 slower by {slowdown:.1f}%")
        
        print()
    
    # Overall analysis
    print("=" * 60)
    print("📊 Conversation Performance Analysis")
    print("=" * 60)
    
    # Filter out failed attempts
    valid_phase1 = [t for t in phase1_times if t != float('inf')]
    valid_phase2 = [t for t in phase2_times if t != float('inf')]
    
    if valid_phase1 and valid_phase2:
        avg_phase1 = sum(valid_phase1) / len(valid_phase1)
        avg_phase2 = sum(valid_phase2) / len(valid_phase2)
        
        print(f"Average Response Time:")
        print(f"  Phase 1: {avg_phase1:.2f}s")
        print(f"  Phase 2: {avg_phase2:.2f}s")
        
        if avg_phase2 < avg_phase1:
            improvement = ((avg_phase1 - avg_phase2) / avg_phase1) * 100
            print(f"  🚀 Phase 2 is {improvement:.1f}% faster on average")
        else:
            slowdown = ((avg_phase2 - avg_phase1) / avg_phase1) * 100
            print(f"  ⚠️ Phase 2 is {slowdown:.1f}% slower on average")
        
        # Per-question breakdown
        print(f"\nPer-Question Breakdown:")
        for i, (q, t1, t2) in enumerate(zip(test_questions, phase1_times, phase2_times), 1):
            if t1 != float('inf') and t2 != float('inf'):
                diff = ((t2 - t1) / t1) * 100
                symbol = "🚀" if diff < 0 else "⚠️"
                print(f"  Q{i}: {diff:+.1f}% {symbol}")
        
        return {
            "avg_phase1": avg_phase1,
            "avg_phase2": avg_phase2,
            "phase1_times": valid_phase1,
            "phase2_times": valid_phase2
        }
    else:
        print("❌ Could not complete performance comparison")
        return None

def test_mcp_operation_performance():
    """Test MCP operations specifically (without LLM calls)"""
    
    print("\n🔧 MCP Operation Performance")
    print("=" * 60)
    
    mcp_url = "http://localhost:4040/mcp"
    
    # MCP operations to test
    mcp_operations = [
        ("health_check", lambda agent: agent.mcp_client.health_check()),
        ("list_projects", lambda agent: agent.call_tool("list_projects")),
        ("get_available_tools", lambda agent: agent.get_available_tools())
    ]
    
    try:
        # Initialize agents
        from malloy_agent_simple import SimpleMalloyAgent
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        phase1_agent = SimpleMalloyAgent(
            openai_api_key="test-key",  # Not needed for MCP operations
            mcp_url=mcp_url
        )
        
        phase2_agent = LangChainCompatibilityAdapter(
            openai_api_key="test-key", 
            mcp_url=mcp_url
        )
        
        print("Testing MCP operations (no LLM calls):")
        
        for op_name, op_func in mcp_operations:
            print(f"\n🔍 Testing {op_name}:")
            
            # Test Phase 1
            start_time = time.time()
            try:
                result1 = op_func(phase1_agent)
                phase1_time = time.time() - start_time
                print(f"  ✅ Phase 1: {phase1_time:.3f}s")
            except Exception as e:
                print(f"  ❌ Phase 1 failed: {e}")
                phase1_time = float('inf')
            
            # Test Phase 2
            start_time = time.time()
            try:
                result2 = op_func(phase2_agent)
                phase2_time = time.time() - start_time
                print(f"  ✅ Phase 2: {phase2_time:.3f}s")
            except Exception as e:
                print(f"  ❌ Phase 2 failed: {e}")
                phase2_time = float('inf')
            
            # Compare
            if phase1_time != float('inf') and phase2_time != float('inf'):
                if phase2_time < phase1_time:
                    improvement = ((phase1_time - phase2_time) / phase1_time) * 100
                    print(f"    🚀 Phase 2 faster by {improvement:.1f}%")
                else:
                    slowdown = ((phase2_time - phase1_time) / phase1_time) * 100
                    print(f"    ⚠️ Phase 2 slower by {slowdown:.1f}%")
        
    except Exception as e:
        print(f"❌ MCP operation test failed: {e}")

def test_scalability_simulation():
    """Simulate multiple concurrent requests"""
    
    print("\n📈 Scalability Simulation")
    print("=" * 60)
    
    openai_key = os.getenv('OPENAI_API_KEY')
    if not openai_key:
        print("⏭️  Skipping scalability test (no OpenAI API key)")
        return
    
    mcp_url = "http://localhost:4040/mcp"
    
    # Simulate 5 concurrent simple questions
    questions = [
        "What projects are available?",
        "List packages in malloy-samples", 
        "Show me the ecommerce model",
        "What are the available tools?",
        "Help me understand the data"
    ]
    
    print(f"Simulating {len(questions)} concurrent requests...")
    
    try:
        from malloy_agent_simple import SimpleMalloyAgent
        from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter
        
        # Test Phase 1 - Sequential (SimpleMalloyAgent is not async)
        print("\n🔄 Phase 1 (Sequential):")
        phase1_agent = SimpleMalloyAgent(openai_api_key=openai_key, mcp_url=mcp_url)
        
        start_time = time.time()
        for i, question in enumerate(questions, 1):
            try:
                success, response, _ = phase1_agent.process_user_question(question)
                status = "✅" if success else "❌"
                print(f"  {status} Request {i} completed")
            except Exception as e:
                print(f"  ❌ Request {i} failed: {e}")
        
        phase1_total = time.time() - start_time
        print(f"  Total time: {phase1_total:.2f}s")
        print(f"  Average per request: {phase1_total/len(questions):.2f}s")
        
        # Test Phase 2 - Could be async (but testing sequential for fair comparison)
        print("\n🔄 Phase 2 (Sequential):")
        phase2_agent = LangChainCompatibilityAdapter(openai_api_key=openai_key, mcp_url=mcp_url)
        
        start_time = time.time()
        for i, question in enumerate(questions, 1):
            try:
                success, response, _ = phase2_agent.process_user_question(question)
                status = "✅" if success else "❌"
                print(f"  {status} Request {i} completed")
            except Exception as e:
                print(f"  ❌ Request {i} failed: {e}")
        
        phase2_total = time.time() - start_time
        print(f"  Total time: {phase2_total:.2f}s")
        print(f"  Average per request: {phase2_total/len(questions):.2f}s")
        
        # Compare
        if phase2_total < phase1_total:
            improvement = ((phase1_total - phase2_total) / phase1_total) * 100
            print(f"\n🚀 Phase 2 is {improvement:.1f}% faster for multiple requests")
        else:
            slowdown = ((phase2_total - phase1_total) / phase1_total) * 100
            print(f"\n⚠️ Phase 2 is {slowdown:.1f}% slower for multiple requests")
        
    except Exception as e:
        print(f"❌ Scalability test failed: {e}")

def main():
    """Run comprehensive conversation performance tests"""
    
    print("🧪 Conversation Performance Analysis")
    print("Testing where it matters most: actual question processing")
    print()
    
    # Test actual conversation performance
    conversation_results = test_question_processing_performance()
    
    # Test MCP operations
    test_mcp_operation_performance()
    
    # Test scalability
    test_scalability_simulation()
    
    # Summary
    print("\n" + "=" * 60)
    print("🎉 Conversation Performance Analysis Complete!")
    print()
    
    if conversation_results:
        avg_phase1 = conversation_results["avg_phase1"]
        avg_phase2 = conversation_results["avg_phase2"]
        
        if avg_phase2 < avg_phase1:
            improvement = ((avg_phase1 - avg_phase2) / avg_phase1) * 100
            print(f"🚀 Key Finding: Phase 2 is {improvement:.1f}% faster at processing questions")
        else:
            slowdown = ((avg_phase2 - avg_phase1) / avg_phase1) * 100
            print(f"⚠️ Key Finding: Phase 2 is {slowdown:.1f}% slower at processing questions")
        
        print(f"📊 Response Times:")
        print(f"   Phase 1: {avg_phase1:.2f}s average")
        print(f"   Phase 2: {avg_phase2:.2f}s average")
        
    print("\n📋 Performance Summary:")
    print("🐌 Initialization: Phase 2 slower (one-time cost)")
    print("⚡ Conversations: [Results above] (ongoing cost)")
    print("🎯 Recommendation: Focus on conversation performance for production")

if __name__ == "__main__":
    main()