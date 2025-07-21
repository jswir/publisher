"""
QuickChart.io Tool for Chart Generation
Creates charts using the QuickChart.io API service
"""

import json
import uuid
from typing import Dict, Any, Optional
from langchain.tools import BaseTool
from pydantic import BaseModel, Field
import requests
import urllib.parse


class QuickChartInput(BaseModel):
    """Input for QuickChart tool"""
    chart_config: str = Field(description="Chart.js configuration as JSON string")
    width: Optional[int] = Field(default=800, description="Chart width in pixels")
    height: Optional[int] = Field(default=600, description="Chart height in pixels")
    format: Optional[str] = Field(default="png", description="Chart format (png, jpg, svg, pdf)")


class QuickChartTool(BaseTool):
    """Tool for generating charts using QuickChart.io API"""
    
    name: str = "generate_chart"
    description: str = "Generate a chart using QuickChart.io API from Chart.js configuration"
    args_schema: type[BaseModel] = QuickChartInput
    
    def _run(self, chart_config: str, width: int = 800, height: int = 600, format: str = "png") -> str:
        """Generate chart using QuickChart.io API"""
        try:
            # Parse the chart config JSON
            try:
                config_dict = json.loads(chart_config)
            except json.JSONDecodeError as e:
                return f"Error: Invalid JSON in chart_config: {e}"
            
            # Build QuickChart.io URL
            base_url = "https://quickchart.io/chart"
            
            # Prepare the chart configuration
            chart_data = {
                "chart": config_dict,
                "width": width,
                "height": height,
                "format": format,
                "backgroundColor": "white"
            }
            
            # URL encode the chart data
            chart_json = json.dumps(chart_data)
            encoded_chart = urllib.parse.quote(chart_json)
            
            # Create the full URL
            chart_url = f"{base_url}?c={encoded_chart}"
            
            # Always download and save the chart file for Slack upload
            try:
                # For large charts, use POST; for small ones, use GET
                if len(chart_url) > 2000:
                    response = requests.post(
                        "https://quickchart.io/chart",
                        json=chart_data,
                        headers={"Content-Type": "application/json"},
                        timeout=30
                    )
                else:
                    response = requests.get(chart_url, timeout=30)
                
                if response.status_code == 200:
                    # Save the chart image
                    chart_filename = f"chart_{uuid.uuid4().hex[:8]}.{format}"
                    chart_path = f"/tmp/{chart_filename}"
                    
                    with open(chart_path, 'wb') as f:
                        f.write(response.content)
                    
                    return json.dumps({
                        "text": "Chart generated successfully!",
                        "file_info": {
                            "status": "success",
                            "filepath": chart_path,
                            "url": chart_url if len(chart_url) <= 2000 else None
                        }
                    })
                else:
                    return f"Error: QuickChart.io API returned status {response.status_code}: {response.text}"
            except requests.exceptions.RequestException as e:
                return f"Error: Failed to download chart: {e}"
                
        except requests.exceptions.RequestException as e:
            return f"Error: Network request failed: {e}"
        except Exception as e:
            return f"Error: Chart generation failed: {e}"
    
    async def _arun(self, chart_config: str, width: int = 800, height: int = 600, format: str = "png") -> str:
        """Async version of chart generation"""
        return self._run(chart_config, width, height, format)


def create_quickchart_tool() -> QuickChartTool:
    """Create a QuickChart tool instance"""
    return QuickChartTool()


# Example usage function
def test_quickchart_tool():
    """Test the QuickChart tool with sample data"""
    
    tool = create_quickchart_tool()
    
    # Sample Chart.js configuration
    sample_config = {
        "type": "bar",
        "data": {
            "labels": ["Levi's", "Ray-Ban", "Columbia", "Carhartt", "Dockers"],
            "datasets": [
                {
                    "label": "Total Sales",
                    "data": [1772930.94, 867047.23, 780730.58, 549446.06, 494120.49],
                    "backgroundColor": [
                        "rgba(54, 162, 235, 0.8)",
                        "rgba(255, 99, 132, 0.8)",
                        "rgba(255, 206, 86, 0.8)",
                        "rgba(75, 192, 192, 0.8)",
                        "rgba(153, 102, 255, 0.8)"
                    ]
                }
            ]
        },
        "options": {
            "responsive": True,
            "plugins": {
                "title": {
                    "display": True,
                    "text": "Total Sales by Brand"
                }
            },
            "scales": {
                "x": {
                    "title": {
                        "display": True,
                        "text": "Product Brand"
                    }
                },
                "y": {
                    "title": {
                        "display": True,
                        "text": "Total Sales"
                    },
                    "beginAtZero": True
                }
            }
        }
    }
    
    # Test the tool
    result = tool._run(json.dumps(sample_config))
    print("QuickChart tool result:")
    print(result)
    
    return result


if __name__ == "__main__":
    test_quickchart_tool()