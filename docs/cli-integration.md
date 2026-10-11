# CLI integration boundary

## 1. Ownership

Studio owns intent, context and presentation. `liapoldus` owns project
materialization, target credentials, Core transport, local Core process
lifecycle, Docker staging/runtime and deployment policy. Plugin binaries are
registered artifacts; neither Studio nor CLI builds them or Docker images.

Studio never imports CLI Go packages and never opens Core SQLite.

## 2. Invocation

Every run is represented by:

```text
run id
command
project root
immutable revision, when required
target name
environment
safe arguments
CLI binary/version
```

The Go adapter starts the executable directly with an argument array. It does not
invoke a shell. Environment variables are an allowlist; credentials are resolved
inside CLI-owned providers.

GUI launches do not rely exclusively on the interactive shell `PATH`. Host
resolution checks optional `STUDIO_CLI_PATH`, the OS resolver, and conventional
user/system locations such as `~/go/bin/liapoldus`, `/usr/local/bin/liapoldus`
and `/opt/homebrew/bin/liapoldus`. The resolved absolute executable path is
used for both the Home toolchain probe and CLI runs.

Studio adds the internal `--studio-events` argument to every approved invocation.
The standalone CLI strips that flag before dispatch and emits the versioned
`cli-events/v1` JSONL stream. Normal command results become `run.output` payloads;
operation metadata becomes `operation.updated`, report paths become
`report.available`, and non-JSON stderr becomes a generic redacted diagnostic.

Before process start the host applies a reviewed command grammar. The production
Studio surface currently permits `validate`, `project inspect`, `bundle inspect`,
`target list/inspect/test/add`, `core start/stop/restart/status/logs --target
local`, `operation get/watch <id> --target local`, local `plan`/`apply` and local
traffic observation. Unknown subcommands, extra flags and remote
`plan`/`apply`/`observe` targets fail closed. Target profile paths are project
relative and cannot escape the opened Project. Adding a command requires a
versioned boundary update, UI action, and tests; the Studio CLI panel is never
an arbitrary terminal.

## 3. Control and data plane

Для plugin runtime действует только такая control-plane цепочка:

```text
Studio → typed CLI command → Core Management API → Plugin SDK REST API
```

CLI отправляет Core только безопасные registration metadata и получает manifest,
schema, identity, readiness и status исключительно Core-backed response. CLI не
вызывает `/manifest`, `/config-schema`, `/identity`, `/ready`, `/reload` и не
содержит Plugin SDK client. Business traffic идёт отдельно:

```text
Server → pluginprotocol → Echo
```

Core выдаёт peer directory и generic policy, но не проксирует этот traffic.

## 4. Event stream

CLI emits versioned JSONL events:

```json
{"schemaVersion":"cli-events/v1","type":"run.started","runId":"..."}
{"schemaVersion":"cli-events/v1","type":"run.progress","phase":"validate","percent":35}
{"schemaVersion":"cli-events/v1","type":"diagnostic","severity":"warning","code":"..."}
{"schemaVersion":"cli-events/v1","type":"operation.updated","operationId":"...","state":"running"}
{"schemaVersion":"cli-events/v1","type":"report.available","path":"...","digest":"sha256:..."}
{"schemaVersion":"cli-events/v1","type":"run.completed","exitCode":0}
```

Unknown event types are retained as opaque diagnostics and do not crash the run.
Malformed events fail closed and preserve the process exit code.

## 5. Local target workflow

Studio may invoke:

- `core start`, `core stop`, `core restart`;
- `core status`, `core logs`;
- `validate`, `plan`, `apply`;
- `operation get`, `operation watch`;
- observation/traffic report commands.

В workbench command panel доступны безопасные target actions `target list`,
`target inspect`, `target test` и подтверждаемый `target add --profile` с
project-relative profile path. Для local target доступны `core status`,
`core start`, `validate`, `plan --target local` и подтверждаемый
`apply --target local`. Remote deployment controls намеренно не добавляются:
remote handoff должен оставаться отдельным CLI/CI workflow.

Для remote workflow Studio может подготовить `studio-cli-handoff/v1`: artifact
содержит project id, repository context, clean Git commit SHA, target и exact
`apply --target <target> --revision <sha>` args. Handoff запрещён для `local`,
dirty/conflicted worktree и не содержит credentials. Studio только показывает
этот artifact; исполнение остаётся CLI/CI responsibility.

The UI displays CLI progress and imports the final signed/typed report. It never
infers Core state from process exit alone.

Canvas readiness is fetched per runtime plugin through the typed `plugin status`
CLI intent; the response is Core-backed. A successful CLI exit by itself never
marks a plugin ready. These readiness values live only in the current Studio
session; if CLI/Core cannot provide a valid status, the canvas shows `unknown`
instead of assuming the plugin is offline or healthy.

В desktop host запуск проходит через `App.RunStudioCommand`: renderer передаёт
только versioned intent (`validate`, `plan`, `core.status`, `target.test` и
другие allowlisted операции). Go planner сам добавляет текущий Project root,
`--revision HEAD`, выбранный local target и `--studio-events`, после чего
валидирует точную argv-форму и запускает CLI напрямую. Каждый typed event
публикуется через
Wails event `studio.cli.event`. Events сохраняют operation/target/state metadata
и optional target-list payload, а renderer показывает bounded event history,
target catalog и краткий lifecycle в top bar и нижней панели. Renderer не
получает `exec.Cmd`, environment или credentials;
нижняя панель показывает только безопасные event fields.

Событие `report.available` обрабатывается внутри Go host: report читается
только из project scope, проверяется размер и `projectId`, повторно проходит
redaction и сохраняется в `.studio/reports/`. Renderer получает только
`TrafficRecordView`, а не исходный report.

## 6. Remote target workflow

Studio can show and edit target metadata through the CLI target adapter, but
remote plan/apply becomes an exact handoff containing project root, revision,
target and command context. Remote credentials never enter Studio state.

## 7. Reports

Reports must contain provenance:

- project id and repository;
- exact commit SHA;
- target/environment;
- CLI and API versions;
- bundle digest;
- operation id and generation;
- replica/lease/readiness outcome;
- traffic report reference, when available.

Studio stores only a redacted report in `.studio/reports/` and links it to the
project revision. A report is never presented as a live observation.

`observe traffic --target local` is a CLI-owned report handoff. The target
profile may declare a project-relative `trafficReportPath`; CLI verifies the
`studio-reports/v1` document, exact project/target, bounded size and SHA-256,
then emits `report.available`. Studio never opens the Core endpoint and treats
the event as imported evidence, not as a live connection.
