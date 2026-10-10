# Production readiness matrix

Этот документ — фактическая release-проверка Studio. Архитектурные решения
описаны в `technical-architecture.md`, а здесь фиксируется, какое evidence
нужно предъявить перед production promotion.

## Local evidence

| Gate | Current boundary | Evidence |
| --- | --- | --- |
| Desktop-only | Wails desktop entrypoint, web product removed | no web references; Wails package smoke |
| Canonical Project | project files остаются CLI-owned | project/source tests; no second project format |
| Git workspace | status, diff, history, remotes, checkout, commit, pull/push, conflict state | native Git integration tests |
| Schema editing | redacted read, safe patch, type/required/enum/bounds/pattern validation | settings tests; Wails UI build |
| Runtime graph | plugin instances и versioned links без Core node | project graph tests; canvas build |
| CLI/Core | typed JSONL, cancellation, local Core commands, report import, remote handoff | CLI runner tests; report tests |
| Traffic | report-only redacted projection, filters, timeline/table, safe export | report/redaction tests |
| Studio plugins | explicit trust, permissions, digest, Ed25519 verification, declarative surfaces, tool/process supervision, rollback | installer/host/tool/sandbox tests |
| Persistence | SQLite migrations, global metadata, project-local `.studio` state | migration and permission tests |
| Recovery | redacted diagnostics survive restart and appear in Problems | diagnostic store tests |

## Release evidence

Production promotion additionally requires all of the following:

1. `STUDIO_PLUGIN_TRUST_ROOTS` содержит approved Ed25519 public keys.
2. `STUDIO_PLUGIN_REQUIRE_SIGNATURES=true`.
3. `STUDIO_PLUGIN_SANDBOX_MODE=required`.
4. Linux runner has `bubblewrap`; macOS runner has `sandbox-exec`.
5. Windows package contains the signed native `studio-sandbox-launcher.exe`,
   which launches plugin processes in an AppContainer with scoped package and
   project ACLs, and the runner passes its filesystem/network isolation smoke
   test (`scripts/desktop/sandbox-smoke.mjs`).
6. Windows and Linux package matrix jobs завершились успешно, а artifacts
   прошли package smoke.
7. macOS artifact notarized/stapled; Windows artifact Authenticode-signed;
   checksums опубликованы вместе с build provenance.

Если хотя бы один пункт отсутствует, artifact является QA/unsigned artifact и
не считается production release. Studio может оставаться usable в local mode,
но release status должен быть `conditional`, а не `production-ready`.

Signed workflow проверяет первые три значения до сборки через
`scripts/desktop/verify-release-config.mts`. Проверяющий выводит только имена
нарушенных переменных и не раскрывает содержимое trust roots.

## Required command set

```text
make check
make check-race
make desktop-build
STUDIO_PACKAGE_PLATFORM=<darwin|linux|windows> node scripts/desktop/package-smoke.mjs
npm run build                  # from liapoldus-docs
```

Cross-platform CI дополнительно выполняет platform Go test/vet/build,
bindings reproducibility, frontend lint и native Wails package build. Release
workflow не должен заменять отсутствующее runtime/security evidence одним
успешным compile.
