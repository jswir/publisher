"""Tests for malloy_publisher_sdk.utils module."""

import json
import pytest
from typing import Any

# Import the utilities
from malloy_publisher_sdk.utils import (
    to_dataframe,
    to_dict,
    get_schema,
    MalloyResultError,
    _extract_cell_value,
    _parse_malloy_result,
)


class MockQueryResult:
    """Mock QueryResult object for testing."""

    def __init__(self, result: str):
        self.result = result
        self.resource = "/test/resource"


def create_sample_malloy_result(rows_data: list[list[Any]]) -> str:
    """
    Create a sample Malloy result JSON string.

    Args:
        rows_data: List of rows, where each row is a list of values

    Returns:
        JSON string in Malloy result format
    """
    schema_fields = [
        {"name": "name", "type": "string"},
        {"name": "count", "type": "number"},
        {"name": "active", "type": "boolean"},
    ]

    array_value = []
    for row in rows_data:
        record_value = []
        for value in row:
            if isinstance(value, str):
                record_value.append({"string_value": value})
            elif isinstance(value, (int, float)):
                record_value.append({"number_value": value})
            elif isinstance(value, bool):
                record_value.append({"bool_value": value})
            elif value is None:
                record_value.append({"null_value": None})
            else:
                record_value.append({"string_value": str(value)})

        array_value.append({"record_value": record_value})

    result = {
        "schema": {"fields": schema_fields},
        "data": {"array_value": array_value},
    }

    return json.dumps(result)


def test_extract_cell_value_string():
    """Test extracting string values from cells."""
    cell = {"string_value": "test"}
    assert _extract_cell_value(cell) == "test"


def test_extract_cell_value_number():
    """Test extracting number values from cells."""
    cell = {"number_value": 42}
    assert _extract_cell_value(cell) == 42


def test_extract_cell_value_bool():
    """Test extracting boolean values from cells."""
    cell = {"bool_value": True}
    assert _extract_cell_value(cell) is True


def test_extract_cell_value_null():
    """Test extracting null values from cells."""
    cell = {"null_value": None}
    assert _extract_cell_value(cell) is None


def test_extract_cell_value_array():
    """Test extracting array values from cells."""
    cell = {
        "array_value": [
            {"string_value": "a"},
            {"number_value": 1},
        ]
    }
    result = _extract_cell_value(cell)
    assert result == ["a", 1]


def test_parse_malloy_result_string():
    """Test parsing Malloy result from JSON string."""
    result_str = '{"schema": {}, "data": {}}'
    parsed = _parse_malloy_result(result_str)
    assert isinstance(parsed, dict)
    assert "schema" in parsed
    assert "data" in parsed


def test_parse_malloy_result_dict():
    """Test parsing Malloy result from dict."""
    result_dict = {"schema": {}, "data": {}}
    parsed = _parse_malloy_result(result_dict)
    assert parsed == result_dict


def test_parse_malloy_result_invalid():
    """Test parsing invalid Malloy result raises error."""
    with pytest.raises(MalloyResultError):
        _parse_malloy_result("invalid json {")


def test_to_dict_basic():
    """Test converting Malloy result to list of dicts."""
    rows = [
        ["Alice", 10, True],
        ["Bob", 20, False],
    ]
    result_json = create_sample_malloy_result(rows)
    mock_result = MockQueryResult(result_json)

    result = to_dict(mock_result)

    assert len(result) == 2
    assert result[0] == {"name": "Alice", "count": 10, "active": True}
    assert result[1] == {"name": "Bob", "count": 20, "active": False}


def test_to_dict_empty_result():
    """Test converting empty Malloy result to list of dicts."""
    result_json = json.dumps(
        {
            "schema": {"fields": [{"name": "col1"}]},
            "data": {"array_value": []},
        }
    )
    mock_result = MockQueryResult(result_json)

    result = to_dict(mock_result)

    assert result == []


def test_to_dict_missing_schema():
    """Test converting result without schema raises error."""
    result_json = json.dumps({"data": {"array_value": []}})
    mock_result = MockQueryResult(result_json)

    with pytest.raises(MalloyResultError, match="missing schema"):
        to_dict(mock_result)


def test_to_dict_no_result_attribute():
    """Test converting object without result attribute raises error."""
    with pytest.raises(MalloyResultError, match="Expected a QueryResult"):
        to_dict({"not": "a query result"})


def test_get_schema():
    """Test extracting schema from Malloy result."""
    rows = [["Alice", 10, True]]
    result_json = create_sample_malloy_result(rows)
    mock_result = MockQueryResult(result_json)

    schema = get_schema(mock_result)

    assert len(schema) == 3
    assert schema[0]["name"] == "name"
    assert schema[1]["name"] == "count"
    assert schema[2]["name"] == "active"


def test_get_schema_missing():
    """Test getting schema from result without schema raises error."""
    result_json = json.dumps({"data": {}})
    mock_result = MockQueryResult(result_json)

    with pytest.raises(MalloyResultError, match="missing schema"):
        get_schema(mock_result)


# Pandas-specific tests (will be skipped if pandas not installed)
try:
    import pandas as pd

    PANDAS_AVAILABLE = True
except ImportError:
    PANDAS_AVAILABLE = False


@pytest.mark.skipif(not PANDAS_AVAILABLE, reason="pandas not installed")
def test_to_dataframe_basic():
    """Test converting Malloy result to pandas DataFrame."""
    rows = [
        ["Alice", 10, True],
        ["Bob", 20, False],
        ["Charlie", 30, True],
    ]
    result_json = create_sample_malloy_result(rows)
    mock_result = MockQueryResult(result_json)

    df = to_dataframe(mock_result)

    assert len(df) == 3
    assert list(df.columns) == ["name", "count", "active"]
    assert df.iloc[0]["name"] == "Alice"
    assert df.iloc[0]["count"] == 10
    assert df.iloc[0]["active"] == True
    assert df.iloc[1]["name"] == "Bob"
    assert df.iloc[2]["count"] == 30


@pytest.mark.skipif(not PANDAS_AVAILABLE, reason="pandas not installed")
def test_to_dataframe_empty_result():
    """Test converting empty Malloy result to DataFrame."""
    result_json = json.dumps(
        {
            "schema": {
                "fields": [
                    {"name": "col1"},
                    {"name": "col2"},
                ]
            },
            "data": {"array_value": []},
        }
    )
    mock_result = MockQueryResult(result_json)

    df = to_dataframe(mock_result)

    assert len(df) == 0
    assert list(df.columns) == ["col1", "col2"]


@pytest.mark.skipif(not PANDAS_AVAILABLE, reason="pandas not installed")
def test_to_dataframe_with_nulls():
    """Test converting Malloy result with null values to DataFrame."""
    schema_fields = [
        {"name": "name", "type": "string"},
        {"name": "value", "type": "number"},
    ]

    array_value = [
        {
            "record_value": [
                {"string_value": "Alice"},
                {"number_value": 10},
            ]
        },
        {
            "record_value": [
                {"string_value": "Bob"},
                {"null_value": None},
            ]
        },
    ]

    result = {
        "schema": {"fields": schema_fields},
        "data": {"array_value": array_value},
    }

    result_json = json.dumps(result)
    mock_result = MockQueryResult(result_json)

    df = to_dataframe(mock_result)

    assert len(df) == 2
    assert df.iloc[0]["value"] == 10
    assert pd.isna(df.iloc[1]["value"])


@pytest.mark.skipif(not PANDAS_AVAILABLE, reason="pandas not installed")
def test_to_dataframe_missing_schema():
    """Test converting result without schema raises error."""
    result_json = json.dumps({"data": {"array_value": []}})
    mock_result = MockQueryResult(result_json)

    with pytest.raises(MalloyResultError, match="missing schema"):
        to_dataframe(mock_result)


def test_to_dataframe_pandas_not_installed(monkeypatch):
    """Test that attempting to use to_dataframe without pandas raises error."""
    # Mock pandas as not installed
    import malloy_publisher_sdk.utils as utils_module

    original_pd = utils_module.pd
    monkeypatch.setattr(utils_module, "pd", None)

    rows = [["Alice", 10, True]]
    result_json = create_sample_malloy_result(rows)
    mock_result = MockQueryResult(result_json)

    with pytest.raises(MalloyResultError, match="pandas is required"):
        to_dataframe(mock_result)

    # Restore original pd
    monkeypatch.setattr(utils_module, "pd", original_pd)


@pytest.mark.skipif(not PANDAS_AVAILABLE, reason="pandas not installed")
def test_to_dataframe_nested_arrays():
    """Test converting Malloy result with nested arrays."""
    schema_fields = [
        {"name": "name", "type": "string"},
        {"name": "tags", "type": "array"},
    ]

    array_value = [
        {
            "record_value": [
                {"string_value": "Alice"},
                {
                    "array_value": [
                        {"string_value": "tag1"},
                        {"string_value": "tag2"},
                    ]
                },
            ]
        },
    ]

    result = {
        "schema": {"fields": schema_fields},
        "data": {"array_value": array_value},
    }

    result_json = json.dumps(result)
    mock_result = MockQueryResult(result_json)

    df = to_dataframe(mock_result)

    assert len(df) == 1
    assert df.iloc[0]["name"] == "Alice"
    assert df.iloc[0]["tags"] == ["tag1", "tag2"]
