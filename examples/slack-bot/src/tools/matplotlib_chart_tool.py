"""
Matplotlib Chart Generation Tool
Creates charts using matplotlib with sandboxed Python execution
"""
import json
import uuid
import os
import tempfile
from typing import Dict, Any, Optional
from langchain.tools import BaseTool
from pydantic import BaseModel, Field
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib

matplotlib.use('Agg')  # Use non-interactive backend


class MatplotlibChartInput(BaseModel):
    """Input for Matplotlib chart tool"""
    python_code: str = Field(
        description="Python code that creates and saves a matplotlib chart. The code should handle parsing any data from the conversation context and save the chart using plt.savefig(filepath)."
    )


class MatplotlibChartTool(BaseTool):
    """Tool for generating charts using matplotlib with sandboxed execution"""

    name: str = "generate_chart"
    description: str = (
        "Generates and saves a data visualization by executing Python code. "
        "The code should parse any necessary data from the conversation context and create charts using matplotlib. "
        "The `filepath` variable is automatically available to save the chart."
    )
    args_schema: type[BaseModel] = MatplotlibChartInput

    def _run(self, python_code: str) -> str:
        """Execute matplotlib code to generate chart"""
        try:
            filepath = f"/tmp/{uuid.uuid4()}.png"
            
            safe_globals = {
                "pd": pd,
                "plt": plt,
                "json": json,
                "filepath": filepath
            }
            
            local_vars = {}
            exec(python_code, safe_globals, local_vars)
            
            if os.path.exists(filepath):
                return json.dumps({
                    "text": "Chart generated successfully!",
                    "file_info": {"status": "success", "filepath": filepath}
                })
            else:
                return json.dumps({
                    "text": "Chart generation failed",
                    "file_info": {
                        "status": "error",
                        "message": "No chart file was created. Make sure your code calls plt.savefig(filepath)."
                    }
                })
                
        except Exception as e:
            plt.close('all')
            return json.dumps({
                "text": "Chart generation failed",
                "file_info": {"status": "error", "message": f"Error executing chart code: {str(e)}"}
            })
        
        finally:
            plt.close('all')

    async def _arun(self, python_code: str) -> str:
        """Async version of chart generation"""
        return self._run(python_code)


def create_matplotlib_chart_tool() -> MatplotlibChartTool:
    """Create a matplotlib chart tool instance"""
    return MatplotlibChartTool()


# Example usage function
def test_matplotlib_chart_tool():
    """Test the matplotlib chart tool with sample data"""
    
    tool = create_matplotlib_chart_tool()
    
    # Sample Python code for chart generation
    sample_code = """
import pandas as pd
import matplotlib.pyplot as plt
import json

# Sample data
data = {
    "labels": ["Levi's", "Ray-Ban", "Columbia", "Carhartt", "Dockers"],
    "values": [1772930.94, 867047.23, 780730.58, 549446.06, 494120.49]
}

# Create DataFrame
df = pd.DataFrame(data)

# Create the chart
plt.figure(figsize=(10, 6))
plt.bar(df['labels'], df['values'], color=['#42A5F5', '#66BB6A', '#FFA726', '#EF5350', '#AB47BC'])
plt.title('Total Sales by Brand')
plt.xlabel('Product Brand')
plt.ylabel('Total Sales')
plt.xticks(rotation=45)
plt.tight_layout()

# Save the chart (REQUIRED!)
plt.savefig(filepath, dpi=300, bbox_inches='tight')
plt.close()
"""
    
    # Test the tool
    result = tool._run(sample_code)
    print("Matplotlib chart tool result:")
    print(result)
    
    return result


if __name__ == "__main__":
    test_matplotlib_chart_tool()