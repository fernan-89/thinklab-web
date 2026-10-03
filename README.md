# thinklab-web

Web app v1 for the ThinkLab platform: the first screen a non-technical person can use. It talks only to the
platform gateway and covers three jobs.

| Screen | What it does | Backed by |
|---|---|---|
| **Assets** | List and filter assets, open one to see its specifications and audit log, move it through its lifecycle (only legal transitions are offered). | `it-asset-registry` |
| **Discovery** | Review queue: claim a discovered item, set its category, ignore it, or promote it into a real asset. A refused promotion shows the schema violations the registry returned. | `it-discovery` (and `ci-type-catalog` through the registry) |
| **Topology** | The dependency graph drawn left to right (dependents on the left), and a **blast radius** for any node: pick a node, a direction (upstream = what a failure there would hit) and a hop limit, and the reached nodes light up by distance. | `it-topology-graph` |

## Sign-in

Two modes on the login page:

- **Local stack** (platform running with security off, the default): enter an organisation id and your name. They are sent as
  `X-Tenant-Id` and `X-Executor`, and your name lands in every audit entry.
- **Account** (security on): organisation id, email and password go to `party-authentication`; the access token is then sent as a
  bearer token and the gateway derives the tenant and identity from it.

The session lives in `sessionStorage` (gone when the tab closes).

## Running

Needs the platform gateway on `http://localhost:8088` (see `thinklab-platform`).

```bash
npm install
npm run dev        # http://localhost:5173, /api is proxied to the gateway
```

Another gateway: `THINKLAB_GATEWAY_URL=http://host:port npm run dev`.

The browser only ever calls `/api/...`. Vite's dev server and, in the container, nginx forward that to the gateway with the
prefix stripped, so there is no CORS setup and no gateway URL baked into the bundle.

With Docker, `thinklab-platform`'s `docker-compose.yml` has a `web` service on `http://localhost:3000`.

## Checks

```bash
npm run typecheck
npm test           # vitest + Testing Library, API calls faked at the fetch boundary
npm run build
```

CI runs the same three on every push.

## Layout

```
src/api/        fetch client (tenant/executor/bearer headers, RFC 7807 -> ProblemError), per-service wrappers, DTO types
src/auth/       session context
src/pages/      Login, Assets, Discovery, Topology
src/topology/   layered graph layout (pure, tested) and the SVG view
```

## Known limits (v1)

- Read and review only: assets, discovered items and graph nodes/edges are not created from the UI (collectors and the API do that).
- The Asset FSM buttons mirror the backend rules in `src/api/services.ts`; the API remains the authority and its refusal is shown.
- The graph is drawn with a small built-in layout, fine for tens of nodes; a large graph needs a proper graph library.
- No token refresh: when the access token expires, sign in again.

## License

Licensed under the [PolyForm Strict License 1.0.0](LICENSE): you may read and use this software for noncommercial purposes only. Modifying it, creating derivative works, redistributing it and any commercial use are not permitted without a separate written license. This software is not open source.
