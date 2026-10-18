# Liapoldus Studio — TODO

## Exact-source macOS candidate for current editor and secret workflow — 2026-10-18

- Current published Studio source HEAD: `bf2ea676d5d3f912ee3f369070562695ba6480fd`. The macOS/arm64 app at `build/bin/Liapoldus Studio.app/Contents/MacOS/studio` has SHA-256 `910320ef7176a8db582a8343e262e8fa1f61923c06d2d7ba9d93a8727a58c53e` and was built from this source after `make check`, `make check-race` and `make desktop-build` passed.
- Matching Server Editor package `0.3.63` is at `../plugins/studio-server/dist/liapoldus.server-editor-0.3.63.studio-plugin`, SHA-256 `2c6befb58d3a27d5a7e2c58fe7c65da06387b6b28d5ccd06dc7eadd683a333d8`; its package workflow passed 83/83 plugin tests and Studio package inspection.
- Native launch and package trust for these exact hashes have not yet occurred. Until then, macOS WebView handshake, settings editing and the end-to-end local secret rotation flow are not claimed as accepted.
- Fresh targeted checks passed: `GOTOOLCHAIN=go1.26.0 GOWORK=off GOFLAGS=-p=1 go test ./internal/presentation/wails -run '^TestLocalServiceSecretManager' -count=1` and `./node_modules/.bin/tsx --test ../tests/frontend/serviceSecrets.test.mts` (8/8). These verify the typed CLI/stdin boundary, input clearing/error redaction and reviewed rotation/apply recovery; they do not replace macOS WebView acceptance.

## Current secret workflow candidates — 2026-10-18

- Latest read-only macOS preflight: the already-open Studio window still shows
  the previous secret-manager explanation and `Could not load local secrets`.
  The process predates the rebuilt `7c2fa69` app candidate and has not been
  relaunched. CLI `/Users/docup/go/bin/liapoldus` remains SHA-256
  `f04d7b013f11cbf5848ba80291bb8b2b85b5dbeaf40f2cb97ae319b38c3419d1`; typed
  `runtime status --target local` reports Core, Echo and Server running. These
  checks changed no Project, target, container or secret state.
- The current macOS/arm64 Studio app candidate is
  `build/bin/Liapoldus Studio.app/Contents/MacOS/studio`, SHA-256
  `175d3f7a298bd647f48ddfba549f9bcf89c3b1db6686721b60abe43b97f9f02d`, built
  from source commit `7c2fa69` with `make desktop-build`. It includes the
  corrected explanation that the private mount is visible to Core and that
  service replicas receive values only through scoped mTLS grants. It has not
  been launched; the already-open Studio process was started from the previous
  `6b844d41870d6e55d88c350baf0f8fd09b088e58361beae80631603ba324121e` binary.
- Exact local candidates are prepared for the next native acceptance: CLI
  `06ea0d658d160517a0ba899c096974cff1e9d70cd16fd0ed3be4a2265390c788`, Core
  `637e881a050e340dba5f16b07b01a0b1f1d6c27d7f9a824f6e89b428570102d4`, Server
  `784923bea75c65b2ea7eb4ca325bb413e3ef0eef1a84005798e7059762280b60`, and
  Server Editor package `f8a31ecfb01f796cc9c2267ada0075d08c7870c9f293dab9318d9dbd51be05cf`.
- The CLI candidate is `/tmp/liapoldus-cli-2026-10-18-bedd9ba`, built from
  source commit `bedd9ba`; it scopes Core's private secret mount to selected
  Project settings, preserves the active secret until replica ACK, and routes
  stopped-Core recovery through the selected Project. The previous `e0a60a59…`
  candidate is superseded. Core, Server and Server Editor digests remain as
  listed above. Exact confirmation for these digests is pending; none has been
  installed or trusted in this checkpoint.
- Source-level Studio rotation/apply tests and `make check`, `make check-race`,
  and `make desktop-build` are recorded below. Full macOS WebView acceptance,
  multi-replica ACK/timeout/restart recovery, and successful retirement of an
  old secret remain open until the approved exact artifacts are used against
  `Server Echo Studio` / `local`.
- Repeated host gates on the current application source: bundled-Node `make
  check` passes (179/179 frontend tests, Wails binding reproducibility, Go/TS
  lint, typecheck, vet and build); `make check-race` passes. The updated
  desktop candidate passes `make desktop-build`, binding reproducibility and
  lint; exact-digest launch confirmation remains pending.

## Secret retirement host boundary — 2026-10-18

- Studio's typed `service.secret.revoke` intent now passes the open Project root
  explicitly. CLI `f60ce65` snapshots that Project, verifies that service
  settings no longer contain the reference, and blocks revocation unless every
  Core-reported replica is ready on the exact settings digest and acknowledged
  generation. Follow-up `7e7d607` makes local cleanup retryable after Core has
  revoked the reference: it rechecks the Project and replica ACKs, skips a
  duplicate revoke, then clears the local runtime copy, index and OS vault.
  CLI regression tests cover stale Project, digest mismatch, an unready replica
  and interrupted cleanup; `make check` and `make test-race` pass. Live
  multi-replica and crash/restart acceptance still require the current CLI/Core
  binaries and the action-time install confirmation recorded below.

## Rotation configuration apply handoff — 2026-10-18

- Fixed the Studio rotation flow so the reviewed replacement is written to the
  canonical Project settings, then explicitly submitted through the existing
  typed Core apply path. Previously, the plugin save deliberately paused
  auto-apply but the secret manager only checked replica readiness, leaving the
  new reference saved yet unapplied.
- If the first apply fails after the Project save, the old reference remains
  active and the UI keeps the redacted JSON-pointer diff and offers an explicit
  retry for the saved candidate. Rotation still cannot revoke the old
  reference until the exact digest/generation is acknowledged by every
  required ready replica.
- The rotation manager now follows the same recovery boundary as the Inspector:
  a saved Core operation must be reconciled first, while a terminal failed
  apply offers the typed `dev.apply.retryFailed` path separately from a fresh
  apply. Both choices require explicit confirmation and keep the prior
  reference active.
- Secret values in the local vault are manually supplied by the operator, not
  generated/managed by an external provider. The UI now says to obtain the new
  provider value before staging a replacement; automatic rotation remains
  unavailable without a provider integration, and expiry is shown only when a
  source supplies it. No scheduler is claimed.
- Regression coverage verifies all reviewed paths are replaced before save,
  explicit apply and failed-operation retry use the active Project/service
  draft key and correct typed intent, stale paths fail closed, and a Project
  still using the old reference is never applied. Targeted rotation tests pass
  8/8. Studio `make check` passes with 178/178 frontend tests,
  `make check-race` passes, and `make desktop-build` produces the macOS/arm64
  app with reproducible bindings. The existing Vite large-chunk advisory
  remains.

## Local runtime and packaged-editor preflight — 2026-10-18

- Current Project `Server Echo Studio`, target `local`: typed `runtime start`
  returned `runtime.completed`, `coreCreated: true`, `coreUpdated: false`, and
  registered Echo and Server. Typed `runtime status` reports all three
  containers running; both services report ready at generation 92. A local
  `GET /echo?text=studio-http-check-20261018` returned the matching
  `echo: studio-http-check-20261018` body.
- The Studio-selected `/Users/docup/go/bin/liapoldus` is stale for secret
  operations: `service secret list` returns `unsupported service command`.
  Current CLI commit `7e7d607` includes the fail-closed retirement gate and
  retryable post-revocation cleanup. Its built but unselected Darwin/arm64
  candidate is `/tmp/liapoldus-cli-2026-10-18-7e7d607`, SHA-256
  `606df83422fce3d0b2adbc438e6a57e0424cc39ffc3a4420c43a20179bd78f2a`; it has
  not been run by Studio. The previous `f60ce65` candidate reached the Core
  secret route, which returned HTTP 404.
- The running Core container label reports binary SHA-256
  `9189b7731207bd4434fcfbffa7d6a2083df1c1ceb79c1e9ae724c6199631b9b5` and
  lacks the new secret-catalog route. That container still runs the older Core
  code. After Core published `d7f82cd` with replica/incarnation-bound grants,
  the Linux/arm64 candidate was rebuilt at
  `/tmp/liapoldus-core-linux-arm64-2026-10-18-d7f82cd`, SHA-256
  `157fe9a08bd6c54888cef70abf173b13f34e56aa8666b1013bba0006b70fd1a7`.
  It is a static ELF aarch64 binary and has not been installed. The previous
  `b87dd1c` artifact predates this hardening and is superseded. The local secret
  workflow remains source-verified but not live-accepted.
- The running Studio UI has the existing Server Editor `0.3.55`. Studio's
  native trust review for `0.3.59` displayed the exact digest and seven
  requested permissions; install remains pending action-time confirmation.
  Package hash:
  `682bd7af7b2d61c312403628b7407fda7a621b9d9d565e65fa7004849cd9094f`.
  The package manifest requests `service.settings.read`,
  `service.settings.write`, `service.configuration-ui.read`,
  `service.resources.read`, `service.resources.publish`,
  `service.peer.catalog.read`, and `service.secrets.read`.
- After runtime start, refreshing service-editor assignments loaded Server's
  editorButtons metadata; global Settings showed server.endpoints assigned to
  the installed 0.3.55 page. Selecting Server on Canvas rendered the
  Редактор эндпоинтов button in its Inspector. Clicking it opened a separate
  Server tab with project Server Echo Studio, service server, and
  bridge_ready. Read-only route navigation reached GET /echo settings without
  changing the Project. This verifies binding/handshake for 0.3.55, but not
  the new 0.3.59 HTTP/security UI.
- Next: complete the native plugin trust action if confirmed, then update the
  host CLI/Core only through their typed Studio workflows with exact candidate
  digests and separate action-time confirmations. Re-run secret catalog and
  rotation paths only after the live Core route is present; preserve the
  currently working Server/Echo generation 92 until that gate is cleared.

## Cross-owner Server/editor and local-secret checkpoint — 2026-10-18

- Studio `make check`, `make check-race` and `make desktop-build` pass on this
  source tree. The full gate includes a production frontend build, reproducible
  Wails bindings, strict Go/TypeScript lint, Go tests/vet/build and all 176
  frontend tests. Vite reports its existing large-chunk advisory.
- Local secret management is implemented in Studio host UI, CLI and Core:
  native secure input sends values only through typed CLI stdin into the OS
  vault; Core and Projects keep opaque references/metadata; Studio's v2 bridge
  gives plugins only active service/purpose-filtered references. Rotation is
  manual/assisted and retains both references until Project no longer points
  at the old one and all required replicas acknowledge the exact digest and
  generation. No scheduler or remote secret backend is claimed.
- The Server Editor `0.3.59` source has compact route/default/listener/resource
  sections, per-route inherited overrides, redirect/reverse-proxy handlers,
  HTTP security controls and contextual secret selection. Its package passes
  plugin tests and Studio package inspection, but is not installed. The exact
  package digest still requires the normal native trust confirmation before
  macOS WebView acceptance.
- Settings migration preview preserves original Project bytes and fails closed
  on unknown/invalid fields. Sensitive changes persist to Project first, show a
  redacted before/after summary and require explicit apply confirmation; a Core
  refusal leaves the Project candidate available for retry.
- Live multi-replica rotation ACK/timeout/restart recovery, Server settings
  failure in a running Core, the packaged editor in macOS WebView, and hosted
  Windows/Linux release checks remain open. Do not mark those source-level
  checks as runtime acceptance.

## Studio plugin management split — 2026-10-17

- Kept package catalog, install/trust review, version inventory, removal, and
  global service-button assignments in the global Settings manager. The Project
  plugin page is now a usage view: connect an installed plugin and select its
  version from the right Inspector. Project pins live in the existing
  `workspace/v5` extension state and preserve unrelated state and filters.
- Activity-bar surfaces and service-editor buttons are restricted to the
  version pinned by the open Project. Service editor surfaces remain tied to
  declared service buttons; workspace surfaces remain available through the
  project plugin rail. No package is installed or removed by the Project UI.
- Fixed legacy installed plugin metadata that serialized `context: ""`;
  these surfaces now correctly default to the workspace context. Added
  regressions for legacy parsing and project-local version persistence.
- Verification: TypeScript, focused ESLint, Vite production build, and targeted
  model/package tests pass (28/28). The full frontend suite has one existing
  bindings-generation failure for `frontend/wailsjs/runtime/runtime.d.ts`; full
  `make check` is blocked by that same worktree state, and full lint reports
  generated-file `any` errors there. The pre-existing generated file was
  preserved. A live macOS UI check of this new view is still pending.

## Lease-expiry recovery checkpoint — 2026-10-17

- Current Studio Runtime → Status shows Core, Echo, and Server `running`;
  Core-backed metadata reports Server and Echo ready with desired/applied
  generation `68`. Studio Output records both service processes exiting with
  `service SDK replica lease expired`, followed by a Core-only stop/start and a
  successful typed `runtime.start` that re-registered both replicas. A fresh
  ordinary request to `/echo?text=lease-recovery-20261017` returned HTTP 200
  and `echo: lease-recovery-20261017`; Studio Output contains that exact text
  from Echo stdout.
- This lease-expiry event is distinct from the earlier deliberate per-service
  Server Stop during independence testing. The output establishes why the
  latest outage occurred, but not why lease renewal was missed (laptop sleep or
  a Core/network interruption are possibilities, not proven causes).
- Server Editor `.46` remains active; the local package digest matches
  `3b8c14ce0c3e450453060e556d02f8123423459950cc8525989cf15578829a1e`.
  No package replacement was necessary. Core DB, credentials, certificates,
  Project source and service artifact pins were not changed during this check.
- CLI source now maps the terminal lease error to the typed diagnostic
  `service_replica_lease_expired`; its focused regression passed in the prior
  implementation step. Studio still uses its selected CLI binary, which was
  not rebuilt/replaced for that source change. Recovery is operational, but
  automatic incarnation/certificate recovery and a live typed-diagnostic check
  remain open.

## Server Editor .46 Add/Delete draft consistency — 2026-10-17

- Rechecked on the current running Studio UI, Project `Server Echo Studio` /
  target `local`: Server Editor `.46` added temporary
  `GET /__studio_draft_probe_20261017` targeting Echo `echo.handle`, then
  removed it through the editor's confirmation. The extension returned to only
  the canonical `GET /echo`; no Project save, Core apply, or runtime action was
  invoked.
- After deletion, `.46` still showed `Сохранить в Project` enabled. Switching
  to the generic Canvas inspector showed only canonical `GET /echo`, and its
  `Сохранить и применить сейчас` and `Отбросить черновик` controls were
  disabled. Thus the shared Studio Project draft is clean while the extension
  displays stale dirty state. The issue remains reproducible in the current
  installed extension/build and is not closed by the existing Zustand patch
  compaction.
- Hardened the shared Zustand draft model: protected-array structural operation
  history is compacted when its projected collection returns to the canonical
  base, preserving unrelated sibling edits. This makes add-then-remove a true
  clean patch instead of retaining an operation journal. Regression verifies
  both the empty patch and Zustand `clean` status. Focused draft suite 28/28,
  controller suite 36/36, TypeScript no-emit, focused ESLint, and frontend Vite
  production build pass using the bundled Node runtime. Vite emitted its
  existing >500 kB chunk-size advisory. No new StudioPlugin package was
  installed; extension Save-button mismatch still needs a rebuilt live check.

## Current live checkpoint — Studio Editor .46 and runtime — 2026-10-17

- Server Editor `0.3.46` is installed and active in Project `Server Echo
  Studio`; Studio's trust UI displayed SHA-256
  `3b8c14ce0c3e450453060e556d02f8123423459950cc8525989cf15578829a1e` and the
  package registry now reports `.46`. This supersedes earlier notes in this
  file saying `.46` was cancelled/not installed. No Project source was saved.
- Studio Runtime → Status reports `liapoldus-core`, `liapoldus-echo`, and
  `liapoldus-server` all `running`; Canvas reports Server `v1.1.6 · готов`.
  Read-only `GET http://127.0.0.1:19080/echo?text=server-recovery-check-20261017`
  returned `HTTP 200` and `echo: server-recovery-check-20261017`.
- Studio Output also contains a failed diagnostic with
  `cli.stderr: invalid argument "inspect"`; later typed runtime status and the
  request succeeded. This is a CLI intent/contract diagnostic failure, not
  evidence that Server stopped. The earlier temporary outage was from the
  explicitly scoped Server Stop during independence testing; it was not a
  container crash. No Docker, Core DB, credential, certificate, or Project
  lifecycle change was performed in this checkpoint.
- Next configurator contract gate: Core has a scoped service-secret grant for
  a reference already present in active configuration, but neither Core nor
  CLI currently exposes an authorized, redacted catalog for Studio to select
  or create such references. Server `certificateRef`/`privateKeyRef` are
  opaque service-secret references. Do not fill them with Project paths or
  public-certificate import; design the owner contract and vault lifecycle
  before making those fields editable.

## Core/CLI secret-reference catalog boundary — 2026-10-17

- Owner audit: Core issues scoped grants for an already-known opaque service
  reference; current Management API has no safe reference-catalog/list intent.
  CLI's `CredentialProvider` resolves credential references internally, but no
  typed command exposes an allowlisted reference catalog to Studio. Server TLS
  `certificateRef`/`privateKeyRef` explicitly mean opaque references, never
  Project paths or PEM values.
- Corrected `plan.md`: public X.509 Project import is a distinct file-resource
  workflow and cannot be treated as Server custom-TLS configuration. Until a
  Core/CLI-owned catalog contract exists, reference-backed fields remain
  read-only/unavailable; do not enumerate secret directories or expose grant
  handles through an Admin Surface.
- Next owner-level work: design and implement a target-scoped, purpose-filtered,
  redacted Core Management + typed CLI reference catalog, then render reference
  IDs/labels in Studio and prove no path/value reaches the renderer. No runtime,
  Core DB, credential, certificate or Project mutation was performed in this
  audit.

## Generic Project certificate resource import — 2026-10-17

- Added a schema/catalog-gated import action for Project-backed `certificate`
  resources in the generic settings inspector. It appears only when the live
  Service SDK manifest declares a Project certificate catalog; service-admin
  catalogs and generic file resources cannot invoke it.
- The native picker accepts certificate file extensions only. The host rejects
  symlinks, non-regular/empty/oversized files, private-key or mixed PEM bundles,
  and malformed X.509 content; a valid public certificate is copied unchanged
  under a content-addressed `resources/certificate-<digest>.crt` path. Existing
  files are not overwritten; the original source is untouched. Only the safe
  Project-relative path returns to the renderer, the file index refreshes, and
  the selected field updates the shared draft.
- Verification: Wails presentation tests pass; certificate import regressions
  cover successful/idempotent copy, source preservation, private/mixed-key
  rejection, invalid data, extension rejection and symlink rejection. Focused
  frontend tests pass 20/20, full frontend suite 150/150, ESLint and TypeScript
  + Vite build pass. Wails generation was regenerated from Go and the isolated
  two-run `bindings:check` passes. No live Project, Core, or runtime was changed.
- Remaining: no current Server manifest field opts into a Project certificate
  catalog, so native use against Server has not been claimed. Generic arbitrary
  file import remains intentionally unsupported until its confidentiality and
  type constraints are contractually declared; editable Core reference catalog,
  Core update/restart acceptance, recovery, full migration audit, and
  cross-platform releases remain open.

## Core settings typed local workflow — 2026-10-17

- Added typed `core.settings.update` planning with an internal-only absolute
  request-file path, local-target fence and exact argv contract. Studio's Wails
  host accepts only bounded values and a desired revision, writes a short-lived
  `core-settings-patch/v1` request under a private temporary directory, and
  removes it after CLI completion. Renderer never supplies a path, raw CLI args,
  Core document, credential, or certificate/private-key reference.
- Added Local Core settings form for body-size limit and management header/request
  timeouts. It reads only `core-settings-view/v1`, enforces revision CAS and
  validation, requires a visible review/confirmation, submits through CLI → Core
  Management API, automatically restarts Core when required, then checks the
  effective state again. If restart/reconnect fails, the pending revision stays
  visible and Studio offers an explicit Core-only retry; no further patch is
  allowed while pending. Listener/public URL and TLS references remain read-only
  until target endpoint/mount updates can be transactional.
- Fixed CLI `core stop/restart` to touch only the selected target's owned
  `liapoldus-core`. They no longer stop service containers, remove the network,
  delete staging or re-create Core; full stack shutdown remains `runtime stop`.
  Added isolation tests for Core stop/restart and missing/unowned Core.
- Verification: CLI `GOWORK=off make check` and `make test-race` pass. Studio
  `make check`, `make check-race`, Go race suite and Wails binding reproducibility
  pass; all 148 frontend tests pass. macOS/arm64 desktop packaging also passes.
  No Core settings were changed in the live target during these tests.
- Native read-only acceptance: after rebuilding/restarting Studio, its Local Core
  settings editor is present. The previously selected CLI
  `/tmp/liapoldus-cli-reconcile-fixed/liapoldus` (SHA-256
  `e5f51526c6f17ebdc9ed32d58f4be3221abd880c192f1ba5872e9119181ca098`) rejected
  the typed `core settings inspect` operation with `invalid argument "inspect"`.
  Built a fresh macOS/arm64 CLI from the current owner source, then selected it
  through Studio Settings → Toolchain at the stable ignored workspace path
  `../cli/dist/liapoldus-studio` (SHA-256
  `f0a8198953beee113acd6f053368efd8711c316a3b861efbcc2c5a1dec027ad3`). Its
  actual Studio-driven read returned target `local`, desired/effective revision
  `1/1`, `maxBodyBytes=1048576`, `headerTimeout=5s`, `requestTimeout=30s`; the
  UI shows synchronized state. This verifies the CLI/Core read boundary, not a
  settings write/restart. The Core update gate remains open; live Core settings,
  DB, credentials, certificates and containers were not changed.
- Generic Project-backed resource fields now offer **Open file** when the
  selected value is present in the current manifest-authorized catalog and the
  host file index still identifies it as a file. Service-admin resources,
  missing paths, directories and unsafe relative paths cannot open. The focused
  frontend suite passes 12/12, targeted ESLint passes, and TypeScript + Vite
  production build passes. This does not yet import/create Project resources or
  provide an editable Core reference catalog.
- Still open: generic file import/catalog editing (public certificate import
  is implemented separately above), editable Core reference catalog,
  rollback/recovery beyond
  retrying a pending Core restart, interactive real-Core update/restart acceptance,
  full nomenclature audit across all active repositories, and cross-platform
  release gates. Do not describe Studio or the overall goal as production-ready.

## Server Editor and live endpoint recheck — 2026-10-17

- Studio reports Server Editor `0.3.45` active with the approved digest
  `da5d1812e3112652f51a5c972147a32441c17d594eb2e64d46908b8427ed2437`; no
  package installation was needed. In `Server Echo Studio`, selected the Server
  canvas node and opened its editor from the contextual action. Added temporary
  `GET /studio-draft-probe-20261017` targeting `echo` / `echo.handle` to the
  shared draft, then removed it using the editor's confirmation. On reopening,
  only canonical `GET /echo` remained and `Сохранить в Project` was disabled;
  Canvas reported the saved Project baseline and applied/effective generation
  `65/65`. The transient enabled Save state seen before re-opening did not
  persist after the host-backed refresh. Nothing was saved or applied.
- Current Docker observation: `liapoldus-server` is `running` with zero
  container restarts. `GET http://127.0.0.1:19080/echo?text=studio-ui-recheck-20261017`
  returned HTTP 200 and the expected body; `docker logs liapoldus-echo` contains
  the exact query text. SDK health is `GET http://127.0.0.1:19081/healthz`;
  `/_liapoldus/v1/health` is not a route and correctly returns 404. This
  confirms current availability, not the historical cause by itself. Earlier
  scoped Server Stop during the independence check is recorded above as the
  cause of the temporary outage; Studio stack recovery followed.
- This closes the current UI-only Add/Delete draft and curl smoke for the
  existing endpoint. It does not close Core settings/resource workflow,
  recovery, or production/cross-platform gates.

- Follow-up diagnosis: the temporary outage followed the explicit per-service
  Server Stop action used during the independence check; it was not a container
  crash or restart loop. On 2026-10-17, read-only `docker ps` again showed
  Server, Echo and Core running (Server had zero restart count), and a fresh
  `GET /echo?text=diagnostic-check-20261017` returned HTTP 200. Echo's Docker
  log contained that exact marker. No container, Core state, credential or
  certificate was changed by this recheck.

## Core settings source-of-truth alignment — 2026-10-17

- Owner audit found a plan/contract conflict: `plan.md` previously made
  `environments/<target>.json` the authoring source for Core operational
  settings, while Core `AGENTS.md` requires durable settings in Core SQLite,
  ENV-only bootstrap and no runtime JSON loader. Core's existing
  `/api/v2/settings` is Core-owned; Studio still must reach settings only via
  typed CLI → Management API.
- Corrected `plan.md` §11: target environment YAML now carries only non-secret
  target metadata/references; Core settings remain exclusively Core-owned,
  with desired/effective state and restart performed by CLI only when the
  Core-owned operation requires it. No API/CLI implementation was inferred from
  this documentation correction. The typed Core settings and restart workflow
  remains an open owner-contract/integration task. The plan also now requires a
  redacted `CoreSettingsView` with logical CLI-owned references, revision CAS,
  exact target scope, and no raw Core paths/config document in renderer data.
- Reconciled the configurator TODO with executable code: protected object arrays
  already have schema-derived safe Add, shared draft insertion and fail-closed
  checks for required protected values. Found and fixed an additional gap:
  Add now remains disabled if a generated required field has no renderer;
  resource fields require a matching declared resource widget/catalog, while
  unsupported optional fields do not suppress otherwise safe Add. The new
  regression failed before the fix. Focused schema/draft/array tests pass 44/44;
  strict TypeScript and targeted ESLint pass. Used the bundled Node runtime
  because system Node lacks Homebrew `libllhttp.9.4.dylib`; no dependencies were
  installed or modified.
- Cross-owner nomenclature scan across active Core, CLI, Service SDK, Wool,
  Studio, StudioPlugin Server editor, Server, Echo, forms-db, Domain and Runtime
  found no live old SDK/protocol imports or `/api/plugins` routes. Remaining
  source matches are deliberate retired-route/migration tests and migration
  tables. Frozen `services/captcha` and `services/identity` still import the old
  modules and remain outside this active migration scope; reactivation requires
  their owner migration first.

## Resource publication operation observation — 2026-10-17

- Closed a gap in the StudioPlugin resource-publish path: after CLI/Core accepts
  a publication with `202/pending`, the sandboxed editor can now wait for the
  terminal result via typed `operation.watch` instead of presenting acceptance
  as completion. The bridge requires `service.resources.publish` and only
  watches an operation ID issued by this Studio controller for the same
  Project/service context; it returns terminal state plus a strictly bounded
  failure code, never raw Core/CLI output.
- Studio targeted bridge/controller tests pass (14/14), targeted ESLint and
  TypeScript check pass. Server Editor package suite passes (66/66), validator
  and Studio installer acceptance pass. Candidate package
  `/tmp/liapoldus.server-editor-0.3.47.studio-plugin`, SHA-256
  `b085ffac0c7648c217c4a1edfc636c4ca971614e607d7da9f38eb0e58cc8602c`.
  Studio's native trust screen now displays that exact digest, unsigned status,
  one UI surface and the six expected permissions. The trust checkbox is not
  selected and install was not pressed; native package acceptance is paused at
  this action-time confirmation. No Project, Core, credentials, certificates
  or Docker runtime state changed.
- The immediately preceding Server availability incident was caused by the
  scoped Server Stop performed during the service-independence check. Studio
  then started the target stack; its typed Status reported Core/Echo/Server
  running, and `/echo?text=server-recovery-check-20261017` returned HTTP 200.
  This confirms recovery, not production readiness.

## UI-driven stack reconciliation acceptance — 2026-10-17

- Project `Server Echo Studio`, CLI `ok`, target `local`. Studio Runtime →
  Status first reported Core, Echo, and Server running. Through Canvas, stopped
  only Echo; Studio Output confirmed `serviceId=echo`, `containerState=stopped`.
- A stack Start with Server still running failed closed with
  `runtime_exists`; Core and Project were not changed. To test the intended
  whole-stack recovery path, stopped only Server through its scoped Canvas
  confirmation as well. Core remained running.
- Retried Runtime → Start in Studio. CLI reported successful operation
  `studio-local-25bf8e1a2393`, cleaned only the target-owned stale containers
  `liapoldus-echo` and `liapoldus-server`, did not create/update Core, and
  received `accepted: true` registration results for both Echo and Server.
  The subsequent Studio typed Status showed all three containers running.
- Ordinary curl to `/echo?text=studio-stack-reconcile-20261017` returned
  `echo: studio-stack-reconcile-20261017`; `docker logs liapoldus-echo` contains
  the same exact text. This closes the local stack reconciliation and
  Server → Wool → Echo request/log acceptance for this target; it does not
  close the full configurator or cross-platform production gates.
- Generic Inspector acceptance on Echo: changed the SDK-rendered numeric
  maximum-text control from 2048 to 1024, let Studio auto-save and apply
  generation 62, and observed 1024-byte input → HTTP 200 / 1025-byte input →
  HTTP 413. Restored 2048 through the same Inspector; generation 63 is applied
  and desired. After restoration, 2048 → HTTP 200 / 2049 → HTTP 413, and
  `/echo?text=studio-generic-config-20261017` returned the expected body with
  the exact marker in Echo logs. `server-integration` working tree is clean.
- Server Editor `.46` Save-state fix is packaged and passed 66/66 tests plus
  Studio installer acceptance. Its exact digest is
  `3b8c14ce0c3e450453060e556d02f8123423459950cc8525989cf15578829a1e`.
  Studio displayed the unsigned-package trust dialog; import was cancelled
  without granting trust. Active package remains `.45`; native verification of
  the new Save-state synchronization is still pending that exact trust action.

## Generic SDK peer picker — 2026-10-17

- `service-configuration-ui/v1` peer fields now require a string JSON Schema
  value and declared `peerContractId`. Studio offers services from the active
  Project and commits a selected service ID only after typed CLI → Core returns
  a live manifest with the exact service ID and matching contract. No peer
  address or business method is sent through Core; direct service traffic stays
  on Wool. Unsupported object bindings remain fail-closed.
- Added controller coverage for valid contract, missing service/contract and
  workspace switch during metadata read, project-root changes with a reused ID,
  current Project artifact-pin changes, and Core replica provenance mismatch;
  model tests cover wrong identity, absent/oversized metadata and object-schema
  refusal. The live Server/Echo
  manifests do not currently declare a generic `widget: peer` field, so the new
  control itself has not been exercised in the native UI.
- Studio full `GOWORK=off GOFLAGS=-p=1 make check` passes (143 frontend tests,
  Go lint/tests/vet/build, strict TypeScript, Wails binding reproducibility).
  Service SDK full `GOWORK=off GOFLAGS=-p=1 make check` passes (230 tests,
  Go lint/tests/build/vet, TypeScript lint/typecheck and generated-contract
  check). This does not close the broader configurator or production gates.

## Per-service runtime action confirmation — 2026-10-17

- Added an accessible confirmation step before per-service Stop and Restart.
  It names the exact service ID/name and target and states that only the selected
  service is affected; Cancel has initial focus. Start, Logs and Inspect remain
  direct typed actions. RU/EN confirmation wording is covered by model tests.
- While attempting to exercise the still-open stack reconciliation gate, the
  Canvas selection was `server`, not the `echo` service previously selected in
  Runtime. Studio correctly emitted `runtime.stop` for `server`; this was an
  operator-selection error, not a CLI misroute. Server was immediately started
  again through its Canvas action; Studio Output reported `readiness=ready`,
  Docker reported Server/Core/Echo Up, and `/echo?text=restored-server-check`
  returned HTTP 200. No Project/config/credential/Core DB changes occurred.
- The reconciliation test itself is **not** counted: the intended Echo stop was
  not performed, and the stack-level Start path was not exercised. Full Studio
  `GOWORK=off GOFLAGS=-p=1 make check` passes with 143 frontend tests, Go
  lint/tests/vet/build, strict TypeScript, Vite, Wails binding reproducibility,
  and `git diff --check`. Native confirmation behavior is verified in the
  rebuilt app below. The reconciliation test was still open at this checkpoint
  and is closed by the later UI-driven stack reconciliation section above.

## Native Stop/Restart confirmation verification — 2026-10-17

- Rebuilt the macOS/arm64 desktop app from current Studio source. Wails frontend
  compile and app packaging succeeded; bindings reproducibility passed; Go and
  frontend lint passed. The first build attempt used a broken Homebrew Node 26
  (`libllhttp.9.4.dylib` missing); rerunning with installed Node 20 succeeded.
- Reopened `Server Echo Studio`; Canvas selected `server`, generation 60 applied.
  Clicking Stop opened an accessible confirmation naming `server` and target
  `local`, stating that only this service would stop and that Project/Core/other
  services would not change. Cancel had initial focus. Restart showed the
  equivalent scoped confirmation and also defaulted focus to Cancel.
- Cancelled both dialogs. No runtime operation was sent: Docker Server remains
  `running`, restart count 0. `/echo?text=confirmation-gate-check` returned
  HTTP 200 and Echo logs contained the exact marker.
- This closes the native action-confirmation verification gap. Stack
  reconciliation was not exercised at this checkpoint; it is now closed by the
  later UI-driven acceptance section above. Broader configuration/production
  gates and installation of the package carrying the Save-state source fix
  remain open.

## Server availability incident + Server Editor draft sync — 2026-10-17

- The native Studio Output history identifies the interruption: a typed
  `runtime.stop` targeted `server`, followed by a typed `runtime.start` for the
  same service. This was an accidental Canvas selection/action while intending
  to exercise Echo, not a spontaneous Server crash. Docker currently reports
  Server `running`, restart count `0`; `/echo?text=post-draft-verification`
  returned HTTP 200 and the expected body. Final recheck returned HTTP 200 for
  `/echo?text=final-service-check`, HTTP 200 from SDK `:19081/healthz`, and Echo
  logs contained `final-service-check`. The `no_ready_peer`
  condition seen earlier is a distinct Echo-unavailable response and does not
  mean Server stopped.
- Server Editor `.45` is active in the native Studio UI with the approved
  digest. Through its UI, a temporary `GET /draft-delete-check` targeting
  `echo.handle` was added to the shared draft and then deleted. The canonical
  Project still contains only `/echo`; the host inspector shows clean settings
  with Save/Discard disabled. No Project save, Core apply, or container action
  occurred.
- The extension's own Save button remained visually enabled after the host's
  authoritative settings read returned to clean. Fixed the bridge to synchronize
  Save availability from that authoritative status and added protocol coverage;
  Server Editor tests now pass 66/66 and manifest validation passes. This source
  fix is not yet in the installed `.45` package; native verification requires a
  newly versioned package and exact-digest trust through Studio.
- Per-service Stop/Restart confirmations were verified in the rebuilt native
  app as recorded in the section above; both dialogs named the selected service
  and local target and were cancelled without changing runtime state.

## Live Server/Echo and endpoint save/apply retest — 2026-10-16 20:54 UTC

- The earlier `.45 not installed` and `settings patch is not allowed by schema`
  notes below are superseded. Server Editor `0.3.45` was installed through the
  Studio trust UI after the user approved exact SHA-256
  `da5d1812e3112652f51a5c972147a32441c17d594eb2e64d46908b8427ed2437`.
- In Project `Server Echo Studio`, the extension added
  `GET /echo-045-acceptance` to the shared draft, with required string query
  `text`, target `echo · 1.2.1` / `echo.handle · 1.1.0`, and `text/plain`
  response. `Сохранить в Project` saved it; Canvas → `Подтвердить и применить`
  completed the Core apply. Studio Output showed both Echo and Server applied
  generation 57, with `accepted: true` and both replica outcomes `applied`.
- Curl through the running Server returned HTTP 200 and
  `echo: studio-045-live-check`; the Echo logs contained the exact query text.
  The original `/echo` also returned HTTP 200. The temporary route was then
  removed in the extension UI, saved, and applied; Canvas showed generation
  58 applied/desired. The temporary route now returns 404 while `/echo` still
  returns 200. No container was stopped or restarted.
- This closes the specific endpoint save/apply regression and its live route
  smoke for `.45`; it does not close the overall configurator, cross-platform,
  or nomenclature-migration gates.
- Follow-up read-only check through Studio Runtime → `Status` on target `local`
  reported Core, Echo and Server all running; the configuration panel showed
  Server applied/desirable generation `58/58`. A fresh curl to the existing
  `/echo?text=studio-runtime-status-20261016` returned HTTP 200 and the expected
  `echo:` response. There were no stopped service containers in the selected
  runtime state, so the automatic stopped-container reconciliation branch was
  not exercised; no runtime lifecycle action was taken.

## Server endpoint save diagnosis — 2026-10-16 23:41

- Runtime was not stopped: Docker reported Server/Core running with zero
  restarts. Server started at `19:19:58Z`; Echo's current container started at
  `20:20:10Z`. Server logs contain `no_ready_peer` at `20:19:51Z`, immediately
  before Echo became available. At `20:34Z`, `/echo?text=still-working` and
  SDK `:19081/healthz` returned HTTP 200; `:19081/metrics` returned HTTP 200.
  `/healthz` on application port `19080` returns 404 because that path is not a
  Server route; SDK health is on the separate management/observability port.
- Separate Studio save failure reproduced on Canvas → Server: Add endpoint
  changed only the temporary draft; host rejected save with
  `settings patch is not allowed by schema`, generation remained `56/56`, and
  canonical Project settings still contain only `/echo`.
- Root cause: Server editor encoded JSON Schema annotated response
  `schema`/`example` values in `publishRouteMutation`, then the shared bridge
  processed the mutation again. This risked double-wrapping the
  `$studioJSONDocument/v1` marker. Endpoint editor now sends typed array intent;
  the common bridge is the single owner of projection and marker encoding.
  Union-aware encoding selects the matching `oneOf`/`anyOf` branch and wraps
  only SDK-declared JSON documents/values. Go regression verifies union branch
  safety and marker unwrapping into canonical Project settings.
- Verification: Studio settings package `go test ... -count=1` passes; Server
  editor `make NODE=<bundled-node> package` passes 65/65 tests and Studio
  installer acceptance. The full Studio `make test` also passes (all Go
  packages, TypeScript typecheck, 135/135 frontend tests). Candidate `.45` SHA-256 is
  `da5d1812e3112652f51a5c972147a32441c17d594eb2e64d46908b8427ed2437`.
  It is not installed: native Studio trust for this new exact digest is still
  required. No Project save/apply or Docker lifecycle was performed.

## Current live checkpoint — Server endpoint editor — 2026-10-16

- Server Editor `.44` is active in Studio; both the trust screen and installed
  package list showed SHA-256
  `d310439107c73a0a6c5ed5251bc16f6476331ac3847ef25072cbde42907c8d9c`.
  Project `Server Echo Studio`, target `local`, CLI `ok`; Core, Echo `1.2.1`,
  and Server `1.1.6` are running. Read-only curl to
  `http://127.0.0.1:19080/echo?text=studio-editor-044-20261016` returned
  HTTP 200 and `echo: studio-editor-044-20261016`; Server logs show its HTTP
  listener running. No Docker lifecycle, Core, or Project-source operation was
  performed.
- Endpoint contract smoke against the same live runtime: `/echo` without the
  required `text` query returned HTTP 400; a 2049-character value returned
  HTTP 413 with `message_too_large`. Echo container stdout contains the exact
  successful marker `studio-editor-044-20261016`, confirming the request was
  handled by Echo rather than only by Server's HTTP layer.
- Service-independence/recovery acceptance was then run through Studio on the
  same `local` target: Echo Inspector → Stop emitted `runtime.completed` for
  only `liapoldus-echo` (`containerState=stopped`); the Server container stayed
  Up and curl `/echo` returned HTTP 503. Echo Inspector → Start emitted
  `runtime.completed` with `readiness=ready`, `containerState=running`, and
  `artifactReplaced=false`. Read-only Docker status showed Core, Echo, and
  Server Up; curl returned HTTP 200 / `echo: echo-recovery-acceptance`, and
  Studio Output → Echo logs displayed that exact marker. No binary replacement,
  Project/Core config mutation, or credentials/certificate/DB change occurred.
- In the selected Server's native StudioPlugin editor, created
  `GET /_studio-draft-probe` (`studio-draft-probe`) targeting Echo
  `1.2.1` / live method `echo.handle · 1.1.0`, then deleted it from the shared
  draft and confirmed deletion. Studio acknowledged `Черновик Studio обновлён`;
  only the original `GET /echo` remains and `Сохранить в Project` is disabled.
  The `.42` `bridge.patch_not_applied` error did not recur. This verifies Add /
  Delete in draft only; it does not verify save/apply or a newly applied route.
  The extension install briefly refreshed the Studio window, but no runtime
  container stopped: subsequent `docker ps` showed Core/Echo/Server up and curl
  returned HTTP 200.
- The package was selected through Studio's native picker and installed after
  exact-digest verification and the user's trust confirmation. Its six
  permissions were shown before installation. The previous `.42` package is
  retained in Studio's version history; no cleanup was performed.
- Earlier `.42` observations and its `bridge.patch_not_applied` diagnosis below
  are historical and superseded by this live `.44` Add/Delete acceptance.
- Follow-up read-only UI check: Studio Runtime → `Status` completed through the
  typed CLI contract and reported `liapoldus-core`, `liapoldus-echo`, and
  `liapoldus-server` all `running`. Core-backed reads show Server `1.1.6` and
  Echo `1.2.1` `ready` at generation `56`. A fresh curl request to
  `/echo?text=studio-vertical-check-20261016` returned HTTP 200 and
  `echo: studio-vertical-check-20261016`. No Project save, Core apply, or
  Docker lifecycle action was performed. This supersedes the earlier
  post-start-failure runtime observation as current state, but does not explain
  how the runtime recovered.
- Read-only curl to `http://127.0.0.1:19080/echo` with
  `text=studio-acceptance-2026-10-16` returned HTTP 200 and
  `echo: studio-acceptance-2026-10-16`. Studio Canvas → Echo → Logs → Output
  showed the exact same marker in Echo's stdout, confirming the data-plane call
  and log correlation.
- In the `.42` UI, opened Add HTTP endpoint, chose `public-http`, `GET`, target
  `echo · 1.2.1`, and live method `echo.handle · 1.1.0`; added temporary
  `GET /_studio-draft-probe` (`studio-draft-probe`) to the shared editor draft,
  then used the editor's confirmed Delete-from-draft action. The editor returned
  to only the original `GET /echo` and its Project Save button is disabled;
  no Save or Core apply was invoked. However, the editor surfaced
  `bridge.patch_not_applied` while deleting it. Diagnosis: the host correctly
  returns `status=clean` when deleting the newly added draft-only route restores
  the Project baseline, but `.42` rejected every status except `dirty`/`error`.
  The route add and delete were reflected in the visible shared editor draft;
  after deletion only `/echo` remained and Save was disabled. Core-backed Echo
  status remained ready at generation `56`; Project Save/Core apply and Docker
  lifecycle were not invoked. Package `.43`'s `clean`-ack fix was extended in
  `.44` with explicit preview-before-apply for deterministic legacy route
  migration (`plugin → service`, `server-http/v1`), RU/EN preview labels, and
  host-rejection handling that leaves the shared draft unchanged. Package
  `0.3.44` SHA-256 is
  `d310439107c73a0a6c5ed5251bc16f6476331ac3847ef25072cbde42907c8d9c`; package
  validation and Studio installer acceptance pass; the latest source suite is
  64/64. `.44` is not installed; `.43` has been superseded. A confirmation for
  this exact `.44` package is required before installing the unsigned local
  package and verifying the clean acknowledgement in live Studio UI.
- Fresh UI recheck confirms `.42` still leaves `bridge.patch_not_applied` visible
  after draft-only Add/Delete, even though only the original `/echo` remains and
  Save is disabled. The Server Editor must be opened from the selected Server
  context (Studio plugin rail); the standalone tab without context reports
  `bridge.service_not_selected`. Curl to
  `/echo?text=studio-editor-042-20261016` returned HTTP 200 and the matching
  `echo:` body. No Project/Core/Docker change. `.44` remains prepared but
  requires its exact package trust action before live fix acceptance.
- Updated the Studio documentation overview to match the current ownership
  boundary: local Core/runtime workflows are typed-CLI mediated; remote deploy is
  CLI/CI-owned; Service builds and Docker image builds are out of Studio scope.
  The main workflow now distinguishes local save/apply from remote
  commit/release; `git diff --check` passes. No site build was repeated.
- Reproduced a separate lifecycle race in Studio: global runtime start returned
  after spawning the CLI, then immediately queued Core metadata reads while the
  single CLI slot was still occupied. Service-scoped lifecycle calls had the
  same fire-and-forget boundary. Global lifecycle now uses the typed
  `RunStudioCommandAndWait`; service-scoped lifecycle holds the CLI slot until
  the terminal event before Studio refreshes status/contracts. New frontend
  controller and Wails queue regressions failed before the fix and pass after it.
  Post-fix UI `Start` was retried once for Project `Server Echo Studio`, target
  `local`, using the already trusted Echo 1.2.1 and Server 1.1.6 artifact pins.
  CLI reported both service containers exited with `service SDK replica lease
  expired`, then Core registration for Echo failed with `context deadline
  exceeded`; a subsequent typed status showed only `liapoldus-core: running`.
  Core status is reachable, but service metadata remains unavailable. Core logs
  include repeated `service metadata read failed ... service unavailable` and
  TLS handshake EOFs. No credentials, certificates, DB, or Project source were
  changed. The bounded failure points to expired service-replica identity /
  SDK registration and needs owner-level diagnosis before another runtime
  start; do not repeat Start blindly.

- Security cleanup: removed the unused exported `PublishRuntimeServiceResource`
  Wails method, which was a parallel publication path without live Core-owned
  Admin Surface verification or native confirmation. StudioPlugin publication
  now has one host API: `PublishRuntimeServiceResourceJSON`, which re-reads and
  validates the live action descriptor, stages an immutable artifact snapshot,
  asks for native confirmation, and invokes typed CLI. The obsolete generated
  binding and its test were removed. `go test ./internal/presentation/wails`,
  TypeScript/Vite production build, Wails binding reproducibility (two isolated
  generations), and `git diff --check` pass. Vite still reports the existing
  500 KiB chunk warning. This does not claim resource-publication E2E acceptance.

- Target `local`, Project `Server Echo Studio`: Studio UI confirms Server
  `1.1.6` trusted/running; Core and Echo were left unchanged. Curl to the existing
  `/echo?text=server-1.1.6-acceptance-20261016` returned HTTP 200 with the
  expected echoed body.
- Server Editor `.41` was the active version before the approved `.42` update;
  its schema classification fix removed the previous
  `bridge.patch_array_contract_mismatch`. A live Add attempt exposed that
  ordinary `config.routes` patches went through debounce without returning the
  host acknowledgement Promise, so the form closed while Project remained clean.
- Candidate `.42` routes endpoint collection and field patches through an
  immediate flush that returns the host acknowledgement; ordinary settings
  retain debounce. Verified package
  `/tmp/liapoldus.server-editor-0.3.42-verified.studio-plugin`, SHA-256
  `1f6f3ba276d8cf033adeeeb85f7916eb9fb38560f4c7817e6f28c2b86b75acef`;
  59/59 tests and Studio installer acceptance pass. This supersedes the earlier
  `.42` archive built before extracting the acknowledgement helper. Installed
  and verified via Studio UI; live Add/Delete acceptance remains open because
  Core-backed service metadata currently returns HTTP 503. Project and persistent
  Core data were not edited; no artifact or container was removed.

Статус реализации целевого плана описан в `plan.md`. Этот список отделяет
готовые и проверенные фазы интерфейса от межрепозиторных и release-задач.
`[x]` — готово и проверено; `[~]` — частично/нужна работа в другом владельце;
`[ ]` — открыто.

## Актуальная сверка непрерывного локального acceptance — 2026-10-16

### Продолжение после установки Server Editor 0.3.40 — 2026-10-16

- В текущем Studio UI пакет уже активен: версия `0.3.40`, SHA-256
  `1b49fd3300f5dff640aa3f04f9feb8aa23a7378c9f4e265e6b534e2ad9d9fcf6`.
  Выбрал сервис `server` и открыл отдельную вкладку расширения: локальный
  `$ref` у `listeners[].hostnames` разрешается, schema error отсутствует.
  Добавление hostname недоступно при `tls.mode=disabled` и `maxItems: 0` —
  это ограничение текущего контракта, а не ошибка установки.
- Через Runtime → Read via Core заново прочитаны обе реплики: Server
  `1.1.5`, digest `d1999f5516f5f37156d4ab2b482481db5d0dc8e57869b0aa9c0d42a065c43c9b`,
  и Echo `1.2.1`, digest
  `e492a665232fd329100b939b78938c4eb0fe59160d89dd1dd66aba6208a53204`;
  обе `ready=true`, `appliedGeneration=53`.
- Read-only `curl --get` к `127.0.0.1:19080/echo` с уникальным query
  `text=studio-hostnames-check-20261016` вернул `HTTP 200` и точное тело
  `echo: studio-hostnames-check-20261016`.
- Вызвал Echo Logs из Canvas → Studio Output, но отображённый AX-срез не
  включил свежую запись с этим уникальным marker; отдельное log-correlation
  для этого запроса пока не засчитывать. Никакие binary, target, Project,
  Core DB, credentials, certificates или Docker lifecycle не менялись.
- В ходе owner-doc audit уточнены оставшиеся runtime-ссылки в Studio README и
  roadmap: теперь речь идёт о Services, а не runtime plugins. Отклоняемые CLI
  legacy paths и названия каталогов StudioPlugin оставлены как точные
  migration/security references.
- Для Server подготовлен и зарегистрирован через Studio candidate `1.1.6`
  Linux/arm64, SHA-256
  `efe16ac1343a03935ec797cfa968c7382e237521db6a6d817f134b408564f494`.
  Artifact виден в CLI-owned registry, но остаётся untrusted; Project по-прежнему
  привязан к `1.1.5`. Focused Caddy tests, включая реальный loopback runtime
  `TestRuntimeReturns404ForUnmatchedRequest`, проходят. Текущий `1.1.5` на том
  же неизвестном пути всё ещё отвечает HTTP 200 без тела. Новый бинарник не
  доверялся и не запускался; live replacement ждёт подтверждения в Studio.
- Generic inspector block root cause найден в допустимом response `example`
  с пустой JSON Schema `{}`. Frontend теперь трактует только точную пустую
  schema как bounded произвольное JSON-значение; непомеченные открытые object
  schemas по-прежнему fail-closed. На текущих `server-echo-studio` schema и
  settings модель сообщает `renderable=true` для root/config/listeners/routes.
  Добавлены тесты, что такие controls не блокируют безопасное создание
  обязательной array row: `schema={}`, `example=null`; unmarked open objects
  остаются fail-closed. Targeted schema suite 9/9 проходит.
- Новый Wails app собран и открыт. Live generic inspector для Server раскрывает
  `config.routes`, показывает bounded `example` JSON editors и активную кнопку
  Add response. В Studio добавил тестовый response в общий draft, затем удалил;
  остались ровно исходные три response, Project clean, generation Core осталась
  `53`. Повторный `make desktop-build` прошёл целиком (Wails package, bindings
  reproducibility, Go lint, frontend lint). Frontend bundle всё ещё 592 kB
  (>500 kB Vite warning) — отдельная оптимизационная задача.
- Не объявлять цель завершённой: остаются live Server 404, failure/recovery,
  resource publication/restart, полный service-to-service сценарий,
  конфигуратор и межрепозиторные/cross-platform production gates.

### Проверка Server Editor .40, draft/save и Echo acceptance — 2026-10-16

- Через native Studio trust flow установлен Server Editor `0.3.40`; UI подтвердил
  package SHA-256 `1b49fd3300f5dff640aa3f04f9feb8aa23a7378c9f4e265e6b534e2ad9d9fcf6`
  и iframe загрузился с версией `.40`. Исправление recursive merge `$ref` items
  подтвердилось: `listeners[].hostnames` отображается без ошибки схемы. Кнопка
  добавления hostname отключена корректно, поскольку `tls.mode=disabled` задаёт
  `maxItems: 0`.
- Через endpoint editor добавлен в общий Studio draft временный маршрут
  `GET /_studio-draft-probe` → `echo.handle · 1.1.0`, затем он удалён через
  подтверждение внутри редактора. В результате остался только существующий
  `GET /echo`; Project сохранён из этого исходного состояния, кнопка Save
  отключилась. Тестовый маршрут в runtime не применялся.
- Curl acceptance: `GET /echo?text=studio-ui-acceptance-20261016` → HTTP 200,
  `echo: studio-ui-acceptance-20261016`; отсутствие `text` → HTTP 400;
  строка длиной 2049 байт → HTTP 413, `message_too_large`. Через Canvas → Echo
  → Logs и прокрутку Output до конца Studio показала stdout с точным маркером
  `studio-ui-acceptance-20261016`.
- Core-backed metadata, прочитанная через Studio, подтвердила обе реплики
  `echo` и `server` ready с applied generation 51; Runtime inspector показывает
  `51 / 51` для Echo. Project save сам по себе не считался Core apply. Core,
  target, credentials, certificates и Docker lifecycle не менялись.
- Дополнительный live acceptance автоприменения через Studio: поле Echo
  `Response prefix` изменено на `studio-vertical: `; через 800 ms Studio
  сохранила Project и typed CLI/Core workflow подтвердил generation `52 / 52`
  для Echo и Server. Обычный curl вернул
  `studio-vertical: auto-apply-generation-52`, HTTP 200. Затем исходный prefix
  `echo: ` восстановлен тем же UI-путём; generation `53 / 53` подтверждена для
  обеих реплик, а curl вернул `echo: rollback-generation-53`, HTTP 200. В
  Project оставлено исходное значение. Это доказывает UI → CLI → Core → SDK
  configuration apply на текущем target, но не полный recovery/rollback при
  недоступности Core и не cross-platform production readiness.
- Оставшиеся acceptance gates не закрыты: контролируемый apply конфигурации из
  Project через typed CLI/Core при отказе/восстановлении Core,
  Server 404/non-happy endpoint cases, полный runtime stop/recovery сценарий,
  и межрепозиторная naming/configurator production-проверка. Не объявлять цель
  завершённой.

### Обновление после UI-проверки `.39` и Core Admin Surface — 2026-10-16

- Через native Studio trust flow установлен Server Editor `0.3.39`; UI подтвердил
  SHA-256 `595273528da6a0a2b52d9f5ee1df0421859ec84208fa0e26f5a5c76832336bd0`.
  Активный iframe загружен с URL версии `.39`.
- Устранение Admin Surface digest-ошибки подтверждено UI: Server Editor получил
  Core-backed descriptor через typed intent `service.admin-surface.inspect`
  (`serviceId=server`, target `local`) и отрисовал разделы управления сервисом,
  сайтов/релизов и сертификатов. Прямых REST-вызовов к сервису не было.
- В Settings Studio выбран CLI
  `/tmp/liapoldus-cli-admin-surface-verified.S16L94/liapoldus`; после применения
  через UI Admin Surface read завершился успешно. Пользовательский digest для
  этого кандидата: `9e65bae68b4130616d322a31a897f9a79d5cf42b2343313f0cb2b999c652d34b`.
- Typed Runtime metadata через Studio/Core показывает Echo `1.2.1` и Server
  `1.1.5` в состоянии `ready`, оба с `appliedGeneration=49`; Project-bound
  digests совпадают с зарегистрированными (`e492a665…` и `d1999f55…`).
- Read-only curl к
  `http://127.0.0.1:19080/echo?text=studio-final-check-20261016` вернул
  `HTTP 200`, `echo: studio-final-check-20261016`. Затем вызван Echo → Logs через
  Canvas и typed CLI `runtime.logs`; Studio Output подтвердил Echo stdout для
  generation markers `studio-config-generation-48` и `studio-config-rollback-49`.
  Строка для `studio-final-check-20261016` в returned log window не обнаружена;
  именно для этого запроса лог-подтверждение остаётся открытым.
- Открытый UI-дефект: `listeners[].hostnames` всё ещё показывает «Схема элемента
  списка недоступна» даже на активном `.39`; package tests не предсказали runtime
  schema input. Не считать исправленным — нужен targeted UI/schema fix.
- Root cause найден в условном JSON Schema merge: `allOf` задаёт для
  `hostnames` только `maxItems`/`type`, а shallow merge выбрасывал исходный
  `items`. В `.40` merge делает recursive merge sibling property schemas; новая
  bridge-render regression использует nested `$defs` и активную TLS conditional.
  Кандидат собран, 56/56 tests и Studio installer acceptance прошли; digest
  `1b49fd3300f5dff640aa3f04f9feb8aa23a7378c9f4e265e6b534e2ad9d9fcf6`. Не
  установлен; требуется native trust confirmation перед live UI проверкой.
- Настройки Project, draft, Core, Docker containers, credentials, certificates
  и artifacts не менялись.

### UI/runtime acceptance и оставшийся CLI-контракт — 2026-10-16

- Через Studio открыт Project `Server Echo Studio`; выбран CLI
  `/tmp/liapoldus-cli-core-update-fixed.wWB1gi/liapoldus` (SHA-256
  `03f414153806974300f174ced195b2eb2c3d0af1d3377d7a308b28dfe98312d2`), target
  `local`. Установлен и доверен Server Editor `0.3.36` с digest
  `4e220a586547c64947e4ba44def465c1585f914635156bc3e28264e3977fc13a`.
- Canvas показывает два независимых сервиса `echo@1.2.1` и `server@1.1.5`,
  оба `ready`; link направлен на `echo.handle`. Server Editor показывает один
  исходный `GET /echo`, обязательный query `text`, response contracts и live
  method `echo.handle · 1.1.0`.
- Через UI временный endpoint `GET /_studio-draft-probe` добавлен в общий draft
  с target `echo` / `echo.handle`, затем удалён из draft. После удаления
  сохранился только `/echo`; Project Save не выполнялся, runtime/Core не
  перезапускались.
- Обычный curl к `http://127.0.0.1:19080/echo?text=studio-console-check-20261016`
  вернул `HTTP 200` и `echo: studio-console-check-20261016`. Studio → Canvas →
  Echo → Logs ранее показал тот же query text в Echo stdout (`echo query
  received`). Контейнеры Core/Echo/Server остаются запущенными.
- Дополнительно через Studio изменён `Response prefix` с `echo: ` на `studio: `;
  UI сохранил настройки в Project и подтвердил применение Core generation 48.
  Обычный curl с `text=studio-config-generation-48` вернул
  `studio: studio-config-generation-48`, HTTP 200. Затем prefix возвращён через
  Studio к `echo: `; generation 49 подтверждён как applied/desired, а второй
  curl вернул `echo: studio-config-rollback-49`, HTTP 200. В Project
  `services/echo/settings.json` после UI-save записаны явные значения всех
  defaults вместе с исходным `messagePrefix: "echo: "`; тестовое значение
  `studio: ` не осталось. Свежий Output view в Studio содержит сохранённые
  старые события/логи, но не содержит новых маркеров generation 48/49;
  log-проверка именно этих двух запросов остаётся открытой, несмотря на
  подтверждённые HTTP-ответы и applied generations.
- Зафиксированы два UI-дефекта Server Editor: `listeners[].hostnames` не
  разыменовывает item `$ref` в установленном `.36`, а Admin Surface Server
  panel показывает `bridge.admin_surface_digest_invalid`. Исправление renderer
  `$ref` и bounded IPC payload parsing включено в Server Editor `.39`, digest
  `595273528da6a0a2b52d9f5ee1df0421859ec84208fa0e26f5a5c76832336bd0`; пакет
  прошёл 56/56 tests и Studio installer acceptance, но не установлен; exact
  action-time trust confirmation запрошено для установки.
  Текущий выбранный CLI
  имеет digest `03f414…`; в CLI source уже нормализуется канонический Core
  `sha256:<hex>` и есть регрессионный fixture. Проверка Wails redaction boundary
  также подтверждает, что он сохраняет канонический digest без изменений
  (`go test ./internal/presentation/wails -run
  'TestSafeCLIJSONPreservesCanonicalAdminSurfaceDigest|TestReadRuntimeServiceAdminSurfaceUsesCoreBackedTypedCLI'`).
  CLI дополнительно fail-closed проверяет, что canonical lowercase SHA-256
  совпадает с точными байтами descriptor; regression покрывает неверный,
  двойной и uppercase digest. `go test ./internal/infrastructure/coreapi
  ./internal/presentation/cli` проходит. Кандидат
  `/tmp/liapoldus-cli-admin-surface-verified.S16L94/liapoldus` имеет SHA-256
  `9e65bae68b4130616d322a31a897f9a79d5cf42b2343313f0cb2b999c652d34b`; это
  новая сборка из актуального исходника, она ещё не выбрана и не запускалась.
  Для Studio trust/run остаётся обязательное подтверждение непосредственно на
  шаге; текущий CLI и runtime не изменялись.
- Endpoint, draft add/remove, UI-save → Core generation apply/restore и curl
  acceptance подтверждены; свежая Echo log-строка для двух последних curl не
  подтверждена. Admin Surface/resource
  actions и сохранение отдельного нового endpoint в Project пока не
  подтверждены; не считать весь Studio production acceptance завершённым.

### Продолжение конфигуратора: generic Server inspector — 2026-10-16

- Найден источник `unsupported data form` в generic inspector: schema поля
  `apiRequestBody.schema` / `apiResponse.schema` помечены
  `x-studio-json-document`, но renderer трактовал их как небезопасный открытый
  объект; response `example` по контракту принимает любое JSON-значение, но не
  имел отдельной UI-аннотации. Добавлена Server-owned аннотация
  `x-studio-json-value` без ослабления fail-closed для непомеченных объектов.
- Studio показывает document/value как bounded JSON editor; промежуточный
  невалидный JSON остаётся локально в поле и не меняет draft. Host принимает
  только явно помеченный envelope, валидирует глубину/размер/prototype keys и
  сохраняет в Project исходное значение без служебного маркера.
- Проверка на реальном сгенерированном Server schema и settings Project теперь
  возвращает renderable `true` для root/config/routes/listeners (до исправления
  root/config/routes были `false`). Studio settings Go package, frontend model
  tests (33/33), TypeScript, targeted ESLint и frontend production build прошли;
  Server contracts tests и generated-contract check прошли.
- Контейнеры и Project runtime settings этой работой не менялись. Новую
  production UI сборку ещё не загружали в приложение. Live Docker smoke
  оставшегося Server 404 кандидата по-прежнему открыт. Подготовлен новый
  Server `1.1.6` Linux/arm64 binary с 404 + Core-backed schema annotation:
  `/var/folders/qk/694xx2l56_l01zmd37h82szh0000gn/T/liapoldus-server-configfix.XXXXXX.4UyCSUABmN/server`, SHA-256
  `264f144bbead45926cd0e65a1acaa6d0e9587ad279a2750d280c100b891e411b`. Его
  Project schema refresh и Docker start не выполнялись.

### Последнее продолжение — 2026-10-16

- В живой Studio подтверждены Project `Server Echo Studio`, выбранный CLI `dev`,
  target `local` и trusted Project pins Echo `1.2.1` / Server `1.1.5`.
  `runtime.plan` завершился успешно с этими совпадающими digest; `runtime.status`
  вернул `No runtime containers found`. Core-backed `service status` получил
  точную ошибку `connection refused` от `127.0.0.1:18180`.
- Через Settings → Local Core выполнен `Start Core` только для target `local`.
  Текущий CLI завершился с Docker exit 125: bind source path does not exist
  (абсолютный путь redacted Studio). Core не стартовал, сервисы и persistent
  state не менялись.
- Исправленный CLI-кандидат уже собран, SHA-256
  `0b9948e408932c552883d2aefd5e7134b96dc51e8b104161c3ef461a468c1319`,
  Mach-O arm64, путь `/tmp/liapoldus-cli-diagnostic-path.hT6h30/liapoldus`.
  Он хранит bootstrap token внутри Core state mount, передаёт typed JSONL
  diagnostic и распознаёт canonicalized macOS symlink paths без утечки пути.
  Предыдущие hashes `a2f5e96e...` и `864667a6...` устарели. Новый кандидат в
  Studio ещё не выбран/не запущен.
- Studio теперь показывает безопасный форматированный CLI error code рядом с
  сообщением Output; произвольные строки/значения не проходят code allowlist.
  UI-model regression прошёл 19/19; targeted Go parser/Wails tests и ESLint прошли.
- В открытом UI доказан дефект установленного Server Editor `0.3.36`: пока Core
  peer/method catalog ожидает ответ, страница показывает два одинаковых HTTP
  endpoint editor. Исправление `0.3.37` собрано и прошло 56/56 package tests,
  manifest validation и Studio installer acceptance. SHA-256 пакета
  `0484cee7f345c069bb77778fcf33fb832985b19eb8752fe70a11dd0cb0e8f5c4`;
  он пока не установлен, поэтому native UI fix не подтверждён.
- В Studio переведён toolchain probe с неподдерживаемого `liapoldus version`
  на bounded readonly `target list --studio-events`, включая проверку
  `cli-events/v1`; версии CLI больше не приписываются без доказательства.
  Исправлены валидатор schema-shaped settings и lint shadow findings.
- `make check-race` завершился успешно. `make desktop-build` собрал macOS/arm64
  `.app`, прошёл Wails bindings reproducibility и Go/frontend lint. `make test`
  дал 126/127: единственный провал — заранее существующий локальный diff
  `frontend/wailsjs/runtime/runtime.d.ts` (`any` вместо генераторного `unknown`),
  который сборочный pipeline нормализует. Локальные 4 сигнатуры `any` восстановлены
  после упаковки; не считать bindings drift исправленным и не затирать его.
- Проверка из UI подтвердила текущие trusted Project bindings без изменений:
  Echo `1.2.1` digest `e492a665…8a53204`, Server `1.1.5` digest
  `d1999f55…5c43c9b`; `credential.status` ранее был `configured`. Ни target,
  ни artifacts, Core DB, credentials, certificates, binaries и containers не
  изменялись.
- Повторно проверен mismatch приложения: запущенный до перезапуска bundle был
  от 2026-10-14 и не содержал уже реализованную кнопку `target.inspect`.
  Пересобран актуальный macOS/arm64 bundle командой
  `PATH=<bundled-node>:$PATH STUDIO_WAILS_PLATFORM=darwin/arm64 npm --prefix frontend run desktop:build`;
  исходник `StudioViews.tsx` и собранный UI содержат action. Пользовательские
  изменения в `frontend/wailsjs/runtime/runtime.d.ts` сохранены после генерации.
  Через запущенную актуальную Studio `target.inspect` завершился, вернув только
  safe metadata target (`environment=local`, `transport=local-process`), без
  путей. Это не локализовало несуществующий Docker bind source. Активный CLI
  остался `/tmp/liapoldus-cli-core-update-fixed.wWB1gi/liapoldus`; новый
  диагностический candidate не выбирался и не запускался. Core всё ещё
  остановлен, runtime containers отсутствуют.
- Host-side mount audit без чтения содержимого: Core binary/state DB, TLS
  directory и все bootstrap certificate/key files target `local` существуют.
  Staged Core binary также существует в user cache. Пути target state/TLS все
  классифицируются как `/tmp`; активен OrbStack `2.2.4`, Docker Engine включён,
  advanced Docker config `{}`. Официальная OrbStack документация заявляет
  поддержку bind mounts macOS paths и содержит фиксы для `/tmp`/`$TMPDIR`, так
  что расположение в `/tmp` остаётся гипотезой, не доказанной причиной. Docker
  context и фактический mount source, который отвергается daemon, пока не
  раскрыты из безопасного Studio output; не менять target paths или OrbStack
  settings. Нужна классифицированная диагностика новым CLI через Studio.
- Следующее действие по runtime: выбрать проверенный CLI-кандидат через Studio,
  затем повторить только `core.start` на target `local` и получить Core status.
  Сохранять target, Core DB, credentials, certificates и service bindings.
  Отдельно установить Server Editor `0.3.37` и подтвердить, что в native UI
  остаётся один endpoint editor во время ожидающего Core catalog.

### Самая свежая фактическая сверка — после перезапуска Studio

- Studio перезапущена через UI, чтобы завершить зависший CLI context; workspace
  `Server Echo Studio` восстановился. Последующие команды выполнялись только
  через UI/typed contract.
- `target.list`: target `local` зарегистрирован, `runtimeConfigured:true`,
  transport `local-process`. `credential.status`: `configured`.
- `target.test`: `reachable:false`, `status:0`; это ожидаемо после остановки
  Core и не доказывает ошибку credentials.
- `runtime.plan` прошёл и подтвердил Project `WORKING_TREE`, trusted artifact
  pins Echo `1.2.1` (`sha256:e492a665232fd329100b939b78938c4eb0fe59160d89dd1dd66aba6208a53204`)
  и Server `1.1.5` (`sha256:d1999f5516f5f37156d4ab2b482481db5d0dc8e57869b0aa9c0d42a065c43c9b`).
- `core.status`: `liapoldus-core`, `running:false`, `reachable:false`. Попытка
  `core.start` через Studio завершилась Docker `exit status 125`: bind source path
  отсутствует. Studio redacts абсолютный путь в CLI diagnostic. Core DB,
  credential, сертификаты, сервисные artifacts и Project не менялись.
- `Server Editor 0.3.36` установлен в Studio. В том же UI доступен
  `bridge.admin_surface_unavailable`; его live Core-backed details ещё не
  подтверждены из-за остановленного Core.
- В CLI source добавлена классификация `docker_mount_source_unavailable`: если
  Docker отказывает в bind mount Core, diagnostic называет только роль ресурса
  (staged Core binary / TLS / state / bootstrap token) и не раскрывает путь.
  Адресные CLI, Docker-adapter, `make check` и `make test-race` прошли. Изменение
  пока только в исходнике; выбранный CLI в Studio не заменялся.
- Settings → Local Core теперь предоставляет кнопку read-only `target.inspect`;
  output остаётся allowlisted и не раскрывает paths/credential values.
  Studio TypeScript/Vite production build и targeted ESLint прошли; build
  выполнен bundled Node runtime, поскольку системный Homebrew Node сломан.
- CLI source diagnostic ещё не выбран в Studio. Значит роль missing mount
  пока не подтверждена установленным CLI. До получения исправленной безопасной
  диагностики не повторять `core.start`, не угадывать путь, не пересоздавать
  target и не заменять binary/cert/DB.

### Новый CLI-кандидат по bootstrap mount — 2026-10-16

- В Studio → Settings → Tools and CLI проверен активный executable:
  `/tmp/liapoldus-cli-core-update-fixed.wWB1gi/liapoldus` (`dev`). Это не новый
  кандидат; поле выбора иного CLI требует проверки/trust выбранного файла.
- В command palette исходника добавлена локализованная команда `target.inspect`
  для быстрого безопасного просмотра target; Settings → Local Core использует
  тот же intent. Пересобрана macOS/arm64 Studio с этой командой:
  `build/bin/Liapoldus Studio.app`. TypeScript + Vite production build проходит.
  ESLint сейчас сообщает 4 `no-explicit-any` на пользовательских правках generated
  `frontend/wailsjs/runtime/runtime.d.ts`; их не перезаписывал.
- По коду CLI обнаружена вероятная причина старого `bind source path does not
  exist`: bootstrap token создавался в OS temp (`/var/folders` на macOS), тогда
  как Docker VM OrbStack может не иметь доступа к этой host location.
- CLI изменён: token directory создаётся внутри Core state directory, уже
  передаваемого контейнеру; отдельный `/run/secrets` bind mount удалён. Token
  остаётся одноразовым файлом `0600`, вычищается после старта; его значение не
  попадает в Docker env/logs/inspect.
- CLI `GOWORK=off make check` и `make test-race` прошли. Кандидат:
  `/tmp/liapoldus-cli-bootstrap-mount.4RkKsU/liapoldus`, SHA-256
  `a2f5e96e52d8a59c3c7b3beb9d93ceb2fcd22d29cdc21dddbe97eb1a47bb663b`.
  Он не выбран и не запущен; Core остаётся остановлен. Следующий UI-шаг —
  зарегистрировать этот exact CLI candidate и использовать только после review
  digest/trust внутри Studio. После установки один раз выполнить `core.start`
  для target `local`, затем проверить `core.status`; при успехе перейти к
  service runtime и curl acceptance.

### Текущий checkpoint — уточнение после проверки UI

- Предыдущие пункты этого checkpoint фиксируют успешное состояние на момент
  проверки, но оно не сохраняется после завершения длительной сессии: повторный
  typed `runtime.status` через Studio сейчас показывает Core `running`, а
  `liapoldus-echo` и `liapoldus-server` — `exited`. Старые run events содержат
  `service SDK replica lease expired`; они исторические и не доказывают текущую
  готовность сервисов.
- Повторный Start из Runtime через Studio не восстановил сервисы: Core остаётся
  `running`, Echo/Server остаются `exited`. В предыдущем запуске UI показал
  `Live contract or artifact provenance for service server must be reviewed
  before Core apply`. На Canvas у Server были `manifest unknown`, `readiness
  unknown`, live schema недоступна, а применение приостановлено. После установки
  нового расширения точная ошибка — `bridge.admin_surface_unavailable`; метод
  `echo.handle` всё ещё ожидает live peer contract через Core.
- В Studio → Artifacts удалены только локальные CLI registry entries старых
  версий; внешние binaries, Project, Docker containers и Core data не удалялись.
  Оставлены Project-bound Echo `1.2.1` и Server `1.1.5` с неизменными digest.
  Registry теперь показывает по одной записи для каждого сервиса.
- Server Editor `0.3.36` установлен через Studio после подтверждения exact
  digest `4e220a586547c64947e4ba44def465c1585f914635156bc3e28264e3977fc13a`.
  Source/package прошли 55/55 tests, manifest validation и installer acceptance.
- Последние доступные runtime diagnostics: `service SDK replica lease expired`
  в startup output обоих сервисов; прежняя попытка Core registration для Echo
  завершалась `context deadline exceeded`. До следующего запуска надо локализовать
  причину lease/registration по Core и Service SDK контракту; не повторять Start
  вслепую и не объявлять контейнеры готовыми.
- Политика непрерывной работы уже закреплена в корневом и Studio `AGENTS.md`,
  `studio/plan.md` и этом TODO; цель остаётся активной. Не просить повторное
  разрешение для неизменного target `local`, уже подтверждённых artifact
  digests и обратимых действий в пределах этого smoke. Уважать отдельный
  action-time барьер установки неподписанного программного пакета.

- После сборки Go в системе OrbStack показал `Stopped unexpectedly: I/O error`
  и `Service Not Running`; это объяснило прежний ложный `provider_missing` и
  остановку контейнеров. OrbStack запущен из собственного UI, после чего через
  Studio → CLI выполнен `runtime.start` для уже подтверждённых Project/target
  `Server Echo Studio` / `local` и неизменных trusted digests. Операция завершилась
  `runtime.completed`; Core, Echo и Server видны в Canvas как готовые, а
  `runtime.status` вернул все три контейнера `running`.
- Повторный обычный curl после восстановления: `GET
  http://127.0.0.1:19080/echo?text=studio-resumed-runtime` вернул HTTP 200 и
  `echo: studio-resumed-runtime`. Кнопка Logs на выбранном Echo в Canvas
  показала stdout `echo query received` с тем же значением. Core DB,
  credentials, сертификаты и Project не менялись.
- Проверка контракта после восстановления: тот же `/echo` без обязательного
  query `text` вернул HTTP 400. Endpoint и service-to-service path не менялись.
- Server также проверен после восстановления: readiness `ready`, Core-backed
  configuration generation отображается как применённая; Server Editor 0.3.34
  открывает сохранённый `GET /echo`, peer method `echo.handle`, форму ответов и
  кнопку удаления endpoint. При этом панель Admin Surface всё ещё показывает
  общий текст «Управление сервисом недоступно через Core», без CLI error code.
  Уточнено, что готовый архив 0.3.35 устарел относительно исходника и всё ещё
  содержит общий catch. Исправленный 0.3.36 собран из точного исходника,
  прошёл 55/55 source tests, manifest validation и Studio package inspection;
  digest `4e220a586547c64947e4ba44def465c1585f914635156bc3e28264e3977fc13a`.
  Пакет не установлен; подтверждение требуется именно для 0.3.36. До UI-проверки
  точного кода ошибки не менять Core API по предположению.
- В CLI исправлена классификация Docker probe: отсутствие executable теперь
  означает `provider_missing`; установленный Docker CLI с недоступным daemon
  или пустым server version означает `provider_unavailable`. Добавлены
  regression-тесты на оба состояния и успешный probe. `make check` и
  `make test-race` в CLI прошли. Изменённый CLI source ещё не пересобран и не
  выбран в Studio; этот узкий source fix не является причиной успешного
  восстановления runtime и не объявляется установленным.
- Через Studio выбран Project `Server Echo Studio`, CLI `dev`, target `local`.
  Core-only restart уже был выполнен через typed `core.stop`/`core.start`;
  последующий typed `runtime.start` завершился событием `runtime.completed`,
  Core принял регистрации `echo` и `server`, а typed `runtime.status` показал
  `liapoldus-core`, `liapoldus-echo` и `liapoldus-server` как `running`.
- Core-backed Server status в Studio: artifact `server` `1.1.5`, digest
  `d1999f5516f5f37156d4ab2b482481db5d0dc8e57869b0aa9c0d42a065c43c9b`,
  identity `server/server`, `ready:true`, applied generation `36`.
  Core-backed Echo status: artifact `echo` `1.2.1`, digest
  `e492a665232fd329100b939b78938c4eb0fe59160d89dd1dd66aba6208a53204`,
  identity `echo/echo`, `ready:true`, applied generation `35`.
- В Studio Server Editor виден сохранённый `GET /echo` (`echo-route`) с
  обязательным одиночным query-параметром `text`, направлением на независимый
  сервис `echo`, метод `echo.handle`. Настройки Echo в inspector показывают
  логирование принятого текста, query parameter `text` и response prefix
  `echo: `; Core сообщает применённую generation `36`.
- Через UI Server Editor добавлен `/studio-draft-smoke` в общий draft и удалён
  до сохранения. В Project остался только исходный `GET /echo`. Затем UI
  сохранил текущий Server API draft в Project; сообщение Studio подтвердило
  `Настройки сохранены в Project. Применение к Core — отдельная операция.`
  Runtime-конфигурация от этой draft-проверки не менялась.
- Обычный curl acceptance: `GET /echo?text=studio-smoke-2026-10-16` вернул
  HTTP 200 и `echo: studio-smoke-2026-10-16`; запрос без обязательного `text`
  вернул HTTP 400. Кнопка Logs для Echo в Studio показала запись
  `echo query received` с `text=studio-smoke-2026-10-16` и stdout.
- Следующий независимый curl `text=echo-independent-service-proof` вернул
  HTTP 200 и соответствующий `echo: ...` body. Общий production-ready статус
  не объявлять без полного набора acceptance сценариев.

- Пользователь подтвердил Core-only update в target `local` для проверенного
  кандидата `linux/arm64`, SHA-256
  `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`.
  Повторное подтверждение для тех же target/digest/операции не требуется.
- Studio показывает Project `Server Echo Studio`, CLI `dev`, target `local`;
  Core и обе независимые сервисные реплики running/ready, с live artifact
  digests, совпадающими с Project. UI-driven curl и Echo stdout log подтверждены.
- Старые записи ниже, утверждающие, что согласие на этот Core digest отсутствует
  или update запрещён, относятся к состоянию до последнего подтверждения и
  больше не являются текущим blocker. Исторические результаты сохранены;
  production-ready acceptance всё ещё не объявлен.
- Режим работы: продолжать вертикальный Studio сценарий без повторных вопросов
  для уже подтверждённых точных scope/операций; новые вопросы задавать только
  при реальном изменении scope или блокере, требующем отсутствующего решения.

## Фазы 0–5 — Studio frontend и plugin host

### Local Core binary update — 2026-10-15

- [~] Добавлен typed Studio → CLI flow: inspect выбранного Linux ELF, review
  полного SHA-256/platform и отдельное подтверждение перед обновлением только
  Core target `local`. Путь хранится в CLI target registry, не в Project.
- [x] Core CLI planner and Wails host use one typed `core binary update`;
  candidate is started and health-checked before its path/digest is committed
  to the CLI target registry. A failed start preserves the prior target entry
  (but may leave Core stopped; SQLite migration rollback is not provided).
  Targeted CLI regression passed: changing the Core digest
  replaces only the selected target-owned Core container; invalid ELF, symlink,
  path disclosure and missing-confirmation cases are rejected. Wails fake-runner
  regression verifies inspect → digest re-inspect → one confirmed update intent;
  service containers and Project scope are not part of that flow.
- [~] CLI registry-commit failure now triggers cleanup of only the candidate
  Core container; a regression asserts no service container is stopped/removed.
  CLI and Studio focused Go suites pass. Latest CLI build digest is
  `41a2e26d0ee12915a4f218aafcd4e8c85b5ce1a71d65336f4cb2ef5f36acdbfa`; the
  user approved and selected it through Studio Toolchain.
- [x] CLI пересобран из текущего исходника: `/tmp/liapoldus-cli-core-update.a1LCc8/liapoldus`,
  SHA-256 `603dce5506c4106d05e24f45ff617e29f6594a5777ebfedeb3910fcc86deb070`;
  пользователь одобрил этот digest, бинарник выбран через Studio Toolchain.
  Позже пользователь одобрил для Core-only update CLI
  `/tmp/liapoldus-cli-auto-core-update`, SHA-256
  `847f2ac4394a5c9cacabe6a6373f3da38edea723e7f0a369e03799a1685ed5fc`; он
  выбран через Studio Toolchain. Typed `core.status` подтвердил
  `liapoldus-core` running, но `core.binary.inspect` завершился точной ошибкой
  `cli.stderr: invalid argument "inspect"`. CLI source и focused tests
  принимают `core binary inspect`; собран кандидат из текущего CLI source
  `/tmp/liapoldus-cli-core-update-fixed.wWB1gi/liapoldus`, SHA-256
  `03f414153806974300f174ced195b2eb2c3d0af1d3377d7a308b28dfe98312d2`.
  После подтверждения пользователя кандидат выбран через настройки Studio.
  Предыдущий системный picker оставлял `Open` disabled даже при выбранном
  executable; поля CLI/Core binary теперь допускают явный ввод пути, а
  Core flow разделён на выбор, read-only inspect и отдельное подтверждение
  update. Повторный `core binary inspect` через Studio успешен. Wails app
  пересобран и открыт; TypeScript, production frontend build и ESLint прошли.
- [x] Через Studio получено read-only исходное состояние target `local`:
  Core Management API reachable; `liapoldus-core`, `liapoldus-echo` и
  `liapoldus-server` показывают `running`.
- [x] Через исправленный CLI из Studio проверены Core candidate и точный
  SHA-256 `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`,
  пользователь подтвердил digest и UI-driven `core binary update` завершился.
  Последующий typed `core.status` показал `liapoldus-core` running и
  `reachable:true`.
- [x] Ранее обнаруженная остановка сервисов после Core update была устранена:
  owner-owned `MaintainReplicaLease` в Service SDK восстанавливает регистрацию
  прежней incarnation после временной недоступности Core. Затем пользователь
  одобрил точные Server/Echo digests для target `local`, они были trusted и
  запущены через Studio. Позднее OrbStack остановился с I/O error; после
  восстановления provider тот же target был снова запущен через Studio и
  проверен curl/logs (см. актуальную сверку выше).
- [x] Runtime vertical smoke через Studio и обычный `curl`:
  `http://127.0.0.1:19080/echo?text=studio-vertical-check-20261015` вернул
  HTTP 200, `text/plain; charset=utf-8`, body `echo: studio-vertical-check-20261015`;
  Studio CLI Output получил Echo log `echo query received` с тем же значением.
- [x] Повторный UI-driven smoke после выбора исправленного CLI:
  существующий `GET /echo` в Server Editor объявляет обязательный query `text`
  и target `echo.handle`; `curl --get --data-urlencode
  'text=studio-smoke-20261015' http://127.0.0.1:19080/echo` вернул HTTP 200 и
  `echo: studio-smoke-20261015`. Studio Output показал Echo stdout event
  `echo query received` с тем же текстом. Core/containers не перезапускались.
- [x] Исправлен React maximum-update-depth в Canvas Inspector для пустого выбора
  через стабильный empty runtime-replicas selector; после Wails rebuild Canvas
  открывается без падения. Wails error objects теперь сохраняют безопасные
  actionable `message/error/cause` для Core binary update diagnostics; targeted
  frontend tests 18/18 и ESLint прошли.
- [~] Native Server Editor теперь открылся при выборе узла `server`; существующий
  `/echo` и Add endpoint form видимы. Попытка добавить только временный
  `/draft-test` → `echo.handle` была отвергнута host bridge с точной ошибкой
  `bridge.provenance_mismatch`; форму отменили. Предыдущий patch handler при
  этом лишне вызывал `core.start` (CLI сообщил `running: true`, `updated: false`),
  что provenance не исправило. Это поведение удалено: теперь mismatch
  fail-closed без неявного Core start, покрыто regression-тестом. Project,
  service containers и Core binary не менялись. `Сохранить в Project` остаётся
  disabled, пока Core live registration не будет согласована с Project.
  Read-only Core inspect показал
  `linux/arm64`, SHA-256 `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`;
  обновление не выполнялось, поскольку ранее подтверждён другой digest.

- [x] UI-driven recheck 2026-10-16 после явного одобрения Server/Echo и target
  `local`: Studio Runtime Plan подтвердил trusted pins ровно
  Server `1.1.5` `d1999f5516f5f37156d4ab2b482481db5d0dc8e57869b0aa9c0d42a065c43c9b`
  и Echo `1.2.1` `e492a665232fd329100b939b78938c4eb0fe59160d89dd1dd66aba6208a53204`;
  Project уже ссылался на эти digest. Core, Echo и Server были `running`, поэтому
  одинаковые binaries не перезапускались и bindings не менялись. Core-backed
  reads через Studio вернули обе identity/readiness (`ready: true`, generation
  `31`) с совпадающими artifact digest. Свежий
  `curl http://127.0.0.1:19080/echo?text=studio-approved-digest-verification-20261016`
  вернул HTTP 200 и ожидаемое тело; Echo Logs, открытые кнопкой Logs в Canvas,
  содержат тот же query text. Это подтверждает текущий UI → CLI → Core read и
  Server → Echo runtime path, но не требует Docker lifecycle mutation.
- [~] Не считать баннер Server Editor `Управление сервисом недоступно через
  Core` доказательством недоступности Core: в этот же момент Core-backed reads
  и configuration generations были доступны. В Studio Runtime → Metadata →
  Echo → Manifest через `Read via Core` показан live `peerContracts` с
  `echo.handle` версии `1.1.0`. Server Editor 0.3.34 при повторном открытии
  иногда показывает сохранённый method как отсутствующий до завершения запроса;
  выбор Echo в Add endpoint после загрузки каталога позволяет выбрать
  `echo.handle`. Тестовый `/echo-draft-check` добавлен и удалён только в общем
  draft; Project не сохранялся, после переоткрытия кнопка Save отключена и
  остался только `/echo`. В `plugins/studio-server/` подготовлен 0.3.35 с
  корректной индикацией loading/error/confirmed-missing, targeted suite 28/28 и
  installer acceptance пройдены; установка ожидает подтверждения точного
  package digest. После установки перепроверить повторное открытие и затем
  продолжить UI-driven save/apply/curl acceptance. Core и runtime artifacts не
  менять.

### Phase 0 — Governance & docs

- [x] Зафиксировать desktop-only модель, typed host boundaries, tabbed shell и
      запрет на встроенный редактор в `AGENTS.md`, `plan.md` и README.
- [x] Синхронизировать product, workspace, UI, frontend, security, plugin и
      roadmap docs с реализованным поведением.
- [x] Описать ограничение: UI-surface declaration остаётся контрактом владельца
      Studio-plugin package и не расширяет SDK/Core в этом репозитории.

### Phase 1 — Внешнее редактирование файлов

- [x] Удалить CodeMirror и редакторные зависимости/ассеты.
- [x] Удалить встроенный file document state, `openFile`, Cmd/Ctrl+S и Go
      `ReadProjectFile`/`WriteProjectFile` bindings.
- [x] Открывать файлы через безопасный native external-editor adapter и
      per-pattern associations.
- [x] Обновить Wails binding adapter и fail-closed schema tests.

### Phase 2 — Desktop shell и навигация

- [x] Native macOS title bar; platform window controls; Home, Settings и
      workspace switcher в минималистичном top bar.
- [x] `workspace/v4`, tabs, close/reorder/scroll, restore и left activity rail.
- [x] Перенести Reports, Problems и Output во вкладки; удалить нижний dock.
- [x] Реализовать Settings: editor associations, appearance, language,
      выбор и проверку CLI-бинарника с сохранением в SQLite и local Core.
- [x] Сохранить RU/EN интерфейс и neutral black/white/gray design tokens.

### Phase 3 — Inspector

- [x] Schema-driven settings renderer для поддерживаемых типов; неизвестные
      формы fail-closed и отмечаются как недоступные.
- [x] Читать redacted settings, писать только validated safe patches.
- [x] Редактировать полный typed service link contract через атомарный Go API.
- [x] Показывать identity, source binding, project/Git context и typed actions.
- [x] Реализовать safe latest-report summary без payload/replica diagnostics в
      renderer; при отсутствии отчёта возвращать пустое состояние.

### Phase 4 — Sandboxed Studio-plugin surfaces

- [x] Path-confined отдача plugin UI assets с ограничением размера, symlink и
      traversal checks.
- [x] Изолировать surface в `<iframe sandbox="allow-scripts">` без same-origin,
      popups, forms, Wails bindings, filesystem и Node.
- [x] Проверять versioned `postMessage` handshake; дать плагинам собственные
      workspace tabs и rail launchers.
- [x] Добавить тесты asset confinement, sandbox route и bridge validation.
- [~] Расширять versioned Studio Plugin SDK host contract по мере прохождения
      следующих функциональных гейтов. Базовый `studio-service-editor/v1`
      bridge принадлежит `studio/`; это не Service SDK и не Wool contract.

### Phase 5 — Cleanup & verification

- [x] Удалить старые editor/brand assets; оставить только переданный пользователем
      логотип и Lucide icons.
- [x] Проверить graph edge routing и группировку повторных diagnostics.
- [x] `GOWORK=off GOFLAGS=-p=1 make check`.
- [x] `GOWORK=off GOFLAGS=-p=1 make check-race`.
- [x] `GOWORK=off GOFLAGS=-p=1 make desktop-build` на macOS/arm64.
- [x] Smoke-test `wails dev`: окно, canvas и навигационные вкладки; dev-процессы
      остановлены, smoke-вкладки закрыты.
- [x] CLI failure path показывает безопасный actionable diagnostic вместо
      общего `cli.exit`; Studio runner не дублирует terminal event, а JSON CLI
      output на backend→renderer boundary маскирует credential references,
      local file/binary/socket paths и private-key/bearer values. Проверено
      regression tests и повторно через native Studio UI.
- [x] Повторный полный `PATH=<bundled-node>/bin:$PATH
      GOTOOLCHAIN=go1.26.0 GOFLAGS=-p=1 make check` на macOS/arm64 прошёл:
      Vite production build, воспроизводимая генерация Wails bindings,
      `golangci-lint` 2.14.0 (0 issues), Go tests/vet/build и 81/81 frontend
      tests. Linter pin обновлён с 2.5.0, несовместимого с текущим Go 1.26,
      до 2.14.0; команда проверки config приведена к CLI syntax этой версии.
- [x] Повторный `PATH=/Users/docup/.nvm/versions/node/v20.19.4/bin:$PATH
      GOWORK=off GOFLAGS=-p=1 make check` на текущем рабочем дереве прошёл:
      production frontend build, Wails bindings reproducibility, lint, Go
      tests/vet/build и 115/115 frontend tests. Системный Homebrew Node 26 на
      машине не стартует из-за отсутствующей dylib `libllhttp`; проверка
      выполнена явно закреплённым доступным Node 20.
- [x] Обновить Installer acceptance для новой sibling asset `ui/protocol.js`
      Server StudioPlugin; пакет проверяется изолированным zip-install test.
      Направленную проверку `postMessage` origin документировать как правило:
      host принимает opaque iframe origin `null`, plugin закрепляет origin окна
      Studio после handshake.

## Независимые production/release gates

- [~] CLI runner, target catalog, Core lifecycle и remote handoff зависят от
      опубликованного versioned CLI contract и реального локального toolchain.
- [~] Companion-tool sandboxing и permission model требуют платформенных
      release-проверок (macOS/Linux sandbox, Windows AppContainer).
- [~] Git, reports, runtime и plugin workflows реализованы; остаются
      cross-platform integration/smoke проверки.
- [~] Cross-platform CI уже настроен в `.github/workflows/verify.yml` для
      Linux/amd64 (AppImage), Windows/amd64 (NSIS/AppContainer smoke) и
      macOS/arm64: Go test/vet/build, bindings, frontend lint, desktop package и
      package smoke. `.github/workflows/release.yml` также содержит gated
      signing/notarization, checksum и provenance steps. GitHub combined status
      для текущего `main` HEAD `4fc70a059856cf5d13d06e22c1dcc667550cf61e`
      вернул пустой список statuses; подтверждённого hosted run workflow на
      этом HEAD нет. Поэтому
      cross-platform PASS и reproducibility не объявляются. Отдельно остаются
      проверка upgrade path на Windows/macOS/Linux и crash-diagnostic behavior.

## Граница готовности

Фазы 0–5 реализованы для локального macOS/arm64 build и проходят перечисленные
checks. Это не означает, что межрепозиторный plugin UI contract или все
Windows/Linux production/release gates уже закрыты.

## Согласованный конфигуратор сервисов — 2026-10-13

Канонический scope и acceptance: [`plan.md`](plan.md), разделы 3–13. Фазы
desktop shell/локального StudioPlugin host выше — уже существующая платформа;
они не означают, что новый конфигуратор готов.

### Status после инвентаризации

- [x] Control-plane команды `service inspect|manifest|schema|status` есть в CLI;
  Core metadata API возвращает manifest/schema/status, не вызывая бизнес API.
- [x] Core child-process Management API gate 2026-10-15 проверяет relay
  `service-configuration-ui/v1` в manifest без изменения descriptor; SDK
  child-process REST gate и Core opaque-relay gate пройдены отдельно.
- [~] Studio получает Core-backed live manifest и JSON Schema через
  последовательные typed CLI intents с явными projectId + serviceId; metadata
  operation не перенаправляется при смене workspace. Перед применением SDK UI
  descriptor Studio сравнивает live schema с Project schema, игнорируя только
  порядок object keys. При drift UI descriptor отбрасывается, редактирование
  и Core apply приостанавливаются, draft сохраняется; offline draft можно
  сохранять только в Project, без заявления об apply. После восстановления
  сохранением draft. Renderer использует Project schema только после успешной
  live-проверки. Теперь Studio сверяет live manifest и Core status с artifact
  ID/version/digest из Project; Core status включает весь набор активных
  replica release claims и Core закрывает metadata при mixed version/digest.
  Studio читает status→manifest/schema→status и отклоняет смену состава replica
  или release во время чтения.
  Та же проверка повторяется перед apply и после runtime start/stop/restart.
  Schema refresh теперь временно блокирует ввод и сначала flush-ит debounced
  draft в SQLite, затем обновляет schema и восстанавливает draft; regression
  проверяет гонку немедленного refresh. Mismatch разделяется на schema и
  artifact/replica provenance; замену schema можно подтвердить только через
  отдельный owner-side preview: host возвращает redacted schema, bounded diff
  paths и проверку canonical Project values + safe draft overlay против новой
  schema. Подтверждение закреплено digest-ами live schema, settings snapshot и
  точного draft; перед записью host заново получает Core schema, пересчитывает
  совместимость и отклоняет устаревший preview. Preview read-only, значения
  автоматически не мигрируются; mismatch сохраняет локальный draft и требует
  явного решения оператора. Нужны UI acceptance на реальном Core и recovery/
  rollback workflow для ручного исправления несовместимых значений.
  Studio автоматически перепроверяет Core-backed runtime status открытых
  service drafts раз в минуту, пока typed CLI простаивает. Несовпадение
  artifact version/digest немедленно переводит конфигурационный контракт в
  provenance mismatch и блокирует редактирование/apply; при восстановлении
  ожидаемого release Studio повторно получает manifest/schema и сверяет
  provenance до возобновления работы. Остаётся доказательство digest-
  происхождения: Core status связывает digest с authenticated replica
  registration, но не доказывает содержимое запущенного binary.
- [~] Есть schema-driven renderer и безопасное redaction/patch API. Вложенные
  объекты, scalar/enum controls и обычные массивы с
  add/duplicate/remove/drag reorder и keyboard reorder работают через общий
  draft. Для массивов со скрытыми secret/read-only полями frontend отправляет
  только typed versioned sparse field patches и `move`/`duplicate`/`remove`
  операции; Go накладывает их на canonical Project values, сохраняя скрытые
  поля и отклоняя полную замену, неверные индексы и нарушения schema bounds.
  Protected arrays теперь поддерживают typed `insert` из schema-derived
  безопасного шаблона; обязательные видимые resource references можно выбрать
  в созданной форме. Добавление fail-closed только когда шаблон не может
  инициализировать required field, недоступный для редактирования в Studio.
  Incomplete rows остаются только в локальном draft: backend принимает
  ограниченный insert без записи в canonical Project, а atomic Project save
  всё ещё требует полной schema validation. Проверены вставка → safe leaf patch
  → reorder без утечки скрытых значений (frontend focused suites 36/36, Go
  settings package PASS); production frontend build и targeted ESLint PASS.
  Backend и renderer fail-closed
  проверяют schema annotations
  (`writeOnly`, `format: password`, vendor markers), чувствительные имена и
  `allOf`/`anyOf`/`oneOf` branches. Settings snapshot redaction также проходит
  эти composition branches: чувствительное поле скрывается, если оно объявлено
  хотя бы в одной альтернативе; regression test подтверждает, что безопасные
  sibling fields остаются видимыми. Renderer поддерживает bounded local
  `$ref` в том числе в `items` массивов (Server `listeners[].hostnames` больше
  не отображается как неподдерживаемая схема), discriminated `oneOf`, композицию
  `allOf` и активные `if/then/else` ветки; внешние/циклические ссылки и
  неоднозначные `anyOf` остаются fail-closed. Типизированные dynamic maps через schema-valued
  `additionalProperties` поддерживают добавление, редактирование и удаление
  ключей; удаление хранится как bounded typed operation и сохраняет остальные
  значения карты. Чувствительные ключи/значения, неподтверждённые формы,
  `patternProperties`, `propertyNames`, `dependentSchemas` и произвольные
  open JSON objects остаются fail-closed. Удаление новой записи до сохранения
  сворачивается в draft без лишней операции.
  Числовые поля и слайдеры
  дополнительно валидируют непустой JSON number, безопасный integer, min/max,
  exclusive bounds и `multipleOf`; некорректный промежуточный ввод остаётся
  локальным текстом поля и не подменяет последнее валидное значение draft.
- [~] Добавлен общий project/service-keyed Zustand draft для schema Inspector:
  redacted base, точечный JSON patch, revert-to-base, debounced SQLite
  persistence, save/discard и loading/dirty/saving/error/conflict состояния.
  SQLite migration v7 хранит только проверенный non-sensitive patch; прямые
  settings intents адресуют `projectId + serviceId`, поэтому смена активного
  workspace не перенаправляет фоновую запись. Перед сохранением Project host
  сравнивает SHA-256 snapshot; settings commit повторяет compare под per-file OS
  lock и выполняет atomic replace. Два независимых Studio subprocess с одним
  исходным digest проверены: один commit проходит, второй получает conflict;
  macOS runtime test и Windows cross-compile прошли. Это защищает от конкурентных
  Studio writers. Произвольный внешний редактор не использует Studio lock,
  поэтому гонка именно в момент его записи пока не полностью координируется.
  Debounced auto-apply сериализован по Project/local-target scope; правки разных
  service drafts, поступившие во время Core operation, сохраняются в Project и
  схлопываются в один следующий apply с общим актуальным working-tree snapshot.
  Regression блокирует первый apply, меняет два service drafts и подтверждает
  один повторный Core intent после сохранения обоих. Recovery marker v2 сохраняет
  safe Core operation ID из CLI event; после перезапуска Studio даёт явно
  запустить typed `operation.watch` и очищает marker только после `succeeded`/
  `completed`. Failed/degraded/timeout оставляют recovery paused; повторный apply
  требует подтверждения. Durable CLI per-target queue теперь восстанавливает
  принятые operations между процессами; terminal `failed` блокирует новую
  отправку до отдельного Studio action `Retry failed apply`, typed intent
  передаёт `--retry-failed`, а новый idempotency key записывается в journal до
  Core request. `degraded` остаётся fail-closed. Cancellation уже принятой Core
  operation, degraded replica reconciliation UI и полный process-crash E2E
  остаются открытыми. После закрытия Studio сохранённый operation ID можно
  сверить вручную при следующем открытии.
  После успешной записи Project локальный draft удаляется; ошибка cleanup
  остаётся видимой. Bounded logical
  undo/redo теперь доступно в общем Zustand draft: быстрый ввод одного поля
  coalesce-ится, structural array actions остаются отдельными, новая правка
  сбрасывает redo, а история содержит только safe patches. История живёт в
  памяти сессии и очищается после успешного save/reload. Остаются external-editor
  race coordination, persistent history, явная группировка нескольких полей,
  полная replica effective-state модель и digest-aware CLI operations.
- [~] В Service SDK реализован versioned `service-configuration-ui/v1`
      descriptor и schema-aware validation. Core opaque-relay, CLI Core-backed
      response и Studio parser/renderer связаны. Echo публикует metadata для
      шести независимых settings; Server публикует schema-validated descriptor
      для listeners и service HTTP contracts. Wildcard hints теперь применяются
      к конкретным элементам массивов. SDK owner-side adversarial/REST-byte
      parity corpus закрыт; digest provenance и runtime-level metadata
      acceptance ещё открыты. 2026-10-15 SDK child-process fixture теперь
      публикует descriptor из `NewManifestProvider`; два затронутых REST
      integration suite прошли 101/101. Полный acceptance см. owner TODO.
- [~] Echo-owned query/prefix/limit/response/logging settings и SDK UI
      descriptor проходят local Go tests/build/vet; live Core/CLI runtime и
      визуальная проверка в Studio остаются открытыми. Server typed HTTP
      request/response contract и специализированный editor реализованы
      частично; полный runtime workflow остаётся открытым.
- [~] Server Editor source обновлён до `0.3.34`: ответы и незавершённые операции
      привязаны к generation Project/service/locale context; поздние ответы,
      debounce, writes и save не могут перерисовать новый контекст. Regression
      и весь пакет проходят 53/53; manifest validation и Studio installer
      acceptance прошли. Пакет `plugins/studio-server/dist/liapoldus.server-editor-0.3.34.studio-plugin`,
      SHA-256 `2f95fb9e55a35801060b57d56a906c84d6adddec2dd4a796a41ea0a2af2e3fc4`;
      в активной Studio остаётся установленным .32, .34 не устанавливался.
- [~] Core binary update flow переведён с неработающего `window.confirm` на
      видимое встроенное подтверждение с exact platform/digest и scope изменений.
      ESLint, TypeScript и production frontend build прошли; Wails пересобран.
      Проверка UI обнаружила несовпадение выбранного CLI contract (`inspect|set`)
      с current source (`inspect|update`); попытка завершилась до Core operation.
      Для продолжения нужен новый доверенный CLI digest; runtime остаётся running.
- [~] Server StudioPlugin реализуется только в workspace `plugins/studio-server/`,
      отдельно от runtime `services/server/`. Пакет `0.3.27` включает typed
      endpoint designer для `server-http/v1`, advisory listener/hostname
      diagnostics, общий safe draft и Project save; SDK-owned
      `service-configuration-ui/v1` приходит отдельным permission-scoped host
      intent и снабжает формы локализованными hints/slider. Numeric editor
      валидирует schema bounds/`multipleOf` и не сохраняет пустое поле как `0`.
      Теперь package сохраняет и применяет SDK group descriptions и bounded
      group/field order к generic listener controls и specialized endpoint/
      request sections. Добавлен regression test полного sandbox handshake,
      settings response и первого generic render. В `0.3.18` исправлена причина
      no-op добавления endpoint: `config.routes` — обычный массив, но bridge
      передавал его в protected-array helper, который синхронно бросал
      `settings.array_operation_not_allowed`; теперь для обычных массивов host
      получает полный draft array, а для protected arrays остаются typed ops.
      Пакет `0.3.27` прошёл 41/41 source tests, manifest validation и Studio
      Installer acceptance. GUI installation/trust подтверждён пользователем
      для SHA-256 `191effbc05457a04ce5bd74c9878c9aed9d8be2326a2478bf9d950af4a2d5c3d`.
      В GUI 0.3.27 видны GET `/echo`, обязательный query `text` и response
      contract. UI regression выявил первопричину: response add/remove handler
      вызывал неопределённый `rerender` (ReferenceError). В source `0.3.28`
      передан render callback; response operations ожидают async host
      acknowledgement. При UI-проверке активного `0.3.27` найден ещё один
      дефект: Add Response всегда использовал status 201, даже если такой
      response уже есть. Server отклоняет повторные status во время activation;
      Core вернул для `service-settings-apply` безопасный код `activation_failed`.
      В source `0.3.29` новый response выбирает первый свободный HTTP status
      (для текущих 200 и 201 — 202) и отключает Add при достижении schema limit.
      Добавлены реальные fake-DOM клики по remove и Studio host
      insert/remove test для вложенного `$ref` (42/42 package tests, 20/20 host
      tests). Package `0.3.28` прошёл manifest validation и Installer acceptance;
      SHA-256 `1411a59983b3c98d062843751a59064c1d7aec545f8dc6de3f7d5ad29e7ba46e`.
      Он ещё не установлен: перед заменой активного `0.3.27` требуется
      подтверждение нового digest. Project `server-integration/services/server/settings.json`
      остаётся `{}`, `.studio/workspace.json` не изменён; тестовый response 201
      не сохранялся в Project.
      Последующая source-правка `0.3.29` устраняет duplicate-201: тест выбора
      свободного status и UI acknowledgement проходят; пакет прошёл 44/44
      tests и Installer acceptance. SHA-256
      `358f61b96f773dbdf417585e52b3adc8e26eb5f33670d96e9edef9da665ad24f`;
      установка/trust ожидает отдельного подтверждения. После неудачного apply
      Core сообщает applied generation 18, pending 19 и `ready:false`; активный
      endpoint пока продолжает отвечать HTTP 200. Project не сохранялся.
      `curl http://127.0.0.1:19080/echo?text=studio-editor-0327-smoke` вернул
      HTTP 200 и `echo: studio-editor-0327-smoke`; Echo container log содержит
      тот же query. Server container продолжает периодически логировать Caddy
      coordination-lock `unexpected end of JSON input`; investigate despite
      successful readiness/curl.
      Protected collections показывают редактируемые поля и поддерживают
      host-side move/duplicate/remove без отправки hidden values; `sites`
      работает через permission-scoped Studio host → typed CLI → Core,
      project file/certificate catalogs — через безопасный host index после
      проверки live manifest. Typed peer/capability pickers используют новый
      `service.peer.catalog.read`: target выбирается только из Project, а
      вызываемые методы — из `peerContracts[].methods` безопасной проекции
      Core-backed live manifest, не из manifest capabilities. Add для
      protected arrays и Core apply ещё не реализованы. Пакет
      проходит source tests, manifest validation и Installer acceptance во
      временном каталоге.
      Studio package `0.3.17` с SHA-256
      `9d47cee3db16b83b2d3ee5954fc496a91b2cacc9a12b3b5c238897bbfb7df3f8`
      установлен и trusted в GUI; версия `0.3.16` осталась зарегистрированной.
      Исправленный `0.3.18` собран и прошёл package tests/Installer inspection;
      SHA-256 `3caddab316c03a77fd2627338750298e1b5d29228f55a3fbbd821ed242c42a50`.
      Пользователь подтвердил trust, `0.3.18` установлен; фактическая попытка
      добавить endpoint всё ещё завершалась без изменения общего draft.
      `0.3.19` выявил ожидание host acknowledgement, но не возвращал Promise из
      `publishRouteMutation()` и поэтому не считается исправлением и не должен
      устанавливаться. В `0.3.20` callback Promise возвращается для insert,
      remove, swap и field patches; regressions проверяют отказ host, сохранение
      формы с видимой ошибкой и ожидание отложенного успешного acknowledgement.
      Пакет прошёл 37/37 source tests и Studio Installer inspection; SHA-256
      `642b496f0de3b71bc6d0655a5815a8d43f27758bc12e9a32e967060d2312381b`.
      `0.3.20` superseded до установки: picker предлагал manifest capability,
      а не вызываемый Wool method. В `0.3.21` host возвращает только методы из
      `peerContracts[].methods`, UI показывает «Метод сервиса»; тест fixture
      подтверждает, что `echo.api` не попадает в picker, а `echo.handle` попадает.
      `make package` прошёл 37/37 source tests и Studio Installer inspection;
      digest `f9b20489c2b1f0fad3f02c2e6410925ea803e97560828dd6266d42d004ea7ade`.
      Пользователь подтвердил trust/install exact digest; фактическая вкладка
      Studio показывает route `/studio-plugin-assets/liapoldus.server-editor/0.3.21/…`.
      Настоящий Wails UI показывает live method `echo.handle` после задержки
      около 10 s; picker больше не остаётся бесконечно в loading. Добавление
      `GET /echo` в .21 закрывало форму без изменения draft. Studio host получил
      guard на revision/точный массив, но это лишь предотвращает ложный success.
      Пакет .22 установлен через Studio после подтверждения exact digest
      `11f6bf0d1bf4060ad352cbe0f2c2828543477ffd51bc45cf900411bf3e5c60f7`;
      повторный submit также не изменил draft, а host показывал общий
      `bridge.invalid_patch`. Добавлена типизированная диагностика
      `bridge.schema_mismatch`/`bridge.schema_unverified` с regression test.
      В .22 обнаружена ошибка: read-back reload стирал отказ и сбрасывал форму.
      .24 сохраняет введённую форму и диагностику после reload. UI retest с
      Host typed diagnostics раскрыл причину: plugin classifier считал
      `additionalProperties: true` редактируемым, host считал его protected и
      отклонял полную замену `config.routes`. Исправление .25 выравнивает
      классификацию и сохраняет typed insert; package acceptance прошла (37/37),
      digest `35b11810c1ea00b919752059646a17866578eee729ce7a610c5d1b5220b6313a`.
      2026-10-15: последующий .27 добавляет sparse indexed edits для полей
      response items и typed insert/remove для защищённого массива responses.
      Package source tests прошли 41/41, Studio Installer acceptance прошла;
      digest `191effbc05457a04ce5bd74c9878c9aed9d8be2326a2478bf9d950af4a2d5c3d`.
      Пользователь подтвердил digest, и 0.3.27 установлена/активна в GUI.
      Попытка повторной `make package` безопасно отказалась перезаписывать уже
      существующий artifact после успешных тестов. Native UI acceptance и проверка,
      что canonical Project draft сохраняет endpoint edits, остаются открытыми;
      Project-файлы вручную не менялись. Не размещать
      расширение в `services/server/`; frozen snapshots
      `services/captcha/` и `services/identity/` не менять.
- [x] `.studio-plugin` package `liapoldus.server-editor@0.3.8` собран и
      проверен Studio Installer в `plugins/studio-server/`; его SHA-256
      `6a0d0d126f67a468d9ea7befde87d9e906cad5ef2a06a935cbd529b31115f035`.
      UI descriptor read имеет отдельный declared + granted
      `service.configuration-ui.read`; grant `service.settings.read` не даёт
      доступ к этому intent.
      Studio теперь показывает безопасный manifest
      preview, digest, signature presence, permissions и поверхности; explicit
      trust требует общего grant всех объявленных permissions и audit reason.
      Backend повторно snapshot-ит пакет, сверяет SHA-256 с preview до install,
      а UI умеет открыть поверхности и удалить версию с вводом точного ID.
      Native GUI trust-flow ещё не подтверждался реальной установкой пакета.
- [x] Исходники Server StudioPlugin находятся только в workspace
      `plugins/studio-server/`, а не в `studio/plugins/` или `services/server/`.
      Пакет `liapoldus.server-editor@0.3.16` включает bounded resource,
      service-instance и capability pickers, SDK-driven group/order rendering,
      исправление первого render и regression на полный handshake. `make package`
      проходит source tests, manifest validation и временный Installer
      acceptance. Не считать эту проверку установкой/trust в GUI.
- [x] Server StudioPlugin `0.3.30` потребляет Core-backed Admin Surface,
      показывает typed artifact-input action, выбирает архив только из Project
      через native picker и отправляет ограниченный publish intent host bridge.
      Source: 47/47 тестов и manifest validation проходят; пакет собран с SHA-256
      `8de6fbdf1364493390d433ff6fa2da4bd395411293d4dd728e289c2af139c405`.
      Пакет установлен и доверен в Studio после explicit approval exact digest;
      UI загрузился и host bridge сообщил `bridge_ready`. Проверка publish через
      Admin Surface пока не завершена: локальный Core/runtime был остановлен,
      поэтому action вернул «Управление сервисом недоступно через Core».
- [~] Artifact publish vertical slice появился в CLI, Studio host и Server
  StudioPlugin: CLI получает
  live Admin Surface и его digest через Core, проверяет объявленные action/MIME/
  byte limits и потоково передаёт multipart через Core Management API; Studio
  предоставляет reviewed `service.resource.publish` intent, ограничивает оба
  входных файла Project file index и отклоняет sensitive metadata keys. CLI и
  Studio owner gates проходят. UI action создан и package установлен. Studio
  перед native confirmation теперь создаёт приватную read-only копию artifact,
  показывает basename/size/SHA-256 и передаёт CLI именно подтверждённые bytes;
  regression меняет исходный Project file во время confirmation и доказывает,
  что CLI получает неизменный snapshot. Durable Project resource
  reference/digest и сквозной UI/Core/service acceptance остаются открытыми. Studio
  host предоставляет bounded `service.admin-surface.read` через typed CLI → Core.
  Targeted owner tests were re-run against the current dirty worktrees:
  Core `service-artifact-forwarding.test.ts` 1/1, Service SDK
  `artifact-stream.test.ts` 2/2, CLI typed publish test, and Studio native-host
  publication/denial tests all pass. These prove the isolated owner boundaries,
  not the missing UI → CLI → Core → live Server action acceptance. Core
  restart-required settings flow тоже не реализован.
- [x] Native artifact picker для `service.resource.publish` теперь может
  импортировать выбранный `.tar.gz`/`.tgz` из внешней папки в canonical
  `resources/` Project. Копия bounded до 128 MiB, symlink отвергается, имя
  content-addressed и повторный импорт идемпотентен; file index обновляется до
  возврата управления StudioPlugin. Backend regression и production frontend
  build проходят. Это закрывает выбор внешнего artifact, но не заменяет
  проверку содержимого archive и не доказывает Core/runtime publish acceptance.
- [x] Runtime Inspector теперь отправляет typed per-service `runtime start|stop|
  restart --service <id>` через CLI. CLI проверяет точное имя контейнера в
  runtime label выбранного target и запрещает обращаться к Core как к обычному
  сервису; без `--service` остаётся stack-level операция. Проверены CLI Docker
  argv, отказы для незарегистрированного имени/Core и Studio/Wails contract.
  `runtime.status` теперь инспектирует каждый container и возвращает его
  фактические `state`/`health`; Studio Output показывает bounded summary вместо
  одних имён или сырого inspect payload. CLI и Studio regression tests покрывают
  смешанные `running`/`exited` состояния и отсутствие утечки полей inspect.
  `GOWORK=off GOFLAGS=-p=1 make check` прошёл в CLI и Studio; Studio frontend —
  91/91 тестов; `make desktop-build` собрал macOS/arm64 app. CLI установлен в
  настроенный Studio путь `/Users/docup/go/bin/liapoldus` из текущего исходника.
- [x] Через Studio per-service Stop остановил только Echo; `docker ps -a`
  подтвердил `liapoldus-echo Exited`, тогда как Server и Core оставались `Up`.
  Обычный `GET /echo?text=echo-unavailable-check` через Server вернул HTTP 503.
  Через Studio per-service Start контейнер Echo восстановлен; после Core-backed
  Studio status (`ready:true`, generation `15`) обычный curl `GET
  /echo?text=echo-recovered-second-check` вернул HTTP 200 и ожидаемый response.
  Studio → Canvas → Echo → Logs показывает точный query text в stdout.
  Дополнительно проверены missing query (HTTP 400), empty query (HTTP 200) и
  непустой query (HTTP 200). Студия не обращалась к Service SDK REST напрямую.
- [x] 2026-10-15: через Canvas выбран Echo, подтверждена Project binding
  `1.2.1 · linux/arm64` с digest `65143cb9c15bad0a72d4104a4fbe062cd51db4c857c384e4b6678bce26340ecf`,
  выполнен typed per-service Restart. Core-backed Canvas показал `ready`, а
  обычный curl `GET /echo?text=approved-echo-1.2.1` вернул HTTP 200 и
  `echo: approved-echo-1.2.1`; Logs подтвердили этот текст в stdout Echo.
  Проверка не редактировала canonical Project и не перезапускала Core/Server.
- [~] Частичный UI acceptance Server StudioPlugin завершён на активном Project
      `server-echo-studio`: в Studio surface 0.3.27 изменён дублирующий response
      status 201 на 202, draft сохранён через интерфейс, canonical
      `services/server/settings.json` содержит уникальные 200/201/202. Core
      применил generation 20 и вернул Server `ready:true`, без pending
      generation. Обычный `curl` GET `/echo?text=studio-ui-corrected-status`
      вернул `echo: studio-ui-corrected-status` / HTTP 200; запрос без
      обязательного `text` вернул HTTP 400; typed `liapoldus runtime logs`
      подтвердил точный query в stdout Echo. Связь использует `echo.handle` из
      live manifest; CLI не обращается к Service SDK REST. При этом Add Response
      defect 0.3.27 остаётся: он предлагает уже занятый status 201. Исправление
      0.3.29 собрано и прошло 44/44 теста и Installer acceptance, но не
      установлено без явного одобрения exact digest. Также
      остаются hostile real-WebView bridge corpus, resource
  import/reference/publish и Core restart-required settings flow, coordinating
  atomic writes with arbitrary external editors, replica effective-state
  diagnostics и cross-platform CI. Конкурирующие Studio processes уже защищены
  per-file OS lock + digest CAS.
- [~] Follow-up 2026-10-15: фактический GET `/echo` вернул `Content-Type:
      text/plain`, но Studio Editor позволил сохранить только content type;
      изменение `responses[].schema` завершалось `bridge.patch_path_rejected`.
      Причина воспроизведена в `configurationPathEditable`: open JSON Schema
      (`additionalProperties: true`) fail-closed блокировалась как произвольный
      объект. Добавлена owner-аннотация `x-studio-json-document: true` для
      Server body/response schema, ограниченный `$studioJSONDocument/v1` draft
      replace с materialize-on-write в Go/TS и regression coverage, что обычные
      open objects по-прежнему отклоняются. 45/45 целевых frontend tests,
      затем полный Studio `make check` (100/100 frontend tests, lint, Go tests,
      vet/build) и Server `go test ./...` + contract generation/check проходят.
      Реальный Server owner schema даёт editable=true для response schema,
      content type и example. Не проверено в живом UI: требуется собрать Server
      binary с новой live schema, обновить
      schema через Studio/Core-backed workflow и повторить save/apply/curl.
- [x] 2026-10-15: host regression расширен на фактический риск Server response
      contract: редактирование `responses[0].contentType` по вложенным `$ref`
      принято в project-scoped draft, а добавление response выполняется typed
      protected-array operation, не заменой всего массива с открытыми JSON
      `schema`/`example`. Проверены безопасное сохранение projection и отсутствие
      `credentialMaterial` в draft. Полный `PATH=<bundled-node>/bin:$PATH
      GOWORK=off GOFLAGS=-p=1 make check` прошёл: 93/93 frontend tests, Go
      lint/tests/vet/build, TypeScript lint и production Vite build. Отдельно
      source-package `0.3.27` прошёл 41/41 тест и Studio Installer acceptance,
      digest `191effbc05457a04ce5bd74c9878c9aed9d8be2326a2478bf9d950af4a2d5c3d`;
      Studio сейчас показывает активный package 0.3.27. UI проверка установила,
      что существующий 200/201 набор ломает Add Response из-за повторного 201;
      source `0.3.29` выбирает первый свободный status и проходит 44/44 теста
      плюс Installer acceptance. Его digest приведён выше; установка ожидает
      отдельного подтверждения. UI/Core apply и curl acceptance с generation
      20 теперь пройдены через Studio 0.3.27; устранение Add Response defect
      остаётся открытым.

### Следующие вертикальные этапы

1. [x] SDK owner-side adversarial/depth/size/variant corpus, exact REST-byte
   parity and stable manifest fixture выполнены в `service-sdk/`. Echo и Server
   descriptors проходят owner-side validation; их live metadata всё ещё нужно
   проверить через работающие Core/CLI operations.
2. [~] Подключены live Core-backed CLI schema и manifest/UI metadata. Schema
   drift блокирует renderer edits/apply; offline Project draft сохраняется, а
   повторная проверка не теряет draft. Проверена status-fenced связь schema,
   manifest и Project artifact по ID/version/digest; Core выдаёт полный active
   replica release set и запрещает mixed release metadata. Studio сверяет
   неизменность набора; перед apply и после runtime lifecycle выполняется revalidation.
   Остались schema migration UX, proactive revalidation, persistent undo history, явная
   группировка нескольких полей, conflict workflow в versioned CLI operation
   contract и полная a11y-проверка. Bounded
   local `$ref`, `oneOf`/discriminator, `allOf` и
   `if/then/else` renderer реализован; неподдерживаемая форма блокирует только
   своё поле, а не весь Inspector. В protected arrays реализованы safe leaf
   edits и bounded host-side move/duplicate/remove; secret/read-only values
   сохраняются из canonical Project и не входят в draft. Protected object
   arrays также поддерживают Add из schema-derived безопасного шаблона;
   добавление закрывается только если required поле нельзя безопасно
   инициализировать/редактировать. Typed resource picker покрывает
   manifest-declared `service-admin` catalogs и безопасные Project
   `file`/`certificate` references. Произвольные/неподдерживаемые JSON Schema
   vocabulary остаются fail-closed. Dynamic `additionalProperties` maps с
   schema-constrained key/value редактируются безопасным draft API.
3. [~] CLI добавил local-only immutable snapshot и typed `dev plan/apply`;
   Inspector после 800 ms без изменений валидирует/сохраняет Project и вызывает
   `dev.apply --wait`; Core operation state transitions приходят в Studio как
   ограниченные `operation.updated` события (ID, target, state). Запуск второго
   CLI-процесса больше не отменяет первый молча; доступна явная отмена процесса
   наблюдения с предупреждением, что уже принятая Core operation может
   продолжиться. Project desired state сохраняется при ошибке; automatic apply
   для этого Project приостанавливается, последующие valid edits можно сохранить
   локально без повторного вызова, а явный Retry очищает pause и повторяет apply.
   Apply intent дополнительно сверяет project ID/root с активным workspace,
   чтобы queued save после workspace switch не применил другой Project. Regression
   с проверкой retry и смены workspace в `serviceSettingsController.test.mts`
   прошёл; полный gate 97/97 frontend tests, TypeScript, lint, bindings,
   Go tests/vet/build. Apply pause persistится в versioned `.studio/workspace.json`;
   прерванный `applying` и malformed marker после открытия восстанавливаются как
   `confirmation-required`, automatic apply остаётся paused до явного Retry.
   Studio now serializes applies within one controller instance and coalesces
   edits received while an apply is in flight; a dedicated regression covers
   that path. CLI now has a durable per-target lock/journal and Core-backed
   idempotency recovery lookup, so a new Studio/CLI process waits for previously
   accepted operations before applying another draft. Core durable configuration
   observations are now bound to the exact service incarnation; `/status` returns
   per-replica desired/applied generation and convergence state, and the Studio
   inspector displays partial apply. Core operation polling now includes safe
   per-replica rollout outcomes, and the CLI Output panel renders validated
   pending/applied/failed replica results without endpoint or incarnation data.
   Still open: full UI process crash acceptance, queued snapshot recovery, typed
   cancellation of an accepted Core operation and rollback semantics.
4. Завершить security/GUI acceptance минимального
   `studio-service-editor/v1` bridge; typed endpoint editor уже находится в
   `plugins/studio-server/` и редактирует `server-http/v1` через общий draft.
   Trust/install UX реализован; `service-admin`, Project files и public
   certificate resource catalogs и typed service/capability pickers подключены
   через permission-scoped host API. Browser-level hostile interaction tests,
   GUI trust-flow и полная acceptance специализированной editor tab остаются
   открытыми.
   Server endpoint ordering и advisory listener coverage diagnostics
   реализованы в `plugins/studio-server/`; Echo-owned schema и peer handler
   остаются независимыми.
5. Core settings/resources/restart workflow, миграции, strict security review,
   полный UI-driven Docker/curl acceptance и cross-platform gates.

Открыто: owner GitHub repo для Echo пока не доступен; новый Studio feature
contract не опубликован; migration changes локальны. Фокусная проверка границ
номенклатуры прошла: Service SDK module identity (1 test), Wool module/boundary
contracts (17 tests), CLI отсутствие direct Service SDK REST (Go test) и Core
отказ от прежних `/api/plugins` routes (Go test) прошли. Core child-process
integration `service-live-metadata.test.ts` также прошёл: Core зарегистрировал
replica и сам запросил manifest, schema, identity и readiness по mTLS SDK REST,
а Management API вернул Core-backed ответы. Это не заменяет полные owner suites,
интеграционную сборку, публикацию и обновление docs pins. Не считать
межрепозиторную публикацию завершённой и не менять docs pins на unpublished
content.

### Runtime safety follow-up — 2026-10-15

- [x] StudioPlugin settings patch/save revalidate the captured Project + service
  context after asynchronous draft loading and again before queued local draft
  persistence. A stale iframe request now fails with `bridge.context_changed`
  instead of mutating another active Project. Regression is covered; the full
  `GOWORK=off GOFLAGS=-p=1 make check` passed (113 frontend tests, bindings,
  lint, Go tests/vet/build).
- [~] Stack-level Stop в Studio показывает accessible RU/EN alert dialog с
  текущим target и перечисляет ephemeral containers/staging, которые будут
  удалены, отдельно подтверждая сохранность Project, Core DB, credentials и
  исходных бинарников. Текст и bilingual fields покрыты frontend regression;
  полный `GOWORK=off GOFLAGS=-p=1 make check` прошёл (112 frontend tests,
  bindings, lint, Go tests/vet/build). Native click-through и Docker stop/start
  acceptance не выполнялись.
- [x] CLI runtime Start автоматически reconciles только ожидаемые остановленные
  service containers выбранного target (`created`/`exited`/`dead`), поэтому Studio
  не требует ручной уборки старых контейнеров. Core, persistent state и другие
  targets не затрагиваются; активные/неизвестные containers fail closed.
- [ ] Проверить новый reconciliation через Studio UI на текущем Docker target;
  затем пройти runtime status, Server endpoint draft/save и curl acceptance.
- [x] Resource publication больше не читает изменяемый Project artifact после
  нативного подтверждения: Studio создаёт ограниченный приватный snapshot в
  `.studio`, перед подтверждением показывает его SHA-256 и bytes, отправляет
  CLI snapshot, выставляет его read-only и удаляет после CLI завершения.
  Go regression подменяет canonical file в confirmation callback и проверяет,
  что CLI получил ранее reviewed bytes; также проверены digest, лимит и cleanup.
- [x] Установка Server Editor `0.3.30` больше не является открытым gate:
  активная версия заменена подтверждённой `0.3.32` (см. digest ниже). Publish
  acceptance при этом остаётся отдельным открытым пунктом из-за отсутствующего
  Core container и недоступного Admin Surface.
- [x] Server Editor `0.3.32` установлен и trusted в Studio после подтверждения
  точного digest `504c2fbfc47a4a55105bc2c0cd743f75e42befa908f5b53f52cfc3f23e7648cb`.
  В native UI Server видны действия `Добавить HTTP endpoint` и
  `Удалить endpoint из черновика` на существующем `/echo`. Проверен возврат
  controls, но не mutation/save: live Core schema недоступна, кнопка сохранения
  Project disabled, runtime apply не выполнен.
- [~] Server Editor `0.3.32` объединяет fix распознавания `$ref`-схемы Server
  из `0.3.31` с fail-closed проверкой, чтобы Server Editor не редактировал Echo
  или другой сервис под видом Server. Package source tests 49/49 и Studio
  Installer acceptance прошли; source suite 51/51 добавляет и удаляет endpoint
  через DOM UI на реальных schema/settings активного Server Project. SHA-256
  `504c2fbfc47a4a55105bc2c0cd743f75e42befa908f5b53f52cfc3f23e7648cb`.
  Native add/remove mutation acceptance и runtime apply остаются открытыми.
  2026-10-15 повторно проверено через открытый Studio UI: Project
  `Server Echo Studio`, CLI `/private/tmp/liapoldus-cli-auto-core-update`,
  target `local`; runtime status вернул `liapoldus-core`, `liapoldus-echo` и
  `liapoldus-server` как `running`. Read via Core для Echo успешно вернул
  identity/readiness (`ready: true`, generation `23`), live manifest с
  `configurationUI` и JSON Schema; Canvas generic inspector отобразил шесть
  Echo settings из схемы. Это подтверждает реальный Studio → typed CLI → Core
  metadata read path. Изначально Canvas оставлял readiness `unknown`, поскольку
  parser требовал полный replica envelope для health badge. Добавлен отдельный
  fail-closed parser SDK readiness, не выдающий artifact provenance или
  configuration convergence за доказанные; после rebuild Canvas показывает
  Server/Echo `готов`, Inspector — Echo `ready`, но отдельно сообщает, что
  replica configuration status недоступен. Manifest в Inspector остаётся
  `unknown`: текущий Core status response для live metadata содержит `identity`
  + `readiness`, но не ожидаемый Studio envelope с replica artifact/configuration
  provenance, поэтому строгий `parseServiceRuntimeStatus` остаётся fail-closed.
  Project настройки не менялись. Server Editor add/remove,
  Core apply, endpoint curl и устранение расхождения status contract остаются
  открытыми. Core update не выполнен: Studio file picker предъявил только
  кандидат SHA-256
  `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`, отличный
  от подтверждённого Core digest.
  Regression: focused frontend model suite — 19/19; затронутые Go packages и
  targeted golangci-lint — PASS. Полный `PATH=<Node 20> GOWORK=off
  GOFLAGS=-p=1 make check` прошёл: production frontend build, bindings
  reproducibility, lint (0 issues), Go tests/vet/build и 122 frontend tests.
  `make desktop-build` также прошёл packaging, bindings и полный lint; native UI
  после перезапуска подтвердила `ready` без подмены отсутствующего provenance.
- [x] Устранён скрытый side effect при редактировании Server endpoint:
  `bridge.provenance_mismatch` больше не запускает `core.start` в попытке
  «синхронизировать» binary. Такой restart не менял configured Core digest и
  не мог исправить расхождение. Regression подтверждает отказ без вызова
  `core.start`; targeted frontend suite — 30/30, ESLint и production frontend
  build прошли. Desktop app пересобран и открыт на Project `Server Echo Studio`.
  Через Studio UI выбран Echo `1.2.1` / `echo.handle`, введён временный
  `/draft-test`; add в общий draft корректно отклонён с
  `bridge.provenance_mismatch`, форма осталась доступна для исправления,
  существующий `/echo` не изменился. Вкладка Output показала `0 событий CLI`,
  подтверждая отсутствие неявного Core start. Состояние Studio после возврата
  показывает только исходный `/echo`; Project не сохранялся. Core/runtime не
  перезапускались.
  Следующий prerequisite для разрешённого endpoint draft/save/apply — привести
  Core live replica provenance в соответствие с Project. Найденный Core
  candidate имеет SHA-256
  `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`; он не
  совпадает с digest, ранее одобренным для Core-only update, поэтому заменить
  Core нельзя без отдельного подтверждения именно этого digest. До разрешения
  Core остается нетронутым.

### Historical UI-driven Server endpoint draft/curl recheck — 2026-10-16

- [x] Через Studio на проекте `Server Echo Studio`, CLI `dev`, target `local`
  повторно проверен runtime: `liapoldus-core`, `liapoldus-echo` и
  `liapoldus-server` — `running`. Core-backed read Server вернул artifact
  `server@1.1.5`, digest
  `d1999f5516f5f37156d4ab2b482481db5d0dc8e57869b0aa9c0d42a065c43c9b`,
  `ready: true`, applied generation `31` и readiness schema digest.
- [x] В установленном Server Editor `0.3.32` создан `/studio-draft-probe`
  (`GET`, `echo.handle`) через UI. Host подтвердил `Черновик Studio обновлён`;
  затем маршрут удалён через UI с подтверждением. После повторного открытия
  осталось только исходное `GET /echo`, Project не сохранялся, runtime/Core
  lifecycle не запускался.
- [x] Проверен текущий endpoint обычным curl:
  `GET http://127.0.0.1:19080/echo?text=studio-accepted-endpoint-check`
  вернул HTTP 200 и `echo: studio-accepted-endpoint-check`. CLI Logs, открытые
  из Studio, содержат `echo query received` с тем же `text`.
- [~] Тогда Save/apply не прошёл в старом Server Editor `.32`; его сообщение
  `Управление сервисом недоступно через Core` и блокировка Core digest
  `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`
  исторические и superseded последующими одобрением Core update и live
  generation-56 acceptance. Новый `.44` Add/Delete draft smoke прошёл без
  `bridge.patch_not_applied`, но Save/apply для добавленного route ещё отдельно
  не подтверждён: после удаления baseline стала чистой и кнопка Save disabled.
- [~] UI recheck 2026-10-16 на установленном Server Editor `0.3.34` показал
  transient peer-catalog race: при первом render `echo.handle` помечается как
  отсутствующий, следующий render показывает live `1.1.0`. В локальном
  исходнике `0.3.36` loading state отделён от confirmed missing; host также
  передаёт в iframe только bounded CLI failure code для Admin Surface, без
  произвольного CLI message, чтобы различать CLI/Core failure и permission
  denial. Пакет 0.3.35 оказался устаревшим и не содержит второго исправления.
  Исправленный пакет 0.3.36 с SHA-256
  `4e220a586547c64947e4ba44def465c1585f914635156bc3e28264e3977fc13a`
  прошёл source suite 55/55 и Studio installer acceptance. Он не установлен;
  в пользовательской Studio активен 0.3.34. Точный Core/CLI error code
  подтвердить после установки 0.3.36 и повторного открытия Server Editor.

- [x] Свежий Studio UI acceptance: установленный Server Editor `0.3.34` уже
  совпадает с одобренным SHA-256
  `2f95fb9e55a35801060b57d56a906c84d6adddec2dd4a796a41ea0a2af2e3fc4` —
  повторная установка не требовалась. В Project `Server Echo Studio`, target
  `local`, Core-backed Server status подтвердил `server@1.1.5`, совпадающий
  Project digest, `ready: true` и applied generation `33`. Через native
  Server editor добавлен временный `GET /studio-draft-check-20261016` с
  `echo.handle · 1.1.0`; host подтвердил изменение общего draft. Маршрут удалён
  из draft, editor закрыт и открыт снова: остался только исходный `GET /echo`,
  Project-save disabled, сохранения не было. Containers/Core не менялись.
  Admin Surface по-прежнему показывает «Управление сервисом недоступно через
  Core»; save/apply и curl после изменения не проверялись. Core candidate
  `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`
  ожидает отдельного подтверждения для Core-only update.

### Фактическое продолжение UI acceptance — 2026-10-16

- Studio открыта на Project `Server Echo Studio`; UI показывает `CLI ok`, branch
  `main`. Canvas содержит `server@1.1.5`, `echo@1.2.1`, связь `echo.handle`;
  readiness обоих — `ready`.
- Установленный/trusted Server Editor `0.3.36` фактически открылся после выбора
  Server на Canvas. UI показывает единственный исходный `GET /echo`, query
  `text` и response contracts. Настройки Server содержат поле с сообщением о
  неподдерживаемой форме данных; не менять его этим сценарием.
- Server Editor продолжает показывать точную ошибку
  `bridge.admin_surface_response_invalid`. В CLI source исправлен Core digest
  boundary: `sha256:<hex>` нормализуется перед typed response, чтобы исключить
  двойной префикс. Адресные тесты
  `go test ./internal/infrastructure/coreapi ./internal/presentation/cli`
  прошли. CLI-кандидат `/tmp/liapoldus-cli-admin-surface.mGgwuw/liapoldus`,
  SHA-256 `8108f74f775681f7c218875ca8cd015167b354623e07e52e1e2df80c827bb20b`,
  не выбран и не запускался; активный CLI в Studio не изменён.
- В endpoint form выбран target `echo`, но live peer method остался disabled.
  Временная форма отменена; Project не сохранялся и после отмены показывает
  только исходный `/echo`. Core, Docker containers, credentials и target не
  менялись. Последний подтверждённый runtime status — Core/Server/Echo running;
  последний curl `/echo?text=studio-runtime-recheck` вернул HTTP 200, и Echo
  logs содержат этот текст.
- Следующие шаги: добавить точечный CLI JSON-shape regression, локализовать
  переход peer method catalog в `ready`, исправить и прогнать только связанные
  тесты. Новый CLI не активировать в обход Studio trust gate; текущий runtime не
  останавливать.

### Фактическое продолжение UI acceptance — 2026-10-16, обновление

- Исправление выше: в форме нового endpoint live method catalog загрузился; UI
  предложил `echo.handle · 1.1.0`. Через Server Editor создан только временный
  `GET /echo-draft-check` в общем draft и затем удалён из draft. После удаления
  в UI остался единственный исходный `GET /echo` с `text` query contract.
  Project Save не выполнялся.
- Обычный `curl http://127.0.0.1:19080/echo?text=studio-final-check` вернул
  `HTTP/1.1 200 OK`, `Content-Type: text/plain`, тело
  `echo: studio-final-check`. Read-only `docker ps` подтвердил работающие
  `liapoldus-core`, `liapoldus-echo`, `liapoldus-server`; контейнеры и target
  не менялись. Studio Output показывает Echo stdout с предыдущими acceptance
  query values и событие runtime `run.completed`.
- Блокер сохранения/управления сервисом остаётся конкретным:
  `bridge.admin_surface_response_invalid`. В Studio видны Core/CLI runtime
  результаты, но редактор не получает валидный typed Admin Surface response.
  Корневая причина в CLI source адресно исправлена нормализацией Core surface
  digest; регрессионный тест требует ровно один `sha256:` prefix. Целевые Go
  tests `./internal/infrastructure/coreapi` и `./internal/presentation/cli`
  проходят.
- Для снятия блокера требуется выбрать и запустить через Studio новый CLI
  binary `/tmp/liapoldus-cli-admin-surface.mGgwuw/liapoldus` (macOS/arm64,
  SHA-256 `8108f74f775681f7c218875ca8cd015167b354623e07e52e1e2df80c827bb20b`).
  Он не активирован: до прохождения Studio trust gate использовать его нельзя.
  Не заменять его случайным бинарником и не перезапускать Docker/Core. После
  trust/установки повторить тот же UI Add/Delete draft, Save и curl acceptance.
- [x] Исправлен также видимый конфигураторный дефект Server Editor: schema
  renderer теперь разыменовывает bounded local `$ref` во вложенном `array.items`.
  Regression подтвердил редактируемое поле `hostnames`. Пакет `0.3.38`, SHA-256
  `d1680bcb6495d901365d88d79f845fb0fb9993977bf75be9ac50011ad0a291bc`, прошёл
  56/56 package tests и Studio installer acceptance; в Studio пока не установлен.
- [x] Дополнительный read-only Service SDK smoke: через внешний `curl`
  `127.0.0.1:19081/healthz` вернул `200 {"status":"ok"}`, а `/metrics` — 200,
  `liapoldus_service_ready 1`, пять applied reloads и ноль config pull failures.
  Это подтверждает Server SDK endpoints; независимый Echo health пока не
  подтверждён отдельным запросом.
- [x] Admin Surface response validation разделяет bounded response/identity
  validation и отдельную `bridge.admin_surface_digest_invalid` диагностику.
  Это различает malformed response и неверный SHA-256 prefix старого CLI без
  ослабления контракта. Regression на digest/identity; service settings suite
  — 31/31, TypeScript typecheck, targeted ESLint и Vite production build прошли.
  Изменение пока не загружено в уже запущенный desktop process.
- [x] Read-only Runtime UI в Studio выполнил `Status` через CLI/Core отдельно
  для Echo и Server: оба `ready: true`, generation `44`; Echo `1.2.1`, Server
  `1.1.5`, совпадающие с их текущими Project artifact bindings. Container
  lifecycle не запускался.

### Фактическая сверка Runtime и Server Editor — 2026-10-16

- Через UI Studio подтверждены Project `Server Echo Studio`, `CLI ok`,
  активный Server Editor `0.3.36`, Project bindings Echo `1.2.1` и Server
  `1.1.5`. В Artifacts UI их digest prefixes совпадают с ранее подтверждёнными
  binaries: Echo `e492a665232fd…`, Server `d1999f5516f5f…`.
- Runtime `Status` через Studio показывал `liapoldus-core: running`,
  `liapoldus-echo: exited`, `liapoldus-server: exited` (target `local`). Один
  ранее разрешённый Start через Studio завершился ошибкой регистрации:
  `Core registration for echo: POST /api/services/echo/replicas/register:
  context deadline exceeded`; startup output обоих сервисов сообщил
  `service SDK replica lease expired`. Повторный typed status подтвердил, что
  остался только Core running; сервисы exited.
- Core logs, открытые в Studio, содержат повторяющиеся записи
  `Core service metadata read failed: instance="echo" phase="resolve" reason="service unavailable"`
  (аналогично для Server). Это подтверждает отсутствие зарегистрированных
  replicas, но не раскрывает первопричину registration timeout.
- Обычный `curl http://127.0.0.1:19080/echo?text=studio-smoke` завершился
  connection refused; endpoint delivery и service logs не подтверждены.
- Server Editor по-прежнему показывает draft `GET /echo`, query `text` типа
  string, target Echo `1.2.1`, method `echo.handle · 1.1.0`; есть отдельные Add
  и Remove-from-draft controls. Сохранение в Project отключено. Peer method
  catalog остаётся в состоянии loading, справа показано
  `bridge.admin_surface_unavailable`.
- Следующий актуальный CLI digest-fix candidate —
  `/tmp/liapoldus-cli-operation-safe.42SCNz/liapoldus`, SHA-256
  `30421a6e30640ef089322d4a1878c28b7edda8fda8967968148b12e5a63be10b`; он
  не выбран/не запущен через Studio. UI подтверждает только `CLI ok`, без
  отображения пути или digest выбранного executable.
- Безопасное изменение draft не выполнено: embedded Server UI AX дерево
  показывает два одинаковых набора controls, поэтому Add endpoint неоднозначен;
  UI отклонил попытку до действия. Project files не менялись.
- Не повторять Start до выяснения Core replica-registration timeout. Не менять
  Core DB, credentials, certificates или artifacts автоматически. Следующий
  технический шаг — через Studio использовать актуальный digest-fix CLI после
  trust gate, восстановить Core-backed live peer/admin-surface metadata, затем
  выполнить UI-only Add/Delete draft, save/apply и curl/log acceptance.

### Checkpoint автономного продолжения — 2026-10-16

- Desktop Studio перезапущена после сборки; проект `Server Echo Studio`
  восстановился, активна вкладка Server. Через UI подтверждены `CLI ok`, один
  исходный `GET /echo`, query `text`, Echo method `echo.handle · 1.1.0` и
  текущая ошибка `bridge.admin_surface_digest_invalid`.
- Server Editor `0.3.36` всё ещё активен. В его settings renderer массив
  `listeners[].hostnames` показывает `Схема элемента списка недоступна`.
  Исправление bounded local `$ref` в `plugins/studio-server` собрано как
  `0.3.38`, SHA-256
  `d1680bcb6495d901365d88d79f845fb0fb9993977bf75be9ac50011ad0a291bc`;
  56/56 package tests и installer acceptance прошли. Импорт остановлен на
  Studio trust dialog и отменён: пакет не установлен, trust не выдан.
- CLI source candidate для Admin Surface digest normalization:
  `/tmp/liapoldus-cli-admin-surface.mGgwuw/liapoldus`, SHA-256
  `8108f74f775681f7c218875ca8cd015167b354623e07e52e1e2df80c827bb20b`.
  Точечные Core API/CLI tests проходят; бинарник не выбран/не запущен, поскольку
  Studio требует свой trust gate. Старый CLI и выбранный target не менялись.
- Зафиксирована политика непрерывности в workspace/Studio/plugin AGENTS и
  `studio/plan.md`: обычные связанные шаги выполнять без повторных общих
  вопросов; когда platform требует подтверждение exact установки/запуска,
  остановиться только на этом action-time gate, не обходя его. Существующая
  цель остаётся active; runtime, Core DB, credentials, certificates и Project
  не изменялись.
- Следующее действие: продолжить с конкретным Studio trust gate для package
  `0.3.38`, затем проверить видимый `$ref` renderer. Для устранения
  `bridge.admin_surface_digest_invalid` отдельно потребуется trust gate точного
  CLI digest выше; после активации повторить UI Admin Surface и тот же draft/save
  acceptance. Полный VitePress build и общие unit suites не повторять без
  относящегося к ним изменения.

### CLI partial-outcome contract follow-up — 2026-10-16

- CLI теперь строго валидирует Core Apply/Operation response и передаёт Studio
  только typed IDs/state/replica outcomes; при degraded apply partial outcomes
  не теряются и recovery остаётся paused. CLI full check/race gates и Studio
  consumer model suite 19/19 прошли.
- Новый актуальный macOS/arm64 CLI candidate, включающий также digest fix для
  Admin Surface: `/tmp/liapoldus-cli-operation-safe.42SCNz/liapoldus`, SHA-256
  `30421a6e30640ef089322d4a1878c28b7edda8fda8967968148b12e5a63be10b`.
  Он не выбран/не запущен через Studio; кандидат `8108f74f...` устарел для
  следующей проверки. Project, Core, target и containers не менялись.

### UI-driven Server 1.1.6 artifact replacement audit — 2026-10-16

- Пользователь явно подтвердил trust и запуск Server 1.1.6 в Docker target
  `local`, digest `efe16ac1343a03935ec797cfa968c7382e237521db6a6d817f134b408564f494`.
  Через Studio digest был trusted, Project binding изменён на Server 1.1.6;
  Runtime Plan подтверждает одновременно trusted Echo 1.2.1 и Server 1.1.6 с
  этим exact digest.
- Core-backed Runtime Status по-прежнему возвращает Server 1.1.5 и digest
  `d1999f5516f5f37156d4ab2b482481db5d0dc8e57869b0aa9c0d42a065c43c9b`.
  Graph version `1.1.6` отражает Project binding, не live Core replica.
- `runtime.restart --service server` перезапустил существующий container, но
  не заменил его binary. `runtime.stop --service server` через Studio штатно
  остановил только Server. Его `runtime.start --service server` запустил
  существующий container; итоговая Status-сводка через Studio показала Core,
  Echo и Server running. Core и Echo не перезапускались.
- Runtime Plan безопасен и правильный, но CLI `runtime start --service`
  реализован как Docker `StartContainer` существующего имени; global `runtime
  start` планирует все services и блокируется, когда Echo уже работает. Значит,
  текущий typed contract не умеет заменить ровно один остановленный service
  container новым pinned artifact и синхронизировать Core registration/config.
  Не обходить это прямым Docker CLI и не объявлять Server 1.1.6 запущенным.
- Curl после восстановления вернул HTTP 200 и
  `echo: studio-server-1.1.6-check`; это доказывает доступность старого маршрута,
  но не версию Server. Echo logs из Studio содержат предыдущие query entries;
  новый correlation text там не появился, поэтому log acceptance тоже не
  подтверждён.
- Endpoint draft не менялся: Core still reports artifact 1.1.5, live schema
  отсутствует, а UI fail-closed блокирует Server editor mutation по provenance.
- Следующий implementation step: добавить в CLI/Studio typed single-service
  artifact reconciliation с явной проверкой остановленного target-owned
  container, digest/trust/platform, атомарной заменой с recoverable failure,
  Core registration и exact-generation readiness; покрыть fake-Docker/Core tests.
  После сборки candidate требуется обязательный Studio trust gate для нового
  CLI binary. Затем повторить только Server replacement, Core Status, endpoint
  Add/Delete draft, curl и Echo logs; не повторять VitePress/общие unit suites.
# Service-bound StudioPlugin editors — implementation checkpoint — 2026-10-17

- SDK now validates and canonicalizes `service-editor-buttons/v1`; Server
  declares stable `server.endpoints`. Core and typed CLI continue relaying the
  descriptor as JSON metadata.
- Studio surfaces distinguish `workspace` and `service`; service pages are
  excluded from rail navigation. Global SQLite mappings connect service button
  IDs to installed plugin pages. Inspector renders only mapped buttons whose
  plugin surface is installed and opens the exact service context.
- Remaining acceptance: owner checks, package `.50`, complete Studio checks,
  macOS WebView handshake, package trust confirmation and integrated commit/push.

### Recovery copy before Server settings migration — 2026-10-18

- Studio exposes `service.settings.recovery.copy` through the typed
  `studio-service-editor/v2` bridge. It is gated by `service.settings.write`,
  the open Project/service context, and the exact reviewed SHA-256 of the
  canonical settings file. The host writes an idempotent mode-0600 backup and
  returns only a safe relative path and digest; the plugin never reads or
  chooses a filesystem path.
- Server Editor migration refuses to patch settings unless this exact-byte
  backup succeeds. The preview identifies the response template it will add
  for a migrated legacy route and clearly says the legacy route did not declare
  a response contract. Unknown/unrepresentable fields still block migration.
- `make check` passed on 2026-10-18: 179 frontend tests, all Go package tests,
  lint, TypeScript checks, `go vet`, and `go build`. `make desktop-build`
  passed including two-run Wails binding reproducibility and lint. Server
  Editor `make package PACKAGE=/tmp/liapoldus.server-editor-0.3.60.review.studio-plugin`
  passed 74/74 tests and Studio installer inspection.
- Artifacts awaiting native Studio trust/launch confirmation before local
  WebView acceptance: macOS/arm64 Studio executable SHA-256
  `6b844d41870d6e55d88c350baf0f8fd09b088e58361beae80631603ba324121e`; Server
  Editor `.60` SHA-256
  `c38b138312f5a0bc792a6e7eb26cb23ad36292fce127dd2cf0ccabcea22fb4b1`;
  requested plugin permissions are settings.read/write,
  configuration-ui.read, resources.read/publish, peer.catalog.read, and
  secrets.read. No new package has been installed or trusted in this checkpoint.
- Secret workflow source tests cover redaction, references and the guarded
  rotation flow, but live create/rotate/apply/retire, multi-replica ACK,
  timeout/restart recovery, and Server Editor WebView acceptance remain open.
- Server Editor `.61` adds an HTTPS setup assistant using the existing typed
  settings bridge: automatic TLS, optional explicit HTTP→HTTPS listener,
  automatic-TLS hostname reuse, bind-conflict checks, and opt-in HTTP/3. It does
  not change runtime until Project settings are saved and applied. Package
  validation, all 82 editor tests, and Studio installer inspection pass. Exact
  package SHA-256:
  `f8a31ecfb01f796cc9c2267ada0075d08c7870c9f293dab9318d9dbd51be05cf`.
  Installation and macOS WebView verification remain gated by Studio's native
  trust confirmation for this digest. Plugin source is outside Git and has no
  remote, so only this Studio-owned acceptance record can be pushed.


### Server Editor binding and config apply — 2026-10-17

- Studio now keeps global plugin install/version control in Settings, defaults to the latest installed package, and exposes service-editor bindings there. Inspector renders the assigned Server button, which opens the exact service context. The real UI was verified on `Server Echo Studio` / `local` with plugin `.50`; binding candidate `server.endpoints` opened the editor tab and the bridge reached `bridge_ready`.
- Fixed redaction of public SDK button keys and project-vs-Core configuration digest comparison. Studio `make check` and `make desktop-build` pass. New macOS/arm64 app SHA-256 `c6d67d38ec90045aea05f00091cb6f13a01da43173203d19fc0737fb33ed6456` is pending the exact local launch gate; plugin `.52` SHA-256 `de0161f0fa6c65159799f03634caa23dbc8a44e14e8b91a81d628e9292b2ff91` is pending install/trust confirmation. Commit/push remain pending.

### Typed Server Admin Surface tables and actions — 2026-10-18

- Studio host exposes `service.admin.table.query` and
  `service.admin.action.invoke` through `studio-service-editor/v2`. Table rows
  are filtered again against descriptor-declared safe columns. Actions re-read
  the Core-backed descriptor, compare its live digest and exact service/page/
  section/action, stage bounded metadata in a project-local mode-0600 file,
  require native confirmation for dangerous/confirmed actions, and return only
  `{completed:true}` to the iframe.
- CLI intents and planner tests cover local-only table query/action invocation,
  pagination cursor, absolute request-file paths, CAS and idempotency guards.
  Frontend parser/controller tests cover scoped payloads and the bridge handler
  requires declared + granted resource read/publish capabilities.
- Remaining: run full Studio `make check`, `make check-race`, and
  `make desktop-build`; package Server Editor with the updated admin table UI;
  then commit/push Studio and update the docs source pin. Local WebView/package
  install still requires action-time trust approval for the exact digest. No
  live Service action has been invoked by these source tests.

### Server Admin Surface typed tables/actions — 2026-10-18

- Studio bridge v2 now exposes descriptor-declared table queries and actions.
  The iframe includes the exact surface digest; host checks it against a fresh
  Core descriptor and the typed CLI checks it again before sending the request.
  Table rows are filtered twice against the descriptor's safe columns. Action
  inputs are bounded, reject secret-like fields, are staged only in a private
  mode-0600 Project temp file, and are removed after the operation; dangerous
  or explicitly-confirmed actions use the native Studio confirmation dialog.
  The iframe receives only `{completed:true}` from an action.
- CLI change pushed as `11b9a21` (`fix(cli): сверять digest Admin Surface`).
  `make check` and `make test-race` both pass. Studio commit/push is the next
  step; documentation pins should then move to the published Studio, CLI and
  current Core revisions.
- Studio `make check` passes: Wails binding reproducibility, Go and frontend
  lint, 180 frontend tests, Go tests, vet and build. `make check-race` and
  `make desktop-build` pass. Desktop binary:
  `build/bin/Liapoldus Studio.app/Contents/MacOS/studio`, SHA-256
  `910320ef7176a8db582a8343e262e8fa1f61923c06d2d7ba9d93a8727a58c53e`.
- Server Editor `.63` package passes `make package`, all 83 plugin tests and
  Studio installer inspection. SHA-256:
  `2c6befb58d3a27d5a7e2c58fe7c65da06387b6b28d5ccd06dc7eadd683a333d8`.
  Plugin source is not a Git repository and has no remote. Neither this package
  nor the new Studio binary has been installed/launched for WebView acceptance;
  they remain subject to the Studio native trust flow for their exact digests.

### Server Editor save outcome reporting — 2026-10-18

- `service.settings.save` now returns only a bounded `applyState` to the plugin:
  `applied`, `review-required`, `not-confirmed` or `applying`. Studio's normal
  lifecycle remains the only apply path; Canvas Inspector remains the review
  surface for public/security-sensitive changes. The plugin no longer says a
  runtime validation completed merely because Project settings were saved.
- Regressions cover public-route review gating in the controller and the plugin
  message directing users back to Canvas Inspector. Targeted owner checks pass;
  full `make check` passes with 180 frontend tests, all Go tests, lint,
  reproducible bindings, vet and build. `make desktop-build` passes.
- New macOS/arm64 Studio executable SHA-256:
  `0e3a372123df9865a6e4cec369d5d2a467e0b254c608fdf44fd879c3201894e9`.
  Server Editor `0.3.64` passes 84/84 tests, package validation and Studio
  installer inspection; SHA-256
  `5b714964e68c90f701c77025773cd465eac108030da141580c406be1ba680d38`.
  Package permissions remain settings.read/write, configuration-ui.read,
  resources.read/publish, peer.catalog.read and secrets.read.
- Neither new artifact has been installed/launched for WebView acceptance.
  Both exact digests remain subject to native Studio review. Plugin source has no
  Git repository/remote; its source edits and built package remain local.
