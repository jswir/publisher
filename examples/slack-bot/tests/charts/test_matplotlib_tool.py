#!/usr/bin/env python3
"""
Test the matplotlib chart tool directly
"""

import json
import os
from src.tools.matplotlib_chart_tool import MatplotlibChartTool

def test_matplotlib_tool():
    """Test the matplotlib tool directly"""
    
    print("🎨 Testing Matplotlib Chart Tool")
    print("=" * 40)
    
    # Create tool
    tool = MatplotlibChartTool()
    
    # Test with sample data similar to what the agent would generate
    sample_code = '''
import pandas as pd
import matplotlib.pyplot as plt
import json

# Sample data that mimics Malloy query results
data = {
    "years": [2019, 2020, 2021, 2022],
    "sales": [1318595.54, 2602043.07, 3900910.81, 4744743.45]
}

# Create DataFrame
df = pd.DataFrame(data)

# Create chart
plt.figure(figsize=(10, 6))
plt.bar(df['years'], df['sales'], color='skyblue')
plt.title('Total Sales by Year')
plt.xlabel('Year')
plt.ylabel('Total Sales ($)')
plt.xticks(df['years'])
plt.grid(axis='y', alpha=0.3)

# Format y-axis to show currency
plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'${x:,.0f}'))

plt.tight_layout()

# Save chart (REQUIRED!)
plt.savefig(filepath, dpi=300, bbox_inches='tight')
plt.close()
'''
    
    print("Running matplotlib code...")
    try:
        result = tool._run(sample_code)
        print(f"✅ Tool executed successfully")
        print(f"Result: {result}")
        
        # Parse result
        try:
            parsed = json.loads(result)
            file_info = parsed.get('file_info', {})
            
            if file_info.get('status') == 'success':
                file_path = file_info.get('filepath')
                print(f"✅ Chart created: {file_path}")
                
                if os.path.exists(file_path):
                    print(f"✅ File exists and is {os.path.getsize(file_path)} bytes")
                else:
                    print(f"❌ File doesn't exist at {file_path}")
            else:
                print(f"❌ Chart creation failed: {file_info.get('message', 'Unknown error')}")
                
        except json.JSONDecodeError:
            print(f"❌ Tool result is not JSON: {result}")
            
    except Exception as e:
        print(f"❌ Tool execution failed: {e}")
        import traceback
        traceback.print_exc()

def test_complex_json_parsing():
    """Test parsing complex JSON data like from Malloy"""
    
    print("\n🧪 Testing Complex JSON Parsing")
    print("=" * 40)
    
    tool = MatplotlibChartTool()
    
    # Complex code that handles nested Malloy data structure
    complex_code = '''
import pandas as pd
import matplotlib.pyplot as plt
import json

# Complex nested data structure like from Malloy
result = {
    "data": {
        "array_value": [
            {"record_value": [{"number_value": 2022}, {"number_value": 4744743.45}]},
            {"record_value": [{"number_value": 2021}, {"number_value": 3900910.81}]},
            {"record_value": [{"number_value": 2020}, {"number_value": 2602043.07}]},
            {"record_value": [{"number_value": 2019}, {"number_value": 1318595.54}]}
        ]
    }
}

# Extract data from nested structure
years = []
sales = []

for row in result["data"]["array_value"]:
    year = row["record_value"][0]["number_value"]
    sale = row["record_value"][1]["number_value"]
    years.append(year)
    sales.append(sale)

# Create DataFrame
df = pd.DataFrame({"Year": years, "Sales": sales})

# Create chart
plt.figure(figsize=(10, 6))
plt.bar(df['Year'], df['Sales'], color=['#42A5F5', '#66BB6A', '#FFA726', '#EF5350'])
plt.title('Total Sales by Year')
plt.xlabel('Year')
plt.ylabel('Total Sales ($)')
plt.xticks(df['Year'])
plt.grid(axis='y', alpha=0.3)

# Format y-axis
plt.gca().yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f'${x:,.0f}'))

plt.tight_layout()
plt.savefig(filepath, dpi=300, bbox_inches='tight')
plt.close()
'''
    
    print("Running complex JSON parsing code...")
    try:
        result = tool._run(complex_code)
        print(f"✅ Complex parsing successful")
        
        parsed = json.loads(result)
        file_info = parsed.get('file_info', {})
        
        if file_info.get('status') == 'success':
            file_path = file_info.get('filepath')
            print(f"✅ Complex chart created: {file_path}")
            
            if os.path.exists(file_path):
                print(f"✅ File exists and is {os.path.getsize(file_path)} bytes")
        else:
            print(f"❌ Complex chart failed: {file_info.get('message')}")
            
    except Exception as e:
        print(f"❌ Complex parsing failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_matplotlib_tool()
    test_complex_json_parsing()