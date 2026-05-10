# Auth for Embedded Data Apps

The Publisher itself is intentionally auth-less — it just serves files and runs queries. **Authentication and authorization are enforced by the layer in front of it** (Credible's platform middleware).

That gives us four embed-auth patterns to choose from, depending on where the host page lives and who the end-user is. They're not mutually exclusive — most production deployments will use two or three of them for different surfaces.

## Quick chooser

| Where is the embed? | Who is the end-user? | Use this pattern |
|---|---|---|
| Inside Credible's own app (`*.credibledata.com`) | A Credible user (already signed in) | **A. Cookie** |
| Inside a customer's product, on a different domain | A Credible user the customer has provisioned | **D. End-user signs into Credible** |
| Inside a customer's product, on a different domain | The customer's own user (no Credible account) | **B. Proxy + API key** *(if the customer has a backend)* |
| Inside a customer's product, on a different domain | The customer's own user (no Credible account) | **C. Signed JWT (Stripe-style)** *(if you want Credible to be the only trusted layer)* |
| Public page, no auth at all | Anonymous | **E. Public package flag** *(noted below for completeness)* |

## A. Cookie auth (same-domain)

**When:** the embed lives inside Credible's own app, on the same parent domain as the Auth0 session.

**How it works:**

```
User → app.credibledata.com (Auth0 cookie set on .credibledata.com)
        ↓ contains
      Publisher.embed("#x", { src: "https://demo.app.credibledata.com/environments/.../index.html" })
        ↓ iframe loads, browser sends cookie because parent domain matches
      Credible middleware validates session → forwards to Publisher
        ↓ inside iframe
      fetch("/api/v0/...") with credentials: "include" → cookie attaches
        → middleware authorizes → query runs
```

**What's needed on Credible's side:**

- Auth0 cookie configured with `Domain=.credibledata.com` and `SameSite=None; Secure`.
  - `SameSite=Lax` blocks third-party-iframe cookies even on a sister subdomain.
  - `Secure` is required when `SameSite=None` — fine on production HTTPS.
- The Credible middleware that already gates the SPA also gates Publisher endpoints. The Publisher itself stays unaware.

**Pros:** zero per-request overhead. Already works for the SPA.
**Cons:** only valid for embeds within Credible's own apex domain. Cross-domain customers can't use this.

**Runtime behavior:** the runtime always sends `credentials: "include"` on every fetch. Nothing extra to wire up; this just works once the cookie config above is right.

## B. Proxy + long-lived API key (customer-trusted backend)

**When:** the embed lives inside a customer's product, the customer has a backend they control, and they're willing to run a small proxy.

**How it works:**

```
Customer's user → fetch("https://customer-proxy.acme.com/embed/.../api/v0/...")
                  ↓ same-origin to the iframe
                Customer's proxy:
                  1. Verifies the user via the customer's own session/JWT
                  2. Looks up the user's tenant_id (and other scopes)
                  3. Adds Credible API key:  X-Credible-Key: <secret>
                  4. *Injects* mandatory filterParams from the user's identity
                       into the request body, overriding any client-supplied values
                  5. Forwards to publisher.credibledata.com
                Credible:
                  - Validates the API key
                  - Returns data scoped to those filterParams
```

**What's needed on the customer's side:**

- A small proxy server (a few hundred lines of Express/Fastify/whatever).
- They already know who their users are (their own auth) — proxy just maps that to Credible scopes.
- Server-side storage for the long-lived Credible API key.

**What's needed on Credible's side:**

- Long-lived API key issuance (already exists in some form).
- Per-key authorization: which environments/packages this key can reach.
- Optional Origin/Referer enforcement: even with a key, only requests from `customer-proxy.acme.com` are accepted (defense-in-depth if the key leaks).
- Audit log: which key made which call.

**The critical safety property:** the proxy *must* inject `filterParams` strictly. A naive proxy that just forwards the browser's request body lets an end-user craft requests for other tenants' data — they have effectively the API key's full power. Proper proxy behavior:

```js
// PROXY (server-side)
app.post("/embed/:env/:pkg/models/:model/query", async (req, res) => {
   const user = await verifyCustomerSession(req);   // their auth
   const credibleBody = {
      query:        req.body.query,                 // can come from client
      sourceName:   req.body.sourceName,
      queryName:    req.body.queryName,
      compactJson:  req.body.compactJson,
      filterParams: { tenant_id: user.tenantId },   // ALWAYS server-side
      bypassFilters: false,                         // never trust client
   };
   const r = await fetch(
      `https://publisher.credibledata.com/api/v0/.../query`,
      { method: "POST",
        headers: {
           "x-credible-key": process.env.CREDIBLE_API_KEY,
           "content-type":   "application/json",
        },
        body: JSON.stringify(credibleBody) },
   );
   res.status(r.status).set(r.headers).send(await r.text());
});
```

**Pros:**
- Customer gets total control of observability, caching, rate-limiting on their proxy.
- API key never reaches the browser.
- No third-party-cookie pain (all calls are same-origin from the iframe's perspective).
- Minimal new infrastructure on Credible side — leverages the existing API key system.

**Cons:**
- Customer infrastructure burden (someone has to run, monitor, rotate keys for the proxy).
- All Credible traffic flows through the customer's proxy (latency tax).
- If the customer's proxy code is buggy and forwards client `filterParams` blindly, the API key is effectively a footgun.

**This is the recommended path if the customer has a backend and is willing to do the work — minimal changes on the Credible side.**

## C. Signed JWT (Stripe-style, no proxy required)

**When:** the embed lives in a customer's product but the customer doesn't want to run a proxy. The Credible-issued token is the only trusted artifact.

**How it works:**

```
1. Customer's backend → POST https://api.credibledata.com/api/v0/embed-tokens
   {
     environment:  "acme-prod",
     package:      "fleet-dashboard",
     filterParams: { tenant_id: "acme-customer-123" },
     audience:     "https://app.acme.com",
     expiresIn:    3600
   }
   Authenticated via the customer's service-account credentials.
   ← Returns a short-lived JWT signed by Credible's secret.

2. Customer's backend hands the JWT to their frontend on render.

3. Customer's frontend:
   <script src="https://publisher.credibledata.com/sdk/publisher.js"></script>
   <div id="dashboard"></div>
   <script>
     Publisher.embed("#dashboard", {
       src:   "https://publisher.credibledata.com/environments/acme-prod/packages/fleet-dashboard/index.html",
       token: jwt
     });
   </script>

4. Runtime forwards the token:
   - As ?embed_token=… in the iframe URL itself
   - As Authorization: Bearer … on every fetch from inside the iframe

5. Credible middleware:
   - Verifies signature
   - Checks audience matches the request's Origin
   - Checks expiry
   - INJECTS filterParams from token claims as mandatory where: clauses
     on every downstream Malloy query. Customer's frontend can't bypass —
     the token is signed.
```

**What's needed on Credible's side (real work):**

- `POST /api/v0/embed-tokens` endpoint (in the platform middleware, not Publisher).
- Service-account auth for the customer to call this endpoint.
- JWT signing key management (rotation, multiple active keys).
- Middleware that:
  - Validates JWT on iframe load (query param) and API calls (Bearer header).
  - Checks `aud` claim against `Origin` header.
  - Reads `filterParams` from token claims.
  - Forwards to Publisher's query endpoint with those params (Publisher itself needs no changes — it already accepts `filterParams`).
- Customer-facing UI for service-account credentials.
- Per-customer rate limiting + abuse controls.

**Pros:**
- Customer needs no proxy — token mint can be a single backend call.
- Per-embed scoping and expiry give a tighter security story than long-lived keys.
- Audit trail at the `(token, embed)` granularity.
- Time-bounded automatically (revocation just means stop issuing new tokens).

**Cons:**
- Real Credible-side infrastructure to build and operate (signing keys are high-value).
- More moving parts than the proxy pattern; customer's frontend needs to refresh tokens before they expire.

**This is the right path for productizing embedded analytics — Credible owns all the trust, customer integration is a few API calls.**

## D. End-user signs into Credible (Auth0 SSO redirect)

**When:** the embed lives in a customer's product, but the *end user* is a Credible user (e.g. an analyst, a customer admin who has a Credible account). Often used for "give me the full Malloy/Credible UX inside my product."

**How it works:**

```
1. Customer's app embeds:
   <iframe src="https://publisher.credibledata.com/environments/.../index.html">

2. Iframe loads. Runtime calls /api/v0/...
   No cookie present → middleware returns 401 (or 302 → login).

3. Runtime triggers a login flow:
   (a) **Popup login (recommended):** runtime calls
       window.open("https://app.credibledata.com/login?return=...").
       User signs in there (top-level credibledata.com window — first-party
       context, cookie sets cleanly). After login, the popup redirects to a
       small Credible bounce page that postMessages back to the parent and
       closes itself.
       Runtime retries the original fetch; cookie is now present.
   (b) **In-frame redirect:** runtime sets iframe src to the login URL.
       After login, iframe navigates back to the dashboard URL.
       Cleaner UX but breaks under third-party-cookie restrictions on
       Safari/Chrome — popup is the safer default.

4. Once the cookie is set on .credibledata.com, every subsequent
   fetch from inside the iframe carries it automatically.
```

**What's needed on Credible's side:**

- Auth0 Regular Web App tenancy (already exists — that's how the SPA works today).
- A dedicated post-login bounce page that posts a message and closes itself, so the runtime knows to retry.
- Cookie config from pattern A (`Domain=.credibledata.com`, `SameSite=None; Secure`).
- Per-package access control: which Credible users/groups can see which packages.

**What's needed in the runtime:**

```js
Publisher.embed("#x", {
   src,
   login: "popup" | "redirect",   // default: "popup"
});
```

On a 401 response, runtime triggers the login flow, awaits completion, retries the fetch.

**Pros:**
- No customer backend integration at all — the customer just embeds the iframe.
- Standard OAuth flow that everyone (including auditors) understands.
- Per-user audit trail naturally; no shared service-account credential.
- Fits well when the embedded view is "the same Credible UI my analyst would use, just embedded somewhere else."

**Cons:**
- Friction: end-user has to sign in to Credible (one extra step the first time).
- Third-party-cookie issues on Safari/Firefox/Chrome ITP — popup login mostly avoids this but it's a moving target.
- The end-user *is* a Credible user — they need an account, which means provisioning concerns (SCIM? per-customer Auth0 tenant? how do customers manage their users?). This is the deepest part of the design.

**This is the right pattern when end-users are Credible users — analysts, partners, customer admins.**

## E. Public package flag (no auth)

**When:** the dashboard is meant to be public — marketing pages, share links for case studies, leaderboards.

**Sketch:** package config has `"public": true`. The middleware lets unauthenticated reads through, optionally with rate limiting and a deliberately limited query surface (named queries only, no ad-hoc Malloy). Not built; not urgent.

## How the patterns layer

Most production deployments use two or three at once:

- **Internal Credible UIs** → A (cookie). Already works.
- **Customer integrations where their users are Credible users** → D (SSO). Cleanest UX once the cookie/Auth0 plumbing is right.
- **Customer integrations where their users aren't on Credible** → B (proxy) for "we want to ship today" or C (JWT) for "we're productizing this."
- **Public dashboards** → E. Add when needed.

The Publisher's `/api/v0/.../query` endpoint already accepts `filterParams`, so the *enforcement plumbing* is the same across B, C, and D — only the trust boundary moves.

## What's needed in the runtime (cross-cutting)

Today's `/sdk/publisher.js` already supports the auth-relevant primitives:

- `credentials: "include"` on all fetches → patterns A & D work.
- `Publisher.setToken(token)` → patterns C works (Bearer).
- `Publisher.embed("#x", { token })` → token forwarded as `?embed_token=…` query param to the iframe URL → pattern C.

What it doesn't yet do:

- Login flow on 401 (pattern D popup retry).
- Token refresh before expiry (pattern C).
- 401-aware error UI (helpful banner saying "Sign in to view this dashboard").

Those are small additions when D becomes a priority.

## Recommendation for Credible's first iteration

1. **Lock down the cookie config** so pattern A works end-to-end on `*.credibledata.com`. This is mostly an Auth0/middleware config job. Probably an afternoon.
2. **Polish the API key + proxy pattern (B)** for the first customer who wants to embed — they probably already have a backend, and this is the path with the least new Credible infra. The key safety property is the proxy injecting `filterParams` strictly; document that pattern in `docs/embedded-data-apps-auth.md` and provide a sample proxy implementation.
3. **Build the JWT flow (C)** when the second customer arrives, or when one customer wants a more polished integration without running their own proxy.
4. **Build the SSO popup flow (D)** when there's demand for end-users to be Credible users — this requires a thoughtful provisioning story (per-customer Auth0 tenant? SCIM?) and is the deepest design question.

Patterns B and C use the same `filterParams` enforcement — the only difference is whether *the customer's proxy* or *the JWT signature* is the trusted source of those params. So work on B is not wasted when C ships later.
