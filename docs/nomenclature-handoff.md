# Studio nomenclature owner handoff — 2026-10-13

> This Studio-specific implementation snapshot predates the coordinated owner
> migration. Server and the other active service repositories have since been
> mechanically migrated to Service SDK/Wool terminology; use their current
> owner sources and the root `WORKSPACE_STATUS.md` for cross-repository status.

Работа завершена в Studio. Список ниже — изменения этого прохода относительно
снимка пользовательского WIP перед работой, а не весь `git diff` относительно
HEAD. Корень всех перечисленных путей:
`/Users/docup/Projects/Liapoldus Engine/studio/`.

## Проверки

Все команды выполнены с
`PATH=/Users/docup/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH`,
`GOWORK=off`, `GOFLAGS=-p=1`.

| Проверка | Результат |
| --- | --- |
| `go test ./internal/domain/models ./internal/infrastructure/project ./internal/infrastructure/plugins ./internal/presentation/wails` | PASS после последних правок |
| `make check` | PASS: frontend build, две изолированные генерации Wails, strict Go/TS lint, native Go tests, TypeScript typecheck, 20 TS tests, `go vet . ./internal/...`, `go build . ./internal/...` |
| `make check-race` | PASS: `go test -race . ./internal/...` |
| `make desktop-build` | PASS: darwin/arm64 packaging/self-signing, затем reproducibility и strict lint |
| `git diff --check` | PASS |

Desktop artifact:
`build/bin/Liapoldus Studio.app/Contents/MacOS/studio`.
Ignored frontend build output в `internal/infrastructure/assets/desktop/dist/`
пересобран штатным pipeline и не входит в authored source paths ниже.

## Интеграция и ограничения

Локальных блокеров нет. Сквозной runtime-запуск Studio → CLI → Core не
выполнялся; согласованная реализация CLI/Core service commands должна быть
подтверждена владельцами при межрепозиторной интеграции. Studio ожидает только
Core-backed `service manifest|schema|status <id> --target local` и
`service artifact …`; direct Service SDK REST client отсутствует.

Старый runtime `plugins/` и старые schema paths отклоняются; migration fixtures
сохраняют старые значения для проверок отказа и перехода. Нейтральные IDs и
application methods не переименовываются. Package manifest `id`, формат
`.studio-plugin`, trust, sandbox, immutable generations/digests и historical
reports не мигрируются. `StudioPluginProcessStatus` и frontend editor identity
используют `StudioPluginID` / `studioPluginId`. Подробности versioned
workspace preview/apply/recovery — в [инструкции миграции](nomenclature-migration).

Подтверждённый Server owner source path: `docs/site/services/server.md` в
Server repo. Этот путь зафиксирован для интегратора; Server не редактировался.

Сохранены исходный UI WIP, monochrome CSS, brand assets и orange rightmost Home
button. `plan.md`, `docs/archive/*`, sibling repos не редактировались. Новый
configurator не реализован. Пользовательские project/workspace files не
мигрировались этим проходом: запись migration/recovery проверена на temp fixtures.
Commit/push не выполнялись.

## Точные source paths этого прохода

```text
AGENTS.md
README.md
TODO.md
docs/build-workspace.md
docs/cli-integration.md
docs/core-workspace.md
docs/docker-runtime.md
docs/frontend-architecture.md
docs/index.md
docs/nomenclature-handoff.md
docs/nomenclature-migration.md
docs/product-model.md
docs/project-and-files.md
docs/roadmap.md
docs/studio-plugins.md
docs/technical-architecture.md
docs/traffic-inspector.md
docs/ui-system.md
frontend/src/App.tsx
frontend/src/api/info.ts
frontend/src/api/types.ts
frontend/src/api/wails.ts
frontend/src/controllers/studioController.ts
frontend/src/models/copy.ts
frontend/src/models/pluginSurface.ts
frontend/src/models/runtime.ts
frontend/src/models/studio.ts
frontend/src/stores/studio.ts
frontend/src/views/StudioViews.tsx
frontend/wailsjs/go/models.ts
frontend/wailsjs/go/wails/App.d.ts
frontend/wailsjs/go/wails/App.js
internal/application/cli/planner.go
internal/application/cli/planner_test.go
internal/application/workspace/service.go
internal/domain/interfaces/plugin.go
internal/domain/interfaces/project.go
internal/domain/interfaces/store.go
internal/domain/models/cli.go
internal/domain/models/cli_test.go
internal/domain/models/plugin.go
internal/domain/models/state.go
internal/domain/models/studio_plugin_test.go
internal/domain/models/workspace.go
internal/infrastructure/plugins/host.go
internal/infrastructure/plugins/installer.go
internal/infrastructure/project/graph.go
internal/infrastructure/project/mutations.go
internal/infrastructure/project/mutations_test.go
internal/infrastructure/project/source.go
internal/infrastructure/project/source_test.go
internal/infrastructure/projectstate/store.go
internal/infrastructure/projectstate/store_test.go
internal/infrastructure/sqlite/store.go
internal/infrastructure/sqlite/store_test.go
internal/presentation/wails/app.go
internal/presentation/wails/app_test.go
internal/presentation/wails/plugin_asset_handler.go
scripts/bindings/prepare.mts
scripts/workspace/migrate.mts
tests/bindings/prepare.test.mts
tests/frontend/models.test.mts
tests/frontend/pluginSurface.test.mts
tests/frontend/workspaceMigration.test.mts
```
