# Malloy Publisher Python SDK

Auto-generated, fully typed Python client for the Malloy Publisher REST API.

---

## Installation

```bash
pip install malloy-publisher-sdk  # once published on PyPI
```

For local development against the monorepo:

```bash
cd packages/python-client
uv venv .venv        # create virtual env (requires `uv`)
source .venv/bin/activate
uv pip install -e ".[test]"  # editable install with test extras
```

---

## Quick-start

```python
from malloy_publisher_sdk import Client, errors
from malloy_publisher_sdk.api.projects import list_projects

client = Client(base_url="http://localhost:4000/api/v0")

try:
    projects = list_projects.sync(client=client)
    for proj in projects:
        print(proj.name, proj.resource)
except errors.ApiError as exc:
    print(exc.status_code, exc.body)
```

### Async usage

```python
import asyncio
from malloy_publisher_sdk import Client
from malloy_publisher_sdk.api.projects import list_projects

async def main():
    async with Client(base_url="http://localhost:4000/api/v0") as client:
        projects = await list_projects.asyncio(client=client)
        print([p.name for p in projects])

asyncio.run(main())
```

---

## Working with Pandas DataFrames

The SDK includes utilities to convert Malloy query results into pandas DataFrames for easy data analysis:

```python
from malloy_publisher_sdk import Client, to_dataframe
from malloy_publisher_sdk.api.queryresults import execute_query

client = Client(base_url="http://localhost:4000/api/v0")

# Execute a query
result = execute_query.sync(
    client=client,
    project_name="malloy-samples",
    package_name="faa",
    path="airports.malloy",
    query="""
    run: airports -> {
        group_by: state
        aggregate: airport_count is count()
        limit: 10
    }
    """
)

# Convert to pandas DataFrame
df = to_dataframe(result)
print(df.head())

# Now use all pandas functionality
top_states = df.sort_values("airport_count", ascending=False)
print(top_states)
```

### Available Utilities

- `to_dataframe(result)` - Convert QueryResult to pandas DataFrame
- `to_dict(result)` - Convert QueryResult to list of dictionaries
- `get_schema(result)` - Extract schema information from QueryResult

### Jupyter Notebook Example

```python
# Perfect for data exploration in notebooks
from malloy_publisher_sdk import Client, to_dataframe
from malloy_publisher_sdk.api.queryresults import execute_query

client = Client(base_url="http://localhost:4000/api/v0")

result = execute_query.sync(
    client=client,
    project_name="malloy-samples",
    package_name="faa",
    path="flights.malloy",
    query="run: flights -> { select: * limit: 100 }"
)

df = to_dataframe(result)

# Explore with pandas
df.describe()
df.plot()
df.to_csv("my_results.csv")
```

See [examples/pandas_notebook_example.py](examples/pandas_notebook_example.py) for a complete example.

---

## Development

### Regenerating the SDK

When the OpenAPI spec (`api-doc.yaml`) changes, run the helper script and commit the diff:

```bash
cd packages/python-client
scripts/build-python-sdk.sh
```

The script performs:
1. Spec validation
2. Code generation via **openapi-python-client**
3. Version synchronization
4. Formatting, linting, type-checking
5. Test execution

### Building the Package

To build the Python package for distribution:

```bash
# Build only (for testing)
./scripts/build-package.sh

# Or build as part of SDK generation
BUILD_PACKAGE=true ./scripts/build-python-sdk.sh
```

This creates wheel and source distributions in the `dist/` directory.


#### Version Management

The package version is managed in `pyproject.toml`. Update the version there and run the build script to synchronize it across all files.

---

## Contributing

Pull requests welcome! Make sure `./scripts/build-python-sdk.sh` passes before opening a PR.

For packaging changes, also verify:
```bash
./scripts/build-package.sh  # Test package building
pip install dist/*.whl      # Test local installation
```

---

## License

MIT © Malloy Data
