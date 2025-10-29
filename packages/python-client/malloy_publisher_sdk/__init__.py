"""A client library for accessing Malloy Publisher - Semantic Model Serving API"""

from .client import AuthenticatedClient, Client

# Utility functions for working with query results
from .utils import (
    to_dataframe,
    to_dict,
    get_schema,
    MalloyResultError,
)

__all__ = (
    "AuthenticatedClient",
    "Client",
    "to_dataframe",
    "to_dict",
    "get_schema",
    "MalloyResultError",
)
