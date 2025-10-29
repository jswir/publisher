"""
Example: Async queries with Malloy Publisher SDK and Pandas

This example shows how to use async/await with the SDK
to execute multiple queries in parallel and work with the results.
"""

import asyncio
from malloy_publisher_sdk import Client, to_dataframe
from malloy_publisher_sdk.api.queryresults import execute_query


async def fetch_and_analyze(
    client: Client, project: str, package: str, model: str, query: str
) -> None:
    """Fetch query results and perform analysis."""
    print(f"Executing query...")

    # Execute query asynchronously
    result = await execute_query.asyncio(
        client=client,
        project_name=project,
        package_name=package,
        path=model,
        query=query,
    )

    # Convert to DataFrame
    df = to_dataframe(result)

    print(f"Query returned {len(df)} rows")
    print(df.head())
    return df


async def parallel_queries_example():
    """Example of running multiple queries in parallel."""
    async with Client(base_url="http://localhost:4000/api/v0") as client:
        # Define multiple queries to run in parallel
        queries = [
            {
                "project": "malloy-samples",
                "package": "faa",
                "model": "airports.malloy",
                "query": "run: airports -> { aggregate: count() }",
            },
            {
                "project": "malloy-samples",
                "package": "faa",
                "model": "flights.malloy",
                "query": "run: flights -> { aggregate: count() }",
            },
            {
                "project": "malloy-samples",
                "package": "faa",
                "model": "carriers.malloy",
                "query": "run: carriers -> { aggregate: count() }",
            },
        ]

        # Run all queries in parallel
        results = await asyncio.gather(
            *[
                fetch_and_analyze(
                    client, q["project"], q["package"], q["model"], q["query"]
                )
                for q in queries
            ]
        )

        print(f"\nCompleted {len(results)} queries in parallel")
        return results


async def main():
    """Main example function."""
    print("Running parallel queries example...")
    results = await parallel_queries_example()

    print("\nSummary of results:")
    for i, df in enumerate(results):
        print(f"Query {i + 1}: {len(df)} rows")


if __name__ == "__main__":
    asyncio.run(main())
