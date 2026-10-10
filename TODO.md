# Liapoldus Studio — production roadmap

Studio — desktop-only development environment. Этот список синхронизирован с
`docs/roadmap.md`; незавершённые пункты не выдаются за готовый runtime.

Studio развивается отдельно от Core, SDK и runtime plugins. Project source и
Git остаются источниками конфигурации, deployment выполняется standalone
`liapoldus` CLI, а traffic observations приходят только через reports.

## Уже реализовано

- [x] Desktop entrypoint на Wails и React UI через typed bindings.
- [x] ENV-only bootstrap для desktop SQLite без Core endpoint и credentials.
- [x] Canonical Project tree reader с `.studio`/`.git` isolation.
- [x] Runtime plugin/link graph read model из `services/*`.
- [x] Native Git branch/revision/dirty adapter.
- [x] Project-scoped filesystem с traversal/symlink protection и atomic writes.
- [x] JSONL CLI runner boundary с allowlisted commands и output isolation.
- [x] Redacted CLI/Core report persistence в `.studio/reports`.
- [x] Local `.studio-plugin` inspection/install с explicit trust, digest и
  atomic activation.
- [x] Native external editor launcher без shell command construction, native
  application picker и global per-type/per-file associations.
- [x] Wails/React canvas с plugin nodes, links и generic inspector.
- [x] Native Go tests, race tests, typed frontend tests, strict TypeScript и
  ESLint checks для этих срезов.

## Следующие production gates

- [~] Добавить schema registry/renderer и edit forms для `settings.json` и
  полного link contract без raw secret values: settings schema renderer,
  redacted read, safe patch и backend structural validation (types, required,
  enum, bounds, patterns, project-relative `$ref`, composition keywords,
  readOnly и nested arrays/objects) работают через один typed generic
  renderer; полноценный versioned registry и оставшийся advanced JSON Schema
  vocabulary остаются отдельным contract gate.
- [~] Подключить CLI runner к operation progress, target catalog, local Core
  lifecycle и exact remote handoff: typed JSONL events доходят до Wails event
  stream, а UI предоставляет target list, Core status/start, local plan/apply и
  validate, cancellation и revision-pinned credential-free remote handoff;
  operation report lifecycle остаётся CLI-owned. Process boundary теперь
  fail-closed проверяет конкретную reviewed command grammar, обязательный
  `--target local`, operation id и project-relative target profiles; произвольный
  CLI terminal surface не допускается.
- [~] Подключить plugin registry, declarative surfaces и supervised companion
  tool processes к Wails host: SQLite registry/trust state, explicit import
  dialog, manifest-bound tools, explicit permission grants и optional backend
  process supervisor с timeout/crash state и host-controlled generic surface
  preview и version-specific remove/rollback action подключены; declared
  artifact SHA-256 и optional Ed25519 signature проверяются при
  inspection/install; macOS/Linux sandbox adapters, Windows AppContainer
  launcher и observable best-effort warning добавлены, а production
  `required` rollout и Windows isolation smoke остаются release policy gates.
- [x] Добавить traffic report import, timeline/table filters и safe export:
  redacted report projection, provenance, text/status/transport/time/latency
  filters, schema validation column, timeline/table views и safe export
  реализованы; источник observation и report lifecycle остаётся CLI-owned.
- [~] Реализовать Git diff/branches/history/remotes/checkout/commit/pull/push/
  conflict workflows: native status/diff/history/redacted remotes и clean-tree
  branch switch boundary, typed Wails methods и Git panel уже добавлены;
  conflict/rebase/merge/cherry-pick остаются external-editor/CLI workflow.
- [x] Добавить global SQLite migrations для installed plugins, trust decisions
  и editor associations; migration v3 удаляет прежнюю duplicate workspace table,
  migration v4 сохраняет application theme, migration v5 сохраняет granted
  plugin permissions, а project-local
  `.studio/workspace.json` хранит layout, tabs и filters.
- [~] Добавить macOS/Windows/Linux CI package builds, signing, upgrade,
  crash diagnostics и cross-platform smoke tests: CI package matrix, Go
  test/vet, structural package smoke и artifact upload добавлены;
  redacted recoverable CLI/plugin diagnostics добавлены; certificate-backed
  signing/release promotion и фактический Windows/Linux CI run остаются;
  signed workflow теперь fail-closed проверяет trust roots, обязательные
  signatures и required sandbox до production build.
