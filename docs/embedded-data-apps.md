# Embedded Data Apps (React SDK)

The Malloy Publisher includes a **React SDK** that enables you to embed governed analytics directly into your web applications. With just a few lines of code, you can drop live visualizations, metrics, or full interactive dashboards into your product—all powered by your single source of truth in Malloy.

This document guides you through running the included demo application and explains the key patterns for embedding analytics in your own React app.

> 📹 **Video Walkthrough**: [Coming Soon] Watch a guided tour of the embedded data apps demo.

---

## 🚀 Quick Start: Run the Demo in 5 Minutes

This will get the Publisher server and the example data app running on your local machine.

### Step 1: Run the Publisher Server

First, clone the repository and start the Publisher server.

```bash
# 1. Clone the repo and navigate into it
git clone [https://github.com/malloydata/publisher.git](https://github.com/malloydata/publisher.git)
cd publisher

# 2. Initialize submodules and install dependencies
git submodule update --init --recursive
bun install

# 3. Build the project and start the server
bun run build
bun run start
Your terminal should confirm the server is running on `http://localhost:4000`. Leave this terminal running.
```

### Step 2: Run the Example Data App

In a **new terminal window**:

```bash
# 1. Navigate to the example app directory
cd examples/data-app

# 2. Set up the environment and install dependencies
cp .env.example .env
npm install

# 3. Start the development server
npm run dev
```

Your terminal will show the app is running on `http://localhost:5173`.

### Step 3: Explore the Demo

Open `http://localhost:5173` in your browser.

You will see a live application showcasing four distinct patterns for embedding analytics, from simple static panels to fully interactive, custom-rendered dashboards. The next section explains what you're seeing.

## 🎯 Understanding the Embedding Patterns

The demo application showcases four different ways to embed analytics. This allows you to choose the right approach for your specific use case.

| Embedding Pattern | Key Benefit | When to Use It | How It Works (in the Demo) |
|------------------|-------------|----------------|---------------------------|
| **1. Static Dashboard** | Production-ready, pre-configured analysis | For building simple dashboards for end-users. | Queries are hardcoded in a JSON file and rendered with the `<EmbeddedQueryResult />` component. |
| **2. Single Embed** | Simple, focused integration | For adding a single chart or metric to an existing page in your application. | A single query string is pasted into a component and rendered with `<EmbeddedQueryResult />`. |
| **3. Dynamic Dashboard** | Ad-hoc, user-driven analysis | For creating "builder" interfaces where end users can add their own analytics panels without code changes. | Users paste query strings into a UI, which dynamically adds new `<EmbeddedQueryResult />` components. |
| **4. Interactive Dashboard** | Full control and custom visualization | For advanced use cases with custom filters, UI controls, and charting libraries (e.g., Recharts). | Uses the `useRawQueryData` hook to fetch raw data and renders it with custom React components. |


### How Do I Get an Embed Code?

To embed an analysis, you need a json string that defines the query. You can get this in two ways:

#### From a Notebook (.malloynb):

1. Open your notebook in VS Code or the Publisher web app.
2. Find the analysis cell you want to embed.
3. Click the `<>` button to get the complete embed code. This is the easiest and most common method.

#### From the Malloy VS Code Extension:

1. Write and run a query in the Malloy Explorer.
2. Once the results appear, copy the generated link or query details.

## 🛠️ Using the SDK in Your Own App
Ready to move beyond the demo? Here’s how to get started.

### 1. Installation
```bash
npm install @malloy-publisher/sdk
```

### 2. Basic Setup (Single Embed Example)
This example shows how to embed a single, pre-defined analysis into a React component.

```TypeScript

import { ServerProvider, PackageProvider, QueryResult } from "@malloy-publisher/sdk";

export default function MyDashboard() {
  return (
    <div className="dashboard">
      <ServerProvider server="http://localhost:4000/api/v0">
        <PackageProvider projectName="malloy-samples" packageName="names">
          {/* This component will fetch and render the specified query */}
          <QueryResult
            modelPath="names1.malloynb"
            query="run: names -> { aggregate: total_population }"
          />
        </PackageProvider>
      </ServerProvider>
    </div>
  );
}
```

### 3. Advanced Usage (Custom Rendering)
For full control, use the useRawQueryData hook to get the raw data and render it with your own components (e.g., using Recharts, D3, etc.).

```TypeScript

import { useRawQueryData } from "@malloy-publisher/sdk";
import { MyCustomBarChart } from "./MyCustomBarChart"; // Your custom component

function MyInteractiveChart({ filters }) {
  // Query is dynamically rebuilt when filters change
  const dynamicQuery = `run: flights -> { where: carrier == "${filters.carrier}" } -> { ... }`;

  const { data, isLoading, error } = useRawQueryData({ query: dynamicQuery, modelPath: "flights.malloynb" });

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  // Pass the raw data to your custom charting component
  return <MyCustomBarChart data={data} />;
}
```

## 📚 Resources & Troubleshooting
### Key SDK Components
- <QueryResult />: Renders a Malloy query using its built-in visualization. Best for quick embedding.
- useRawQueryData: A hook that returns raw JSON data for a query. Best for custom visualizations.
- <ServerProvider /> & <PackageProvider />: Context providers that supply connection and model info to components.

For a additional detail, see the [SDK README](../../packages/sdk/README.md) for the `@malloy-publisher/sdk` package.

### Configuration & Common Issues
- Port Conflicts: If port 4000 or 5173 are in use, check your terminal output for the correct URLs.

- Analysis Not Loading: Double-check that projectName, packageName, and modelPath are correct in your component. If you have the publisher server running, you can visit the Publisher App at http://localhost:4000 to navigate the project contents.