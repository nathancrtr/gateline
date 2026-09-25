# Technical Plan: a public, read-only Gatehouse demo on gateline.dev

## Approach

The demo is the existing Gatehouse web app, built once in a static mode, beside a tree of JSON files written by a script that asks the server's own routes for every read. Nothing new renders anything. A run's URL in the demo is the live cockpit's URL under `/demo/`, and every read the page makes lands on a file whose name is the live route plus `.json`.

Three small changes make the live app servable from files:

- The artifact read gains a path form, `/artifact/<path>`, beside today's query form, so every read is addressable as a file (R1).
- A static-mode switch in the web build prefixes URLs with the base path, appends `.json` to reads, and never opens the event stream (R4, R6).
- Runs from the fixture source carry a visible label, keyed on that source's id (R3).

Content selection is a thin source wrapper. It reads each run's `state.yaml` at the repository's default branch and lists exactly the runs whose phase is `done`, so a newly finished run appears on the next build with no code change (R2). The fixture repository is generated at build time, as `gateline ui --demo` does, and mounted as a second source.

The generator is a script under the server package that binds no port (R1, R4). In one pass it:

- builds the Hono app in process and dispatches each GET through `app.request`, writing each body to disk;
- copies the static web bundle into the same tree;
- writes one `index.html` per route so deep links resolve on a plain file host (R6).

The Pages workflow does the same work on every pull request and push (R7). It builds the bundle and the snapshot into `_site/demo/`, then proves they render with a Playwright pass over a Pages-like static server. A repository variable, off by default, decides whether `demo/` survives into the uploaded artifact (R8). Mutations are untouched: the app posts to the same routes, the host has nothing there, and the existing failure path renders (R5).

## Interface contracts

### Wire contract additions — `packages/server/src/contract.ts`

```ts
/** The source id the demo snapshot assigns to the generated fixture repository.
 *  The web labels runs from this source as fixture data (R3). */
export const FIXTURE_SOURCE_ID = 'fixture'

export interface ApiRoutes {
  // …existing keys unchanged…
  /** Path form of the artifact read: the remainder after `/artifact/` is the
   *  run-relative artifact path, URL-encoded per segment. Same response as
   *  the query form, which stays for older clients. */
  'GET /api/runs/:src/:slug/artifact/*': { response: ArtifactResponse }
}
```

No `API_VERSION` bump: nothing is removed or narrowed.

### Server route — `packages/server/src/app.ts`

```ts
app.get('/api/runs/:src/:slug/artifact/*', handler)
// remainder = decodeURIComponent(pathname.match(/^\/api\/runs\/[^/]+\/[^/]+\/artifact\/(.+)$/)[1])
// empty remainder → 400 { error: 'artifact path required' }; otherwise identical
// behaviour and body to the query form (404 run not found, 404 no artifact).
```

Both forms call one private helper so they cannot drift.

### Web client URL resolution — `packages/web/src/static-mode.ts` (new)

```ts
export interface StaticModeEnv { baseUrl: string; isStatic: boolean }
/** From import.meta.env.BASE_URL and import.meta.env.VITE_GATELINE_STATIC === '1'. */
export const env: StaticModeEnv
export function pathPrefix(e: StaticModeEnv): string          // '/' → '', '/demo/' → '/demo'
export function readUrl(path: string, e?: StaticModeEnv): string  // prefix + path (+ '.json' when static); throws if static and path contains '?'
export function writeUrl(path: string, e?: StaticModeEnv): string // prefix + path, never suffixed
export function eventsUrl(e?: StaticModeEnv): string | null      // null when static
export function routerBasename(e?: StaticModeEnv): string        // pathPrefix(e) || '/'
```

`api.ts`: every GET goes through `readUrl`, every POST through `writeUrl`, and `api.artifact` requests
`/api/runs/${src}/${slug}/artifact/${path.split('/').map(encodeURIComponent).join('/')}`.
`use-live.ts`: no `EventSource` is constructed when `eventsUrl()` is null.
`main.tsx`: `createBrowserRouter(routes, { basename: routerBasename() })`.

### Web build — `packages/web`

```
vite.config.ts   defineConfig(({ mode }) => ({ base: mode === 'static' ? '/demo/' : '/',
                   build: mode === 'static' ? { outDir: 'dist-static' } : undefined, …unchanged… }))
.env.static      VITE_GATELINE_STATIC=1
package.json     "build:static": "tsc -p tsconfig.json && vite build --mode static && node scripts/check-bundle.mjs dist-static"
check-bundle.mjs optional argv[2] = dist dir relative to packages/web (default "dist")
src/vite-env.d.ts  /// <reference types="vite/client" /> + ImportMetaEnv.VITE_GATELINE_STATIC?: string
```

### Fixture label — `packages/web/src/components/fixture-label.tsx` (new)

```ts
export function isFixtureSource(source: string): boolean   // source === FIXTURE_SOURCE_ID
export function FixtureLabel(props: { className?: string }): JSX.Element
// renders <Imp tone="hatch" data-fixture-label title="…">fixture data</Imp>; visible text, never hover-only
```

Rendered in the run header (`pages/run.tsx`), each inbox row (`pages/inbox.tsx`) and each portfolio row (`pages/portfolio.tsx`) when `isFixtureSource(<summary|item>.source)`.

### Snapshot generator — `packages/server/src/snapshot.ts` (new)

```ts
/** RunSource over a LocalGitSource that lists only runs whose state.yaml at the
 *  default branch parses with phase 'done'; every other member delegates. */
export class DoneOnDefaultBranchSource implements RunSource {
  constructor(inner: LocalGitSource)
  survey(): Promise<{ included: string[]; excluded: { slug: string; reason: string }[] }>
  listRuns(): Promise<RunRef[]>   // RunRef { source: id, slug, ref: <default branch>, kind: 'default', branch: `run/${slug}` }
}
export const SNAPSHOT_GLOBAL_ROUTES = ['/api/health', '/api/engine-health', '/api/inbox', '/api/runs', '/api/staging', '/api/metrics'] as const
export const SNAPSHOT_RUN_ROUTES = ['', '/lexicon', '/evidence', '/g1', '/reviews', '/decisions', '/diff'] as const
export const ROUTE_SHELLS = ['', 'portfolio', 'portfolio/new', 'metrics'] as const   // plus runs/<src>/<slug> per run
export interface SnapshotReport {
  routes: string[]; runs: { source: string; slug: string }[]; shells: string[]
  excluded: { slug: string; reason: string }[]
}
export async function buildDemoSources(opts: { repo: string; repoId: string }): Promise<{ sources: RunSource[]; fixtureDir: string; real: DoneOnDefaultBranchSource }>
export async function writeSnapshot(app: Hono, opts: { outDir: string; webDist?: string; excluded?: SnapshotReport['excluded'] }): Promise<SnapshotReport>
```

CLI (`"snapshot": "node src/snapshot.ts"` in `packages/server/package.json`):

```
node server/src/snapshot.ts --repo <path> --out <dir> [--repo-id gateline] [--web-dist <dir>]
```

Exit 1, naming the route, on any non-2xx response or thrown error. Both sources are constructed `localOnly: true` (no fetch, no push, `originUrl` null).

### Demo tree layout (`<out>` = `_site/demo`)

```
index.html  assets/…                                # the static web bundle (asset URLs under /demo/)
portfolio/index.html  portfolio/new/index.html  metrics/index.html
runs/<src>/<slug>/index.html                        # one per run in runs.json
api/{health,engine-health,inbox,runs,staging,metrics}.json
api/runs/<src>/<slug>.json
api/runs/<src>/<slug>/{lexicon,evidence,g1,reviews,decisions,diff}.json
api/runs/<src>/<slug>/artifact/<artifact path>.json  # one per entry in that run's detail.artifacts
```

No file under `<out>` is executable or a server; `POST` targets have no file.

### Pages-like static server — `packages/web/scripts/serve-static.mjs` (new, node:http only)

```
node web/scripts/serve-static.mjs --root <dir> --port <n>
```

GET/HEAD only (anything else → 405). Exact file → 200 with MIME by extension. Directory without trailing slash → 301 to the slashed path, query preserved. Directory → its `index.html`. Missing → 404 with `<root>/404.html` as body when present. Paths escaping `<root>` → 404.

### Static render check — `packages/playwright.static.config.ts` + `packages/e2e-static/demo.spec.ts` (new)

```ts
// config: testDir './e2e-static', baseURL http://127.0.0.1:4397,
// webServer: node web/scripts/serve-static.mjs --root ${DEMO_SITE_ROOT ?? '../_site'} --port 4397,
//            url http://127.0.0.1:4397/demo/api/health.json
// root package.json: "e2e:static": "playwright test -c playwright.static.config.ts"
```

### Pages workflow — `.github/workflows/site-pages.yml`

- `actions/checkout@v4` with `fetch-depth: 0`.
- After the existing assemble step: `npm run build:static -w @gateline/web`, then the snapshot CLI with `--out "$GITHUB_WORKSPACE/_site/demo" --web-dist web/dist-static`, then `npx playwright install --with-deps chromium && npm run e2e:static` with `DEMO_SITE_ROOT=$GITHUB_WORKSPACE/_site`.
- `if: vars.GATELINE_PUBLISH_DEMO != 'true'` → `rm -rf _site/demo` before `upload-pages-artifact`.
- Repository variable: `GATELINE_PUBLISH_DEMO`, "on" value is the string `true`; unset or anything else is off.
- `push` trigger paths additionally include `runs/*/state.yaml`. The `pull_request` paths are unchanged.

## Decisions (ADRs)

### ADR-1: Static reads are files named by the live route plus a `.json` suffix
- **Choice:** In static mode the client appends `.json` to every GET path, and the generator writes each response to `<out><route>.json`. `/api/runs` becomes `api/runs.json`, and `/api/runs/fixture/g2-pending` becomes `api/runs/fixture/g2-pending.json`.
- **Rejected:** Keeping the live URLs byte for byte and relying on directory indexes — a route that is both a file and a directory prefix cannot exist on a filesystem. Serving JSON from an index page would depend on each host's redirect and index rules, and a plain server would answer with the wrong content type.
- **Consequences:** Every read the app makes must be a query-free path, which is what ADR-2 arranges. The static tree is a pure function of the live route table, so any static server that maps paths to files can host it. Live behaviour is unchanged because the suffix applies only under the static flag.

### ADR-2: The artifact route gains a path form and the web client switches to it
- **Choice:** Add `GET /api/runs/:src/:slug/artifact/*` to the server, sharing the query form's handler, and point `api.artifact` at it for every build. The query form stays and the wire version does not bump.
- **Rejected:** Mapping the query form to a file only inside the static client — the generator would then write files under a URL grammar the live server never serves, and the client would carry two grammars for one call. Both are second sources of truth for the one route the static host cannot serve as written.
- **Consequences:** One route grows a sibling and one client call changes shape. Older clients keep working because the query form remains. The artifact viewer works identically in the live cockpit and the demo, so a visitor's deep link into an artifact is shareable.

### ADR-3: Content selection is a wrapping source that reads `state.yaml` at the default branch
- **Choice:** A `RunSource` wrapper over `LocalGitSource` lists the default-branch run directories, parses each `state.yaml`, and keeps exactly those with phase `done`, read at the default branch as `kind: 'default'`. Everything else delegates to the inner source.
- **Rejected:** Filtering the inner source's own run list — that list walks every run branch, and a branch that moved after its merge is served at the branch rather than at the default branch. The requirement names the copy on the default branch, and the branch walk is also the slow path over this repository's dozens of kept branches.
- **Consequences:** A run appears the build after it reaches done on the default branch, with no slug list anywhere. A finished run whose `state.yaml` fails the schema is excluded and named in the generator's log, so an omission is visible rather than silent. Core is untouched.

### ADR-4: Static mode is a Vite build mode with one flag and a fixed base path
- **Choice:** `vite build --mode static` sets `base: '/demo/'` and `outDir: 'dist-static'`, and `.env.static` sets `VITE_GATELINE_STATIC=1`. A new `static-mode.ts` reads both into one object that `api.ts`, `use-live.ts` and `main.tsx` consume.
- **Rejected:** Detecting static hosting at runtime by probing a request — the app would behave differently before and after the first failed fetch. The event stream would already be open and failing before the probe answered, and the answer would depend on the host's error page. A build-time decision is inspectable in the bundle.
- **Consequences:** Two builds exist, and the static one lands in a separate directory so a local cockpit never serves a bundle whose asset URLs point at the demo path. The base path is fixed to `/demo/`, matching the site path the brief names. The live build's behaviour is unaffected because every branch keys on the flag or on a base of `/`.

### ADR-5: Fixture runs are labelled by a shared source id constant in the wire contract
- **Choice:** `FIXTURE_SOURCE_ID = 'fixture'` lives in `contract.ts`, the generator names the fixture source with it, and the web renders a visible chip wherever a run's `source` equals it.
- **Rejected:** A new per-run field in the response saying whether the source is illustrative — that changes the wire shape and every fixture assertion in the server tests for a fact that is a property of one deployment, not of a run. An environment list of fixture ids would put the same fact in a build variable that can drift from the generator.
- **Consequences:** The contract module carries a second value beside the version number, still a browser-safe primitive. The label is a client-side rule over data the client already has, so no server test moves. The local demo server keeps its own source naming and shows no label, which the spec does not ask for.

### ADR-6: One server-side script owns the whole demo tree, including route shells
- **Choice:** `packages/server/src/snapshot.ts` builds the sources, dispatches every GET through `app.request`, writes the JSON tree, copies the static bundle, and writes an `index.html` per route. The workflow calls it once.
- **Rejected:** Splitting the work between the script and shell steps in the workflow — the list of routes that need a shell is the list of runs the script just discovered, and duplicating it in YAML is a second source of truth. A `gateline snapshot` subcommand is the brief's stated out-of-scope call.
- **Consequences:** The script is runnable with nothing installed beyond the workspace, and is tested with vitest over the fixture like the route tests. It runs as TypeScript under Node 24, so it must use only erasable syntax and explicit `.ts` import extensions, which is this workspace's idiom. Any route answering non-2xx fails the build by design.

### ADR-7: The pull-request render check is Playwright over a Pages-like static server
- **Choice:** A small `node:http` server mimics the file host's rules, and a Playwright project loads the demo's routes from the assembled `_site` tree and drives the refusal paths. The Pages `build` job runs it on every pull request and push.
- **Rejected:** Checking only that every expected JSON file exists and parses — that proves the generator ran, not that a page renders against it. The requirement is explicit that a page failing to render must fail the pull request, and only a browser can say whether a page rendered.
- **Consequences:** The Pages job installs Chromium, roughly a minute more per run. The static server is a model of the host, not the host, so its redirect and 404 rules are written down and can be corrected if the first publication disagrees. The same server is what a verifier uses locally.

### ADR-8: Publication is one repository variable read at upload time
- **Choice:** `GATELINE_PUBLISH_DEMO` unset or not `true` removes `_site/demo` after the render check and before `upload-pages-artifact`. Setting it to `true` keeps the directory on the next `push` build with no code change.
- **Rejected:** A second workflow or a separate Pages environment for the demo — the site is one artifact deployed by one job, and a second deploy target contradicts the brief's single-path constraint. Skipping the demo build when the variable is off would leave the demo unverified exactly while it is being readied.
- **Consequences:** The build is complete and verified on every run whether or not it publishes. Flipping the variable is a human act outside this run's diff. The pull-request run cannot deploy, as today, because the deploy job keeps its push-only condition.

### ADR-9: A finished run on the default branch triggers a site rebuild
- **Choice:** Add `runs/*/state.yaml` to the `push` trigger's paths, so a run reaching `done` on the default branch refreshes the demo's content on the next deploy. The `pull_request` paths are unchanged.
- **Rejected:** Leaving the triggers alone — the demo would then show the finished runs as of the last site or packages change, which could lag the repository by weeks. Adding the path to pull requests too was rejected because every run branch push would build the site for a change that cannot break it.
- **Consequences:** Pushes to the default branch that only touch a run's state file now build the site, which is one job per merged run. The content requirement holds at publish time rather than only at code-change time. Nothing changes for pull requests.

## Requirement → task mapping
| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-artifact-path-route, 02-snapshot-generator |
| R2 | 02-snapshot-generator |
| R3 | 04-fixture-label, 05-static-render-check |
| R4 | 02-snapshot-generator, 03-web-static-mode, 05-static-render-check |
| R5 | 03-web-static-mode, 05-static-render-check |
| R6 | 02-snapshot-generator, 03-web-static-mode, 05-static-render-check |
| R7 | 05-static-render-check, 06-pages-workflow |
| R8 | 06-pages-workflow |
| R9 | 02-snapshot-generator, 06-pages-workflow |

Execution order: `01` first, then `02`, `03`, `04` in parallel, then `05`, then `06`.

## Risks

- **Unexecuted mechanisms.** This plan was written without a shell, so four documented APIs are pinned from their docs and the codebase's existing use, not from a run here: Hono's `*` wildcard after named params, Vite's `--mode` with `.env.<mode>` and mode-keyed `base`/`outDir`, `import.meta.env.BASE_URL` under vitest, and Playwright's `webServer`. Early signal: the first `npm test` and `npm run build:static` in tasks 01 and 03. Each is a one-line fix if the shape differs.
- **The static server is a model of GitHub Pages.** The directory redirect preserving query strings, extension-based MIME, and the root `404.html` fallback are written from Pages' documented behaviour. Early signal: the first `push` build with the variable on, which is a follow-up. If Pages differs, `serve-static.mjs` is corrected to match and the e2e reruns.
- **Pages job time and network.** Full history, fixture generation, a second web build, Chromium install, and a Playwright pass all land in one job. Early signal: the `build` job exceeding about eight minutes, or Chromium install flakes. Mitigation is caching the Playwright browser, not dropping the check.
- **A `done` run the schema rejects vanishes.** `parseRunState` is stricter than the literal "reads `phase: done`". Early signal: the generator's `excluded` log naming a slug the verifier expects (at spec time: `creation-seam`, `dupefind`, `local-only-mode`, `mdtoc`, `web-staging`, `wordfreq`, `writestate-kill-window`).
- **Frozen clock.** Every response's `now` is the build time, so "waiting 3d" reads as of the last deploy and the run page's "Updated" uses the visitor's clock. Acceptable for a record reader. Early signal: none needed, but the follow-up copy pass should say the snapshot's date somewhere visible.
- **Router basename and trailing slashes.** A deep link redirected to `/demo/runs/<src>/<slug>/` must still match `runs/:src/:slug` under a `/demo` basename. React Router ignores trailing slashes by default. Early signal: the deep-link test in task 05.
- **Cost of the `runs/*/state.yaml` trigger.** Each run merging to the default branch now runs the Pages build. Early signal: Actions minutes on the site workflow. Reversal is one line in the trigger.
