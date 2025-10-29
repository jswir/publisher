"""
Example: Using Malloy Publisher SDK with Pandas in a Jupyter Notebook

This example demonstrates how to query Malloy semantic models
and work with the results in pandas DataFrames.
"""

# %%
# Import the SDK and utilities
from malloy_publisher_sdk import Client, to_dataframe, to_dict
from malloy_publisher_sdk.api.queryresults import execute_query

# %%
# Initialize the client
# Point this to your Malloy Publisher server
client = Client(base_url="http://localhost:4000/api/v0")

# %%
# Execute a query against a Malloy model
# Replace with your project, package, and model details
result = execute_query.sync(
    client=client,
    project_name="malloy-samples",
    package_name="faa",
    path="airports.malloy",
    # Use query parameter for ad-hoc queries
    query="""
    run: airports -> {
        group_by: state
        aggregate:
            airport_count is count()
            avg_elevation is avg(elevation)
        limit: 10
    }
    """,
)

# %%
# Convert to pandas DataFrame
df = to_dataframe(result)
print(f"Query returned {len(df)} rows")
df.head()

# %%
# Now you can use all pandas functionality
# Basic statistics
print("\nBasic statistics:")
print(df.describe())

# %%
# Filter and sort
top_states = df.sort_values("airport_count", ascending=False).head(5)
print("\nTop 5 states by airport count:")
print(top_states)

# %%
# Create visualizations (requires matplotlib)
try:
    import matplotlib.pyplot as plt

    df.plot.bar(x="state", y="airport_count", figsize=(12, 6))
    plt.title("Airports by State")
    plt.xlabel("State")
    plt.ylabel("Number of Airports")
    plt.tight_layout()
    plt.show()
except ImportError:
    print("Install matplotlib to create visualizations: pip install matplotlib")

# %%
# Execute a named query from the model
# Instead of an ad-hoc query, you can run queries defined in your Malloy model
result2 = execute_query.sync(
    client=client,
    project_name="malloy-samples",
    package_name="faa",
    path="airports.malloy",
    source_name="airports",  # Source name from the model
    query_name="by_state",  # Named query from the model
)

df2 = to_dataframe(result2)
print(f"\nNamed query returned {len(df2)} rows")
df2.head()

# %%
# Export to various formats
df.to_csv("airports_by_state.csv", index=False)
df.to_excel("airports_by_state.xlsx", index=False)
df.to_parquet("airports_by_state.parquet", index=False)
print("\nData exported to CSV, Excel, and Parquet formats")

# %%
# Work with the data as dictionaries
rows = to_dict(result)
print(f"\nFirst row as dictionary: {rows[0]}")

# %%
# Advanced: Join with other data
import pandas as pd

# Create some supplemental data
state_info = pd.DataFrame(
    {
        "state": ["TX", "CA", "FL", "NY"],
        "population": [29000000, 39000000, 21000000, 19000000],
    }
)

# Join with query results
joined = df.merge(state_info, on="state", how="left")
joined["airports_per_million"] = (
    joined["airport_count"] / joined["population"] * 1000000
)

print("\nAirports per million people:")
print(joined[["state", "airports_per_million"]].dropna().head())
