# LangChain Agent Simplification Plan

## Overview
This plan outlines the strategy to simplify the current langchain agent implementation to allow the LLM to think and solve problems more naturally, with less structured and hardcoded guidance.

## Current Issues Identified

### 1. Tool Management Inefficiency
- **Problem**: Tools are re-discovered and initialized every turn via `setup()` method
- **Current Location**: `malloy_langchain_agent.py:211-230`
- **Impact**: Unnecessary overhead and complexity

### 2. Over-Structured Prompts
- **Problem**: Prompts are too prescriptive and don't allow LLM to think flexibly
- **Current Location**: `malloy_prompts.py:20-220`
- **Impact**: Reduces model's ability to solve problems creatively

### 3. Hardcoded Tool Information
- **Problem**: Tool definitions and capabilities are hardcoded in prompts instead of being derived from tool descriptions
- **Current Location**: `malloy_prompts.py:40-60` (Available Tools section)
- **Impact**: Brittle and requires manual updates

### 4. Chart Generation Guidelines in Prompts
- **Problem**: Chart code guidelines are embedded in prompts instead of tool descriptions
- **Current Location**: `malloy_prompts.py:180-210`
- **Impact**: Chart logic scattered across files

### 5. Unnecessary Context Complexity
- **Problem**: `user_domain` and `prompt_by_use_case` force artificial categorization
- **Current Location**: `malloy_prompts.py:270-350`
- **Impact**: Model can't naturally determine context

### 6. Low Iteration Limit
- **Problem**: `max_iterations=8` prevents model from taking enough turns to solve complex problems
- **Current Location**: `malloy_langchain_agent.py:256`
- **Impact**: Premature termination of problem-solving

### 7. Poor Chart Error Handling
- **Problem**: Chart failures don't provide actionable error info to the model
- **Current Location**: `malloy_langchain_agent.py:260-330`
- **Impact**: Model can't self-correct chart generation issues

### 8. Unnecessary Retrieval Prompt
- **Problem**: `get_data_retrieval_prompt` creates artificial separation of data vs chart generation
- **Current Location**: `malloy_prompts.py:220-250`
- **Impact**: Model should determine data needs naturally

## Simplification Strategy

### Phase 1: Tool Management Simplification

#### 1.1 Cache Tools Once
**File**: `malloy_langchain_agent.py`
**Changes**:
- Move tool discovery to `__init__` or one-time setup
- Cache tools as instance variable
- Remove tool re-discovery from `process_question`

```python
class MalloyLangChainAgent:
    def __init__(self, ...):
        # ... existing init code ...
        self.tools = []  # Initialize empty
        self.tools_initialized = False
    
    async def _ensure_tools_ready(self):
        """Ensure tools are discovered and cached (one-time operation)"""
        if not self.tools_initialized:
            tools_factory = MalloyToolsFactory(self.mcp_client)
            self.tools = await tools_factory.create_tools()
            self.tools_initialized = True
```

#### 1.2 Simplify Agent Creation
**File**: `malloy_langchain_agent.py`
**Changes**:
- Create agent/executor once and reuse
- Remove fresh LLM creation per question
- Cache agent executor

### Phase 2: Prompt Simplification

#### 2.1 Create Minimal System Prompt
**File**: `malloy_prompts.py`
**New Design**:
```python
def get_simple_agent_prompt(self) -> ChatPromptTemplate:
    """Simplified prompt that lets LLM think naturally"""
    
    system_message = """You are an expert data analyst with access to Malloy query tools.

Your job is to help users analyze data by:
- Understanding what they want to know
- Using available tools to explore data and execute queries  
- Providing clear insights and analysis
- Creating visualizations when helpful

Think through each request step by step. Use tools as needed to discover data structure, execute queries, and generate charts.

Always provide helpful analysis of results and offer to explore further."""

    return ChatPromptTemplate.from_messages([
        ("system", system_message),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad")
    ])
```

#### 2.2 Remove Hardcoded Tool Information
**Changes**:
- Remove "Available Tools" section from prompts
- Remove Malloy syntax guidelines (move to tool descriptions if needed)
- Remove chart workflow instructions
- Let tool descriptions guide the model

#### 2.3 Remove Complex Prompt Methods
**Files to Simplify**:
- Remove `get_data_retrieval_prompt`
- Remove `get_context_aware_prompt` 
- Remove `get_prompt_by_use_case`
- Remove `get_error_handling_prompt`

### Phase 3: Tool Description Enhancement

#### 3.1 Enhance Chart Tool Description
**File**: `matplotlib_chart_tool.py`
**Changes**:
```python
class MatplotlibChartTool(BaseTool):
    description: str = (
        "Generate data visualizations by executing Python code. "
        "Parse data from conversation context (look for JSON data in previous responses). "
        "Use pandas to process data and matplotlib to create charts. "
        "CRITICAL: Always call plt.savefig(filepath) to save the chart - the filepath variable is provided. "
        "Return response as JSON with 'text' and 'file_info' keys for Slack upload. "
        "If chart generation fails, return error details so the conversation can continue with alternatives."
    )
```

#### 3.2 Improve MCP Tool Descriptions
**File**: `dynamic_malloy_tools.py`
**Changes**:
- Enhance tool descriptions to be more informative
- Include common usage patterns in descriptions
- Add error handling guidance

### Phase 4: Context and Memory Simplification

#### 4.1 Simplify History Management
**File**: `malloy_langchain_agent.py`
**Changes**:
- Remove `_augment_history_for_llm` complexity
- Provide raw conversation history to model
- Let model naturally reference previous data

#### 4.2 Remove Domain Classification
**Changes**:
- Remove `user_domain` concept
- Remove domain-specific prompt variations
- Let model determine context from conversation

### Phase 5: Iteration and Error Handling

#### 5.1 Increase Max Iterations
**File**: `malloy_langchain_agent.py`
**Change**:
```python
agent_executor = AgentExecutor(
    agent=agent, 
    tools=self.tools, 
    verbose=True, 
    max_iterations=25  # Increased from 8
)
```

#### 5.2 Improve Chart Error Handling
**File**: `malloy_langchain_agent.py`
**Changes**:
- When chart generation fails, pass error details to model
- Remove chart response post-processing 
- Let model handle chart failures naturally

### Phase 6: Clean Up Removed Features

#### 6.1 Remove Unused Code
**Files to Clean**:
- Remove unused prompt methods from `malloy_prompts.py`
- Remove complex history augmentation
- Remove fallback response generation
- Simplify tool extraction logic

#### 6.2 Update Tests
**Files to Update**:
- Update test cases for simplified prompts
- Remove tests for deleted functionality
- Add tests for improved error handling

### Phase 7: LangSmith Integration

#### 7.1 Tracing Setup
**Purpose**: Enable detailed tracing of agent execution to understand where models go wrong and optimize performance.

**Components**:
- **LangSmith SDK Integration**: Add LangSmith tracing to the LangChain agent
- **Trace Collection**: Capture tool calls, model responses, and decision points
- **Error Tracking**: Identify where failures occur in multi-turn conversations

**Implementation Details**:
```python
# Add to malloy_langchain_agent.py
from langsmith import trace
from langchain.callbacks import LangChainTracer

class MalloyLangChainAgent:
    def __init__(self, ...):
        # ... existing code ...
        self.langsmith_tracer = LangChainTracer(
            project_name="malloy-slack-bot",
            client=Client()
        )
    
    async def process_question(self, question: str):
        with trace(name="malloy_question_processing") as span:
            span.add_tags({"user_question": question[:100]})
            # ... existing processing logic ...
```

**Configuration Requirements**:
- LangSmith API key environment variable
- Project configuration for trace organization
- Sampling settings for production use

**Monitoring Dashboards**:
- Tool usage patterns and success rates
- Multi-turn conversation completion rates
- Error frequency and types
- Response time distributions
- Token usage tracking

#### 7.2 Debug Integration
**Features**:
- Real-time trace viewing during development
- Error replay capability for failed conversations
- Performance bottleneck identification
- Tool call success/failure analysis

**Benefits**:
- Faster debugging of agent behavior
- Data-driven optimization decisions
- Better understanding of model reasoning patterns
- Ability to identify and fix edge cases

### Phase 8: Evaluation Framework

**Updated Approach: Use DeepEval Open Source Framework**

After researching available open source evaluation frameworks, **DeepEval** emerges as the best fit for our needs:

**Why DeepEval:**
- **Conversational AI Focus**: Specifically designed for evaluating conversational agents
- **Built-in LLM-as-Judge**: Native support for LLM evaluation with multiple judge models
- **Multi-turn Support**: Handles conversation flows naturally
- **Custom Metrics**: Easy to define domain-specific evaluation criteria
- **Pytest Integration**: Familiar testing workflow for developers
- **Active Community**: 400k+ monthly downloads, well-maintained
- **Tool Integration**: Can evaluate tool usage and complex workflows

**DeepEval vs Building Custom:**
- **Faster Implementation**: Pre-built evaluation infrastructure
- **Proven Metrics**: Battle-tested evaluation criteria used by thousands
- **Maintenance**: No need to maintain custom evaluation code
- **Documentation**: Comprehensive guides and examples
- **Community**: Large user base for support and best practices

#### 8.1 Test Prompt Categories and Descriptions

**Category 1: Single-Turn, No Charts (5 prompts)**
*Purpose*: Test basic query understanding and data retrieval capabilities

Example prompt types:
1. **Basic Data Exploration**: "What datasets are available in the ecommerce project?"
2. **Simple Aggregation**: "Show me total sales for 2021"
3. **Top N Query**: "What are the top 5 brands by revenue?"
4. **Filter Query**: "How many orders were placed in Q2 2021?"
5. **Schema Inquiry**: "What fields are available in the orders model?"

*Success Criteria*:
- Accurate data retrieval
- Clear, concise response
- Proper use of relevant tools
- No unnecessary tool calls

**Category 2: Multi-Turn, No Charts (5 prompts)**
*Purpose*: Test conversation continuity and context understanding

Example prompt flows:
1. **Progressive Filtering**: 
   - Turn 1: "Show me sales by brand"
   - Turn 2: "Now filter that to just 2021"
   - Turn 3: "What about Q4 specifically?"

2. **Exploratory Analysis**:
   - Turn 1: "What data do we have about customers?"
   - Turn 2: "Show me customer demographics"
   - Turn 3: "Which age group spends the most?"

3. **Comparative Analysis**:
   - Turn 1: "Compare sales between 2020 and 2021"
   - Turn 2: "Which brands grew the most?"
   - Turn 3: "What about seasonal patterns?"

4. **Drill-Down Investigation**:
   - Turn 1: "Show me our worst performing products"
   - Turn 2: "Why are they performing poorly?"
   - Turn 3: "What can we do to improve them?"

5. **Data Quality Check**:
   - Turn 1: "Are there any data quality issues?"
   - Turn 2: "Show me examples of missing data"
   - Turn 3: "How much of our data is affected?"

*Success Criteria*:
- Maintains context across turns
- Builds upon previous responses
- Uses appropriate tools for each turn
- Provides coherent narrative

**Category 3: Single-Turn with Charts (3 prompts)**
*Purpose*: Test chart generation and data visualization capabilities

Example prompt types:
1. **Bar Chart Request**: "Create a bar chart showing sales by brand for 2021"
2. **Trend Analysis**: "Graph monthly sales trends over the past year"
3. **Comparison Chart**: "Show me a chart comparing Q3 vs Q4 performance by category"

*Success Criteria*:
- Successful chart generation
- Appropriate chart type selection
- Clear labels and formatting
- Accurate data representation

**Category 4: Multi-Turn with Charts (2 prompts)**
*Purpose*: Test complex workflows involving data analysis and visualization

Example prompt flows:
1. **Analysis to Visualization**:
   - Turn 1: "What are our top performing product categories?"
   - Turn 2: "Create a chart showing their performance over time"

2. **Iterative Chart Refinement**:
   - Turn 1: "Show me sales by region in a chart"
   - Turn 2: "Can you make that a pie chart instead and add percentages?"

*Success Criteria*:
- Successful multi-step reasoning
- Appropriate chart generation
- Context preservation between analysis and visualization
- Ability to modify visualizations based on feedback

#### 8.2 DeepEval Integration and Custom Metrics

**DeepEval Setup Architecture**:
```python
from deepeval import evaluate
from deepeval.metrics import AnswerRelevancy, Faithfulness
from deepeval.test_case import LLMTestCase, ConversationalTestCase

# Custom metrics for our use case
class MalloyToolUsageMetric(BaseMetric):
    # Evaluate appropriate tool selection and usage
    
class ChartGenerationMetric(BaseMetric):
    # Evaluate chart creation success and quality
    
class ConversationFlowMetric(BaseMetric):
    # Evaluate multi-turn conversation coherence
```

**Built-in DeepEval Metrics We'll Use**:
- **Answer Relevancy**: How relevant is the response to the question?
- **Faithfulness**: Is the response grounded in the provided context?
- **Contextual Recall**: How much of the relevant context was utilized?
- **Hallucination**: Does the response contain fabricated information?

**Custom Metrics for Our Domain**:

**1. Tool Usage Efficiency (Custom Metric)**
- Appropriate tool selection for the task
- Minimal but sufficient tool calls
- Correct parameter usage

**2. Data Analysis Quality (Custom Metric)**  
- Accuracy of insights drawn from data
- Completeness of analysis
- Business relevance of conclusions

**3. Chart Generation Success (Custom Metric)**
- Chart creation success rate
- Appropriate chart type selection
- Data accuracy in visualization
- Visual clarity and formatting

**4. Conversation Coherence (Custom Metric)**
- Context preservation across turns
- Progressive refinement of analysis
- Natural conversation flow

**DeepEval Test Case Structure**:
```python
# Single-turn evaluation
test_case = LLMTestCase(
    input="Show me top 5 brands by sales for 2021",
    actual_output=agent_response,
    expected_output="Expected analysis with top 5 brands...",
    context=[tool_data, previous_context]
)

# Multi-turn evaluation  
conv_test_case = ConversationalTestCase(
    messages=[
        LLMTestCase(input="Show me sales by brand", actual_output=response1),
        LLMTestCase(input="Filter to just 2021", actual_output=response2),
        LLMTestCase(input="Create a chart", actual_output=response3)
    ]
)

# Evaluate with multiple metrics
evaluate(
    test_cases=[test_case, conv_test_case],
    metrics=[
        AnswerRelevancy(threshold=0.7),
        Faithfulness(threshold=0.7),
        MalloyToolUsageMetric(threshold=0.8),
        ChartGenerationMetric(threshold=0.8)
    ]
)
```

**DeepEval Infrastructure Integration**:

**Test Execution with DeepEval**:
```python
# test_agent_evaluation.py
import pytest
from deepeval import assert_test
from deepeval.metrics import AnswerRelevancy, Faithfulness
from deepeval.test_case import LLMTestCase

@pytest.mark.parametrize("test_case", test_cases)
def test_agent_response(test_case):
    assert_test(test_case, [
        AnswerRelevancy(threshold=0.7),
        Faithfulness(threshold=0.7),
        MalloyToolUsageMetric(threshold=0.8)
    ])

# Run with: deepeval test run test_agent_evaluation.py
```

**Automated Test Runner**:
- **DeepEval CLI**: Built-in test execution and reporting
- **CI/CD Integration**: Run evaluations on every code change
- **Batch Processing**: Evaluate multiple agent versions
- **Result Export**: JSON, CSV outputs for further analysis

**Monitoring and Dashboards**:
- **DeepEval Web Platform**: Built-in dashboard for test results
- **Custom Analytics**: Export results to existing monitoring tools
- **Regression Detection**: Compare scores across agent versions
- **Performance Tracking**: Monitor evaluation trends over time

**Data Management**:
- **Test Case Storage**: JSON/YAML files for version control
- **Result Persistence**: DeepEval handles test run storage
- **Export Capabilities**: Results available in multiple formats
- **Version Tracking**: Link evaluation results to agent versions

**Implementation Phases**:

**Phase 8.1**: DeepEval Setup and Test Development
- Install and configure DeepEval
- Create 15 test cases across categories
- Implement custom metrics for Malloy/chart evaluation
- Set up basic test execution pipeline

**Phase 8.2**: Custom Metrics Implementation
- Develop MalloyToolUsageMetric
- Implement ChartGenerationMetric  
- Create ConversationFlowMetric
- Test metric reliability and consistency

**Phase 8.3**: Automation and CI/CD
- Integrate evaluations into deployment pipeline
- Set up automated test execution
- Configure regression detection
- Implement alert system for failures

**Phase 8.4**: Monitoring and Analysis
- Set up DeepEval dashboard access
- Create additional analytics if needed
- Establish baseline performance metrics
- Implement trend monitoring and reporting

**Success Metrics**:
- **Baseline Establishment**: Initial DeepEval scores across all categories
- **Regression Prevention**: No metric drops below baseline threshold  
- **Improvement Tracking**: Measurable score improvements after optimizations
- **Custom Metric Validation**: Tool usage and chart generation scores >0.8
- **Built-in Metric Performance**: Answer relevancy and faithfulness >0.7
- **Consistency Monitoring**: Low variance in scores for similar test cases

## Implementation Order

### Step 1: Tool Management (High Impact, Low Risk)
1. Cache tools in `__init__` 
2. Remove tool re-discovery from `process_question`
3. Test with existing functionality

### Step 2: Prompt Simplification (High Impact, Medium Risk)
1. Create simple prompt template
2. Remove hardcoded tool information
3. Test with sample queries

### Step 3: Chart Tool Enhancement (Medium Impact, Low Risk)
1. Move chart guidelines to tool description
2. Improve error response format
3. Test chart generation workflow

### Step 4: Iteration Increase (Low Impact, Low Risk)
1. Change max_iterations to 25
2. Test with complex multi-step queries

### Step 5: Context Simplification (Medium Impact, Medium Risk)
1. Remove domain classification
2. Simplify history management
3. Test conversation flow

### Step 6: Final Cleanup (Low Impact, Low Risk)
1. Remove unused code
2. Update documentation
3. Update tests

### Step 7: LangSmith Integration (Medium Impact, Low Risk)
1. Add LangSmith tracing to agent execution
2. Configure trace collection for debugging
3. Set up dashboards for monitoring agent behavior

### Step 8: Evaluation Framework (High Impact, Medium Risk)
1. Create 15-prompt test suite with categories
2. Implement LLM-as-judge evaluation system
3. Establish baseline metrics and monitoring

## Expected Benefits

### Performance Improvements
- Faster response times (no tool re-discovery)
- Reduced memory usage (cached tools)
- More reliable chart generation

### Model Capabilities
- Better problem-solving flexibility
- More natural conversation flow
- Improved error recovery
- Enhanced multi-turn reasoning

### Maintainability
- Simpler codebase
- Fewer hardcoded assumptions
- Tool-driven functionality
- Easier to extend with new capabilities

## Risk Mitigation

### Testing Strategy
- Test each phase independently
- Maintain backward compatibility during transition
- Keep rollback options available
- Monitor response quality metrics

### Rollback Plan
- Git branches for each phase
- Feature flags for major changes
- Ability to switch back to structured prompts if needed

## Success Metrics

### Quantitative
- Response time reduction: Target 20% improvement
- Chart generation success rate: Target 90%+
- Multi-turn conversation completion rate: Target improvement from 8 to 25 turns
- DeepEval metric scores: Target >0.7 for built-in metrics, >0.8 for custom metrics
- Test suite regression prevention: Maintain baseline scores across agent updates

### Qualitative
- More natural conversation flow
- Better handling of complex queries
- Improved error recovery
- More flexible problem-solving approach
- Data-driven optimization through LangSmith traces
- Reliable quality measurement through proven evaluation framework
- Faster evaluation implementation using established tools
- Better community support and documentation 