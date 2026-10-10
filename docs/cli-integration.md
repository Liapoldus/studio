# CLI integration boundary

## 1. Ownership

Studio owns intent, context and presentation. `liapoldus` owns project
materialization, target credentials, bundle creation, Core transport, local Core
process lifecycle and deployment policy.

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

Before process start the host applies a reviewed command grammar. The production
Studio surface currently permits `validate`, `project inspect`, `bundle inspect`,
`target list/inspect/test/add`, `core start/stop/restart/status/logs --target
local`, `operation get/watch <id> --target local`, local `plan`/`apply` and local
traffic observation. Unknown subcommands, extra flags and remote
`plan`/`apply`/`observe` targets fail closed. Target profile paths are project
relative and cannot escape the opened Project. Adding a command requires a
versioned boundary update, UI action, and tests; the Studio CLI panel is never
an arbitrary terminal.
Adding a command requires a versioned boundary update, UI action, and tests; the
Studio CLI panel is never an arbitrary terminal.

## 3. Event stream

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

## 4. Local target workflow

Studio may invoke:

- `core start`, `core stop`, `core restart`;
- `core status`, `core logs`;
- `validate`, `plan`, `apply`;
- `operation get`, `operation watch`;
- observation/traffic report commands.

В workbench command panel доступны безопасные local actions: `target list`,
`core status`, `core start`, `validate`, `plan --target local` и подтверждаемый
`apply --target local`. Remote deployment controls намеренно не добавляются:
remote handoff должен оставаться отдельным CLI/CI workflow.

Для remote workflow Studio может подготовить `studio-cli-handoff/v1`: artifact
содержит project id, repository context, clean Git commit SHA, target и exact
`apply --target <target> --revision <sha>` args. Handoff запрещён для `local`,
dirty/conflicted worktree и не содержит credentials. Studio только показывает
этот artifact; исполнение остаётся CLI/CI responsibility.

The UI displays CLI progress and imports the final signed/typed report. It never
infers Core state from process exit alone.

В desktop host запуск проходит через `App.RunCLI`: Go валидирует текущий
Project context, запускает CLI напрямую и публикует каждый typed event через
Wails event `studio.cli.event`. Events сохраняют operation/target/state metadata
и optional target-list payload, а renderer показывает bounded event history,
target catalog и краткий lifecycle в top bar и нижней панели. Renderer не
получает `exec.Cmd`, environment или credentials;
нижняя панель показывает только безопасные event fields.

Событие `report.available` обрабатывается внутри Go host: report читается
только из project scope, проверяется размер и `projectId`, повторно проходит
redaction и сохраняется в `.studio/reports/`. Renderer получает только
`TrafficRecordView`, а не исходный report.

## 5. Remote target workflow

Studio can show and edit target metadata through the CLI target adapter, but
remote plan/apply becomes an exact handoff containing project root, revision,
target and command context. Remote credentials never enter Studio state.

## 6. Reports

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
