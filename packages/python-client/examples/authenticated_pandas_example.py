"""
Example: Using Malloy Publisher SDK with Bearer Token Authentication

This example demonstrates how to query Malloy semantic models
with bearer token authentication and work with results in pandas.
"""

# %%
# Import the AuthenticatedClient instead of Client
from malloy_publisher_sdk import AuthenticatedClient, to_dataframe
from malloy_publisher_sdk.api.queryresults import execute_query

# %%
# Initialize the authenticated client with your bearer token
# The token will be sent as: Authorization: Bearer <your_token>
client = AuthenticatedClient(
    base_url="http://localhost:4000/api/v0",
    token="your-bearer-token-here",  # Your JWT or API token
    # Optional: customize the prefix (defaults to "Bearer")
    prefix="Bearer",
    # Optional: customize the header name (defaults to "Authorization")
    auth_header_name="Authorization",
)

# %%
# Alternative: Set token via environment variable (more secure)
import os

client = AuthenticatedClient(
    base_url="http://localhost:4000/api/v0",
    token=os.environ.get("MALLOY_TOKEN", ""),
)

# %%
# Execute a query - authentication happens automatically
result = execute_query.sync(
    client=client,
    project_name="malloy-samples",
    package_name="faa",
    path="airports.malloy",
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
# Convert to pandas DataFrame - works exactly the same as unauthenticated
df = to_dataframe(result)
print(f"Query returned {len(df)} rows")
df.head()

# %%
# All pandas functionality works the same
top_states = df.sort_values("airport_count", ascending=False).head(5)
print("\nTop 5 states by airport count:")
print(top_states)

# %%
# You can also add additional headers if needed
client_with_headers = client.with_headers(
    {
        "X-Custom-Header": "custom-value",
        "X-Request-ID": "req-12345",
    }
)

result2 = execute_query.sync(
    client=client_with_headers,
    project_name="malloy-samples",
    package_name="faa",
    path="flights.malloy",
    query="run: flights -> { aggregate: count() }",
)

print(f"\nFlights count: {to_dataframe(result2)}")

# %%
# Async usage with authentication
import asyncio


async def authenticated_async_example():
    """Example of async queries with authentication."""
    async with AuthenticatedClient(
        base_url="http://localhost:4000/api/v0",
        token=os.environ.get("MALLOY_TOKEN", ""),
    ) as client:
        result = await execute_query.asyncio(
            client=client,
            project_name="malloy-samples",
            package_name="faa",
            path="airports.malloy",
            query="run: airports -> { aggregate: count() }",
        )

        df = to_dataframe(result)
        print(f"Async query returned {len(df)} rows")
        return df


# Run the async example
asyncio.run(authenticated_async_example())

# %%
# Error handling with authentication
from malloy_publisher_sdk import errors

try:
    # This will fail if the token is invalid
    result = execute_query.sync(
        client=client,
        project_name="malloy-samples",
        package_name="faa",
        path="nonexistent.malloy",
        query="run: test -> { select: * }",
    )
except errors.ApiError as exc:
    if exc.status_code == 401:
        print("Authentication failed - check your token")
    elif exc.status_code == 404:
        print("Resource not found")
    else:
        print(f"API error: {exc.status_code} - {exc.body}")
