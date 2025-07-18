# Malloy Notebooks & the Publisher Workflow

## 1. Overview

Malloy Notebooks provide an interactive environment for data exploration, blending Markdown documentation with live, executable Malloy code. In the context of the Malloy Publisher, notebooks transform from a local analysis tool into a shareable, interactive web application.

The typical workflow is:
1.  **Author Locally**: Use the Malloy VS Code extension to create a `.malloynb` notebook file, defining your data sources, models, and queries.
2.  **Serve with Publisher**: Run the Malloy Publisher server, pointing it at the directory containing your notebook and data.
3.  **Explore in Browser**: Open the notebook in a web browser to view it as a standalone, interactive document where anyone can see your analysis and its results.

This guide walks through the process of creating a notebook locally and serving it via the Publisher.

---

## 2. Authoring a Notebook in VS Code

A Malloy Notebook is a file with a `.malloynb` extension, composed of cells that can contain either Markdown or Malloy code. This format lets you build a narrative around your data, explaining each step of your analysis alongside the queries that produce the results.

### Core Concepts

*   **Sequential Execution**: Malloy code cells are executed in order. Each cell inherits the full context—sources, dimensions, measures, and queries—from all preceding cells. This makes it easy to build up complex analyses step-by-step.
*   **Schema Viewer**: While editing a `.malloynb` file in VS Code, the Malloy extension provides a **Schema Viewer** in the side panel. This tool shows all available data definitions in the notebook's current context, making it easy to reference previously defined objects.

### Example Notebook Structure

A simple notebook might have the following cells:

**Cell 1: Markdown**
```markdown
# Analysis of FAA Flight Data

This notebook explores the FAA dataset to find the busiest airports.
```

**Cell 2: Malloy Code (defining a source)**
```malloy
source: flights is duckdb.table('faa/flights.parquet') extend {
  measure: flight_count is count()
  dimension: {
    departure_airport is LTRIM(origin, 'K')
  }
}
```

**Cell 3: Malloy Code (running a query)**
```malloy
query: flights -> {
  group_by: departure_airport
  aggregate: flight_count
  order_by: flight_count desc
  limit: 10
}
```

---

## 3. Serving a Notebook with the Publisher

Once your notebook is created, you can use the Malloy Publisher to serve it as a web page.

### Prerequisites

*   **Node.js & Bun**: The Publisher server runs on Bun, a fast JavaScript runtime.
*   **Malloy VS Code Extension**: For authoring the `.malloynb` file.
*   **A Project Directory**: A folder containing your notebook file (`.malloynb`) and any local data files it depends on (e.g., `.csv`, `.parquet`).

### Step 1: Start the Malloy Publisher Server

The easiest way to get started is to run the server using `npx`, pointing it to your project directory.

1.  Open your terminal and navigate to your project directory.
    ```bash
    cd /path/to/your/project
    ```
2.  Run the Publisher server, telling it to use the current directory as its root:
    ```bash
    npx @malloy-publisher/server --server_root .
    ```

After running the command, you should see output confirming the server is active:

```
Malloy Publisher listening at http://localhost:4000
```

For more details on running the server, see the **[Build and Run Instructions](https://github.com/malloydata/publisher?tab=readme-ov-file#build-and-run-instructions)**.

### Step 2: View the Notebook in a Browser

With the server running, you can now access your project's contents through your web browser.

1.  Open a browser and navigate to the Publisher's root URL: `http://localhost:4000`.
2.  You will see a file listing of your project directory.
3.  Click on your `.malloynb` file (e.g., `analysis.malloynb`).

The Publisher will render your notebook as a clean, readable web page. The Malloy code cells will be executed, and their results (tables or charts) will be displayed inline. This creates a shareable artifact that demonstrates your analysis.

---

## 4. Example Notebooks in `malloy-samples`

The `malloy-samples` directory within this repository contains numerous example notebooks. You can run the Publisher pointed at `malloy-samples` to see them in action:

```bash
npx @malloy-publisher/server --server_root packages/server/malloy-samples
```

Then, navigate to `http://localhost:4000` and explore notebooks like:

*   `faa/aircraft_analysis.malloynb`: A map-reduce example tracking individual airplane flight paths.
*   `ecommerce/ecommerce_notebook.malloynb`: An exploration of an ecommerce dataset.
*   `imdb/genre_analysis.malloynb`: An analysis of movie genres from IMDb data.

By combining local authoring in VS Code with the Publisher, you can quickly turn data analyses into shareable, interactive web content. 