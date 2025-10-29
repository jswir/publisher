"""
Utility functions for working with Malloy Publisher SDK.

This module provides helper functions to convert Malloy query results
into pandas DataFrames for easy data analysis in Python notebooks.
"""

from typing import Any, Dict, List, Optional, Union
import json

try:
    import pandas as pd
except ImportError:
    pd = None  # type: ignore


class MalloyResultError(Exception):
    """Exception raised when processing Malloy results fails."""
    pass


def _extract_cell_value(cell: Dict[str, Any]) -> Any:
    """
    Extract the actual value from a Malloy cell based on its type.

    Malloy uses a Thrift-like type system where each value is wrapped
    in a type-specific key (string_value, number_value, etc.).

    Args:
        cell: A dictionary representing a single cell with typed value

    Returns:
        The extracted value in its Python native type
    """
    if "string_value" in cell:
        return cell["string_value"]
    elif "number_value" in cell:
        return cell["number_value"]
    elif "bool_value" in cell:
        return cell["bool_value"]
    elif "null_value" in cell:
        return None
    elif "timestamp_value" in cell:
        return pd.Timestamp(cell["timestamp_value"]) if pd else cell["timestamp_value"]
    elif "date_value" in cell:
        return cell["date_value"]
    elif "array_value" in cell:
        # Nested array - recursively extract
        return [_extract_cell_value(item) for item in cell["array_value"]]
    elif "record_value" in cell:
        # Nested record - recursively extract
        return [_extract_cell_value(item) for item in cell["record_value"]]
    else:
        # Unknown type, return as-is
        return cell


def _parse_malloy_result(result_json: Union[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Parse Malloy result from JSON string or dict.

    Args:
        result_json: Either a JSON string or already parsed dict

    Returns:
        Parsed result dictionary

    Raises:
        MalloyResultError: If parsing fails
    """
    try:
        if isinstance(result_json, str):
            return json.loads(result_json)
        return result_json
    except (json.JSONDecodeError, TypeError) as e:
        raise MalloyResultError(f"Failed to parse Malloy result: {e}")


def to_dataframe(query_result: Any) -> "pd.DataFrame":
    """
    Convert a Malloy QueryResult to a pandas DataFrame.

    This function handles the Thrift-like type system used by Malloy,
    extracting field names from the schema and converting typed values
    to Python native types suitable for pandas.

    Args:
        query_result: A QueryResult object from the SDK with 'result' field
                     containing JSON string of the query results

    Returns:
        pandas DataFrame with the query results

    Raises:
        MalloyResultError: If conversion fails or pandas is not installed

    Example:
        >>> from malloy_publisher_sdk import Client
        >>> from malloy_publisher_sdk.api.queryresults import execute_query
        >>> from malloy_publisher_sdk.utils import to_dataframe
        >>>
        >>> client = Client(base_url="http://localhost:4000/api/v0")
        >>> result = execute_query.sync(
        ...     client=client,
        ...     project_name="demo",
        ...     package_name="mypackage",
        ...     path="flights.malloy",
        ...     query="run: flights -> { select: * }"
        ... )
        >>> df = to_dataframe(result)
        >>> print(df.head())
    """
    if pd is None:
        raise MalloyResultError(
            "pandas is required for DataFrame conversion. "
            "Install it with: pip install pandas"
        )

    # Extract result JSON from QueryResult object
    if hasattr(query_result, "result"):
        result_json = query_result.result
    else:
        raise MalloyResultError(
            "Expected a QueryResult object with 'result' field"
        )

    # Parse the result
    parsed = _parse_malloy_result(result_json)

    # Extract schema and data
    schema = parsed.get("schema", {})
    data = parsed.get("data", {})

    if not schema or "fields" not in schema:
        raise MalloyResultError("Result missing schema information")

    if not data or "array_value" not in data or len(data["array_value"]) == 0:
        # Empty result set
        field_names = [field["name"] for field in schema["fields"]]
        return pd.DataFrame([], columns=field_names)

    # Extract field names from schema
    field_names = [field["name"] for field in schema["fields"]]

    # Extract rows from data.array_value
    array_value = data["array_value"]
    rows = []

    for row_data in array_value:
        if "record_value" not in row_data:
            continue

        record = row_data["record_value"]
        row_dict = {}

        # Map each cell to its field name
        for idx, cell in enumerate(record):
            if idx < len(field_names):
                field_name = field_names[idx]
                row_dict[field_name] = _extract_cell_value(cell)

        rows.append(row_dict)

    # Create DataFrame
    return pd.DataFrame(rows)


def to_dict(query_result: Any) -> List[Dict[str, Any]]:
    """
    Convert a Malloy QueryResult to a list of dictionaries.

    This is useful when you want to work with the data without pandas,
    or need to serialize the results to JSON.

    Args:
        query_result: A QueryResult object from the SDK with 'result' field

    Returns:
        List of dictionaries, where each dict represents a row

    Raises:
        MalloyResultError: If conversion fails

    Example:
        >>> from malloy_publisher_sdk import Client
        >>> from malloy_publisher_sdk.api.queryresults import execute_query
        >>> from malloy_publisher_sdk.utils import to_dict
        >>>
        >>> client = Client(base_url="http://localhost:4000/api/v0")
        >>> result = execute_query.sync(
        ...     client=client,
        ...     project_name="demo",
        ...     package_name="mypackage",
        ...     path="flights.malloy",
        ...     query="run: flights -> { select: * }"
        ... )
        >>> rows = to_dict(result)
        >>> print(rows[0])
    """
    # Extract result JSON from QueryResult object
    if hasattr(query_result, "result"):
        result_json = query_result.result
    else:
        raise MalloyResultError(
            "Expected a QueryResult object with 'result' field"
        )

    # Parse the result
    parsed = _parse_malloy_result(result_json)

    # Extract schema and data
    schema = parsed.get("schema", {})
    data = parsed.get("data", {})

    if not schema or "fields" not in schema:
        raise MalloyResultError("Result missing schema information")

    if not data or "array_value" not in data:
        # Empty result set
        return []

    # Extract field names from schema
    field_names = [field["name"] for field in schema["fields"]]

    # Extract rows from data.array_value
    array_value = data["array_value"]
    rows = []

    for row_data in array_value:
        if "record_value" not in row_data:
            continue

        record = row_data["record_value"]
        row_dict = {}

        # Map each cell to its field name
        for idx, cell in enumerate(record):
            if idx < len(field_names):
                field_name = field_names[idx]
                row_dict[field_name] = _extract_cell_value(cell)

        rows.append(row_dict)

    return rows


def get_schema(query_result: Any) -> List[Dict[str, Any]]:
    """
    Extract schema information from a Malloy QueryResult.

    Returns the field definitions including names and types.

    Args:
        query_result: A QueryResult object from the SDK with 'result' field

    Returns:
        List of field definitions from the schema

    Raises:
        MalloyResultError: If extraction fails

    Example:
        >>> from malloy_publisher_sdk.utils import get_schema
        >>> schema = get_schema(result)
        >>> for field in schema:
        ...     print(f"{field['name']}: {field.get('type', 'unknown')}")
    """
    # Extract result JSON from QueryResult object
    if hasattr(query_result, "result"):
        result_json = query_result.result
    else:
        raise MalloyResultError(
            "Expected a QueryResult object with 'result' field"
        )

    # Parse the result
    parsed = _parse_malloy_result(result_json)

    # Extract schema
    schema = parsed.get("schema", {})

    if not schema or "fields" not in schema:
        raise MalloyResultError("Result missing schema information")

    return schema["fields"]


__all__ = [
    "to_dataframe",
    "to_dict",
    "get_schema",
    "MalloyResultError",
]
