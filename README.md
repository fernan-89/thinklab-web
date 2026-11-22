# thinklab-web

Web app v1 for the ThinkLab platform: the first screen a non-technical person can use. It talks only to the
platform gateway and covers three jobs.

| Screen | What it does | Backed by |
|---|---|---|
| **Assets** | List and filter assets, open one to see its specifications and audit log, move it through its lifecycle (only legal transitions are offered). | `it-asset-registry` |
| **Discovery** | Review queue: claim a discovered item, set its category, ignore it, or promote it into a real asset. A refused promotion shows the schema violations the registry returned. | `it-discovery` (and `ci-type-catalog` through the registry) |
| **Topology** | The dependency graph drawn left to right (dependents on the left), and a **blast radius** for any node: pick a node, a direction (upstream = what a failure there would hit) and a hop limit, and the reached nodes light up by distance. | `it-topology-graph` |

The **Quick Install** screen (`/quick-install`) is the web face of the add-on [thinklab-quickinstall](https://github.com/fernan-89/thinklab-quickinstall), an unattended Ventoy install stick: it lists the systems, languages and editions the stick can install, its rules and its known limits. It shows a bundled, sanitised catalog of what the stick can install (`src/quickinstall/kits.ts`) and, from the `it-install-kit` service, the kits, the stick definition and the install reports of the organisation; keep that file in step with the add-on's `config/catalog.json` when the add-on changes.

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

With Docker, `thinklab-platform`'s `docker-compose.yml` has a `web` service on `http://localhost:3000`, behind a compose profile: `docker compose --profile web up -d --build`.

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
src/i18n/       the PT/EN dictionaries (en.ts is the source, pt.ts is typed against it), the provider and the helpers for statuses, actions and option labels
src/components/ layout, the rail (language and theme switch), feedback banners
src/pages/      one file per screen
src/topology/   layered graph layout (pure, tested) and the SVG view
src/theme.ts    system / light / dark, kept in this browser
```

## Languages and theme

The app speaks Portuguese (Brazil) and English; the rail at the left edge (bottom right on a narrow window) switches the language and the theme. With no choice made, the browser's language and the system's colour scheme decide.

- `src/i18n/en.ts` holds every text with a key (`{name}` marks a value filled in); `pt.ts` is typed `Record<MessageKey, string>`, so the compiler names a key that is missing in Portuguese. Use `const { t } = useI18n()` and `t('key', { name })`.
- Text that is not ours is shown as it arrives: error titles and details from the services, asset categories, and technical values such as `AWS` or `USD`.
- Enum values (statuses, levels, kinds) go through `status()`, `enumValue()` or `label()` (`statusPt`, `labelPt` and `actionPt` map the English text to Portuguese); English keeps the API's own text. Tests fail when a status with a colour class, an action label or an option of the tables in `api/types.ts` has no Portuguese.
- Dates use `locale` (`pt-BR` or `en-GB`) from `useI18n()`.
- The Portuguese was written by the developers of this app and has not been reviewed by a native speaker of the audience.

## Known limits (v1)

- Read and review only: assets, discovered items and graph nodes/edges are not created from the UI (collectors and the API do that).
- The Asset FSM buttons mirror the backend rules in `src/api/services.ts`; the API remains the authority and its refusal is shown.
- The graph is drawn with a small built-in layout, fine for tens of nodes; a large graph needs a proper graph library.
- No token refresh: when the access token expires, sign in again.

## License

Licensed under the [PolyForm Strict License 1.0.0](LICENSE): you may read and use this software for noncommercial purposes only. Modifying it, creating derivative works, redistributing it and any commercial use are not permitted without a separate written license. This software is not open source.
