# Embedded Data Apps

Publisher offers two ways to ship governed analytics into a web product:

1. **In-package HTML data apps** (recommended for most cases) — drop an `index.html` into a Malloy package, Publisher serves it, hand-author the dashboard with whatever chart library you like. No build step, no install, no React required. Live reload on file edits. Embeddable in any other web page with four lines.
2. **React SDK** (`@malloy-publisher/sdk`) — build a full web app that imports React components like `<Notebook>`, `<ModelExplorer>`, and `<QueryResult>`. Use this when you need an interactive *query builder* or notebook UI inside your own React app, not just charts.

If you're not sure, start with option 1. Option 2 is a real React project (Vite + npm) and a much bigger commitment.

---

## Option 1: In-package HTML data apps

A package on disk:

```
my-package/
├── publisher.json
├── carriers.malloy        ← your semantic model
├── carriers.parquet
└── index.html             ← your dashboard
```

Publisher serves `index.html` (and any other static files in the package) at:

```
http://localhost:4000/environments/<env>/packages/my-package/index.html
```

Inside the HTML, a tiny runtime helper handles the API call boilerplate. Pull it in once, then call `Publisher.query()`.

```html
<!doctype html>
<title>Hello, Malloy</title>
<script src="/sdk/publisher.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js"></script>

<canvas id="c"></canvas>
<script type="module">
  // Returns a flat array of row objects.
  const rows = await Publisher.query("carriers.malloy",
    "run: carriers -> { group_by: code; aggregate: n is count(); limit: 10 }");

  new Chart(document.getElementById("c"), {
    type: "bar",
    data: {
      labels: rows.map(r => r.code),
      datasets: [{ data: rows.map(r => r.n) }],
    },
  });
</script>
```

That's it. `environment` and `package` are inferred from the URL. Edit either the HTML or the underlying `.malloy`, save, and the page auto-reloads in the browser.

A worked example is in [`examples/html-data-app/`](../examples/html-data-app/) — a Chart.js dashboard with filters and an `embed-test.html` host page demonstrating `Publisher.embed()`.

### What `Publisher.query()` returns

By default it returns the **compact rows**: a JS array of plain row objects. Nested subqueries (Malloy `nest:`) arrive as nested JS arrays — nesting is preserved, never denormalized.

If you want the **full Malloy result envelope** (schema, types, render-tag annotations like `# currency` and `# bar_chart`) — for example to integrate with `@malloydata/render` so the modeler's display intent is honored automatically — call `Publisher.queryFull()` instead:

```js
const result = await Publisher.queryFull("carriers.malloy", "run: carriers -> top_by_letter");
// result is the wrapped envelope: { schema, data, annotations, ... }
// Feed it to MalloyRenderer or any other code that wants the schema/tags.
```

For React apps that want the full Malloy renderer experience, use `@malloy-publisher/sdk`'s `<QueryResult>` component instead — it wraps `MalloyRenderer` for you. The runtime helper's value is the lighter path: vanilla JS, no React, BYOR (bring-your-own-renderer).

### The full runtime API

| Method | Returns | When to use |
|---|---|---|
| `Publisher.query(model, malloy, opts?)` | `Promise<row[]>` | Hand-coded dashboards (Chart.js / Recharts / D3 / etc.). Smallest payload. |
| `Publisher.queryFull(model, malloy, opts?)` | `Promise<MalloyResult>` | `<malloy-render>` or any code that uses the schema/tags/types. |
| `Publisher.embed(selector, { src, height?, token? })` | `{ iframe, destroy }` | Mount an iframe-embedded dashboard into another web page. Auto-resizes. |
| `Publisher.context` | `{ environment, package }` | What was inferred from `window.location`. |
| `Publisher.setToken(token)` | — | Override Bearer token; default is browser cookies (`credentials: include`). |

`opts` accepts `{ environment, package, sourceName, queryName, filterParams, bypassFilters }` — handy when one HTML file calls into multiple packages, or for parameterized models.

### Live reload

When `/sdk/publisher.js` runs inside a Publisher-served page it opens a Server-Sent Events stream at
`/api/v0/environments/<env>/packages/<pkg>/watch`. Any `.malloy`, `.malloynb`, `.md`, `.html`, `.css`, `.js`, `.json`, or image edit anywhere in the package fires a refresh. The first SSE connection auto-starts watch mode for that environment. No flags, no manual setup.

### Embedding in another web app

Same-origin (or same-tenant) embed in 4 lines:

```html
<script src="https://demo.app.credibledata.com/sdk/publisher.js"></script>
<div id="dashboard"></div>
<script>
  Publisher.embed("#dashboard", {
    src: "https://demo.app.credibledata.com/environments/demo/packages/my-package/index.html",
    // height: 400,   // optional; auto-sizes via postMessage when omitted
  });
</script>
```

What this does:

- Creates a sandboxed `<iframe>` and inserts it into `#dashboard`.
- Listens for `{type: "publisher:resize", height}` postMessages from the iframe and resizes the frame to match content height. The Publisher runtime inside the iframe posts these automatically as content changes (via `ResizeObserver`).
- Handles auth via browser cookies — the user is already logged in to the parent app and Publisher shares a session domain.

For the lowest-friction case (no auto-resize, no token), a raw `<iframe>` works too:

```html
<iframe src="https://demo.app.credibledata.com/environments/demo/packages/my-package/index.html"
        width="100%" height="600" frameborder="0"></iframe>
```

The Publisher response sets `Content-Security-Policy: frame-ancestors *` so embedding works without server-side flags.

### Cross-tenant embedding (Stripe-style, future)

The pattern above works when the host app and Publisher share an Auth0 tenant — cookies authenticate. When the host is a *different* tenant (e.g. a customer of yours embedding a Malloy-built dashboard inside their own SaaS), cookies don't carry over. The right shape is Stripe-`paymentIntent`-like:

1. Customer's backend mints a short-lived JWT scoped to one specific embed: `POST /api/v0/embed-tokens` with `{ environment, package, filterParams, expiresIn }` returns the token.
2. Customer's frontend passes it: `Publisher.embed("#x", { src, token })`.
3. Publisher accepts the token via `Authorization: Bearer …` (or `?embed_token=…` for the iframe load itself).

This second tier isn't shipped yet. The Tier-1 same-tenant flow above is enough to prove the pattern end-to-end on your own product surface.

### Frontend stack — pick whatever you like

The Publisher doesn't care what your dashboard is built with. The runtime helper is vanilla JS and integrates with anything:

| Stack | How |
|---|---|
| Chart.js, ECharts, D3, Plotly, ApexCharts | Drop a `<script>` tag from a CDN, call `Publisher.query()`, draw. |
| `<malloy-render>` (Malloy's renderer) | `<script>` tag from `@malloydata/render` UMD; `Publisher.queryFull()` → `el.result = …`. |
| React + Recharts (Claude-artifact pattern) | CDN `<script>` tags for React, ReactDOM, Recharts, and Babel-standalone; write JSX inline in `<script type="text/babel">`. No build step. |
| Multiple files (HTML + JS + CSS) | Put them all in the package directory. Publisher serves them. |
| Real build step (Vite/esbuild) | Build into a `dist/` subdirectory of the package; serve from there. |

### Local development workflow

```bash
# 1. Point Publisher at a workspace containing your package
SERVER_ROOT=/path/to/workspace bun run packages/server/src/server.ts

# 2. Open your dashboard
open http://localhost:4000/environments/<env>/packages/<pkg>/index.html

# 3. Edit `.malloy` or `.html`. Save. Watch the browser auto-refresh.
```

---

## Option 2: React SDK (`@malloy-publisher/sdk`)

Use this when you need to embed Publisher's interactive UI components — the model explorer, notebook viewer, or workbook — inside a larger React app you control. The SDK exports things like `<Notebook>`, `<ModelExplorer>`, `<Package>`, `<Home>`, plus hooks and utilities.

Steps:

1. Make sure Publisher is running locally on port `4000`.
2. Open `examples/data-app/` in the Publisher repo.
3. Copy `.env.example` to `.env` (keep the default `VITE_PUBLISHER_API` unless Publisher is on a different port).
4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open [http://localhost:5173](http://localhost:5173).

You should see a "Malloy Samples" dashboard with charts and tables from the `names` package.

### Single-component embed in your own React app

```tsx
import { ServerProvider, QueryResult } from "@malloy-publisher/sdk";

export default function MyDashboard() {
  return (
    <ServerProvider server="https://localhost:4000/api/v0">
      <QueryResult
        resourceUri="publisher://projects/malloy-samples/packages/names/models/names1.malloynb"
        query="run: names -> { aggregate: total_population }"
      />
    </ServerProvider>
  );
}
```

This is the right path when:

- You're already shipping a React app and want to add a Malloy-backed view.
- You need the *interactive query builder* (`<ModelExplorer>`), not just rendered output.
- You want the Publisher SPA's notebook flow embedded inside your product.

For everything else, prefer Option 1 — it's lighter, requires no React knowledge, and works with any visualization library (or none).
