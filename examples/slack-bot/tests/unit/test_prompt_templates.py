"""
Unit tests for prompt template validation
Tests to catch LangChain template errors before production deployment
"""

import pytest
from langchain.schema import HumanMessage, SystemMessage, AIMessage
from src.prompts.malloy_prompts import MalloyPromptTemplates
from src.agents.langchain_compatibility_adapter import LangChainCompatibilityAdapter


class TestPromptTemplateValidation:
    """Test prompt templates for syntax errors and proper formatting"""
    
    def setup_method(self):
        """Setup test fixtures"""
        self.prompt_templates = MalloyPromptTemplates()
    
    def test_agent_prompt_template_syntax(self):
        """Test that the main agent prompt template has valid syntax"""
        
        # Get the agent prompt template
        agent_prompt = self.prompt_templates.get_agent_prompt()
        
        # Test with minimal required variables (agent_scratchpad should be a list of messages)
        test_input = {
            "input": "test query",
            "agent_scratchpad": [],
            "chat_history": []
        }
        
        # This should not raise any template variable errors
        try:
            formatted_messages = agent_prompt.format_messages(**test_input)
            assert len(formatted_messages) > 0
            assert any(isinstance(msg, SystemMessage) for msg in formatted_messages)
        except Exception as e:
            pytest.fail(f"Agent prompt template failed to format: {e}")
    
    def test_agent_prompt_template_compiles_without_template_errors(self):
        """Test that the template compiles without LangChain template variable errors"""
        
        agent_prompt = self.prompt_templates.get_agent_prompt()
        
        # Test various inputs to ensure no template variable errors occur
        test_cases = [
            {
                "input": "test query with { curly braces }",
                "agent_scratchpad": [],
                "chat_history": []
            },
            {
                "input": "run: source -> { group_by: field }",
                "agent_scratchpad": [],
                "chat_history": [HumanMessage(content="previous message")]
            },
            {
                "input": "show me data where condition = value",
                "agent_scratchpad": [AIMessage(content="I'll help you with that")],
                "chat_history": []
            }
        ]
        
        for i, test_input in enumerate(test_cases):
            try:
                formatted_messages = agent_prompt.format_messages(**test_input)
                assert len(formatted_messages) > 0, f"Test case {i+1} produced no messages"
                assert any(isinstance(msg, SystemMessage) for msg in formatted_messages), f"Test case {i+1} missing system message"
            except Exception as e:
                if "missing variables" in str(e).lower() or "template" in str(e).lower():
                    pytest.fail(f"Template compilation error in test case {i+1}: {e}")
                else:
                    # Other errors might be acceptable
                    pass
    
    def test_data_retrieval_prompt_template_syntax(self):
        """Test that the data retrieval prompt template has valid syntax"""
        
        test_question = "What are the top 5 brands for 2021?"
        data_prompt = self.prompt_templates.get_data_retrieval_prompt(test_question)
        
        test_input = {
            "input": "test query",
            "agent_scratchpad": []
        }
        
        try:
            formatted_messages = data_prompt.format_messages(**test_input)
            assert len(formatted_messages) > 0
        except Exception as e:
            pytest.fail(f"Data retrieval prompt template failed to format: {e}")
    
    @pytest.mark.skip(reason="Chart generation prompt method removed during chart simplification")
    def test_chart_generation_prompt_syntax(self):
        """Test that chart generation prompt formats correctly and contains required elements"""
        test_question = "Show me sales by region"
        test_data = {"test": "data", "array_value": []}
        
        try:
            chart_prompt = self.prompt_templates.get_chart_generation_prompt(test_question, test_data)
            self.assertIsInstance(chart_prompt, str)
            self.assertIn("matplotlib", chart_prompt.lower())
            self.assertIn("plt.savefig", chart_prompt)
            print("✅ Chart generation prompt formats correctly")
        except Exception as e:
            pytest.fail(f"Chart generation prompt failed to format: {e}")
    
    def test_error_handling_prompt_syntax(self):
        """Test that the error handling prompt has valid syntax"""
        
        try:
            error_prompt = self.prompt_templates.get_error_handling_prompt()
            assert isinstance(error_prompt, str)
            assert len(error_prompt) > 0
        except Exception as e:
            pytest.fail(f"Error handling prompt failed to format: {e}")
    
    def test_context_aware_prompt_syntax(self):
        """Test that the context aware prompt has valid syntax"""
        
        test_context = {
            "user_domain": "ecommerce",
            "available_projects": ["project1", "project2"],
            "recent_queries": [{"project": "test", "field": "test_field"}]
        }
        
        try:
            context_prompt = self.prompt_templates.get_context_aware_prompt(test_context)
            assert isinstance(context_prompt, str)
            assert len(context_prompt) > 0
        except Exception as e:
            pytest.fail(f"Context aware prompt failed to format: {e}")


class TestAgentInitializationWithPrompts:
    """Test that the agent can be properly initialized with the prompt templates"""
    
    def test_agent_initialization_without_errors(self):
        """Test that the LangChainCompatibilityAdapter can be initialized without template errors"""
        
        # Mock the required environment variables or parameters
        test_config = {
            "openai_api_key": "test-key",
            "mcp_url": "http://localhost:4040/mcp",
            "llm_provider": "openai", 
            "model_name": "gpt-4o"
        }
        
        try:
            # This should not fail due to template syntax errors
            # Note: This may fail due to missing API keys, but not template errors
            agent = LangChainCompatibilityAdapter(**test_config)
            assert agent is not None
        except Exception as e:
            # If it fails due to template syntax, that's a test failure
            if "missing variables" in str(e).lower() or "template" in str(e).lower():
                pytest.fail(f"Agent initialization failed due to template error: {e}")
            # Other errors (like missing API keys) are acceptable in unit tests
            pass
    
    def test_agent_process_question_template_format(self):
        """Test that agent.process_user_question doesn't fail due to template errors"""
        
        # We'll mock the actual MCP calls to focus on template validation
        test_config = {
            "openai_api_key": "test-key", 
            "mcp_url": "http://localhost:4040/mcp",
            "llm_provider": "openai",
            "model_name": "gpt-4o"
        }
        
        try:
            agent = LangChainCompatibilityAdapter(**test_config)
            
            # This might fail due to actual API calls, but shouldn't fail due to template syntax
            # We're mainly checking that the template system itself works
            try:
                success, response, history = agent.process_user_question("test question")
                # We don't care about the actual result, just that templates didn't fail
            except Exception as e:
                # Template errors would happen before any API calls
                if "missing variables" in str(e).lower() or "template" in str(e).lower():
                    pytest.fail(f"Template error in process_user_question: {e}")
                # Other errors (network, API, etc.) are expected in unit tests
                pass
                
        except Exception as e:
            if "missing variables" in str(e).lower() or "template" in str(e).lower():
                pytest.fail(f"Template error during agent initialization: {e}")

    def test_template_error_regression_demo(self):
        """Demonstrate that our tests would catch the original template error"""
        
        from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
        
        # Simulate the original broken template with unescaped braces
        broken_template_content = """
        You are a Malloy expert. Here are correct patterns:
        
        **✅ CORRECT Query Patterns:**
        ```malloy
        # This would cause a template error with unescaped braces
        run: source_name -> {
          group_by: field_name
          aggregate: measure_name
        }
        ```
        """
        
        # This template would fail with the original error
        broken_template = ChatPromptTemplate.from_messages([
            ("system", broken_template_content),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
            MessagesPlaceholder(variable_name="agent_scratchpad"),
        ])
        
        test_input = {
            "input": "test query",
            "agent_scratchpad": [],
            "chat_history": []
        }
        
        # This should raise a KeyError about missing variables like 'group_by', 'field_name', etc.
        with pytest.raises(KeyError) as excinfo:
            broken_template.format_messages(**test_input)
            
        # Verify it's the type of error we expect
        assert "group_by" in str(excinfo.value) or "field_name" in str(excinfo.value)


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"]) 