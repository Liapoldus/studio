# Миграция Services и StudioPlugins

Runtime-сущности называются Services. Расширения редактора — StudioPlugins;
формат `.studio-plugin`, trust decisions, package digests, sandbox и versioned
bridge сохраняются. Control plane: Studio → CLI → Core → Service SDK REST.
Data plane: независимые Services → Wool. Namespace SDK —
`github.com/Liapoldus/service-sdk/v2`, Wool — `github.com/Liapoldus/wool/v3`.
Major versions не изменяются.

Studio использует только `service manifest|schema|status <id> --target local`
и `service artifact …`. Runtime-модели и bindings: `RuntimeService`,
`ServiceGraph.services`, `ServiceLink`, `CreateRuntimeService`,
`UpdateServiceLink`, `ReadRuntimeServiceMetadata`. Старые runtime `Plugin*`
bindings, CLI-команды `plugin …` и forwarding aliases отсутствуют.

## Project и workspace

Старый runtime-каталог `plugins/` и ссылки на него в settings/link schema paths
отклоняются до чтения графа или записи изменений. Каталог `.studio/plugins`,
пакеты `.studio-plugin`, нейтральный service ID `plugins` и application method
`plugin.Invoke` не являются legacy runtime paths.

Канонические Project files уже используют `services/<id>/service.yaml`,
`settings.json` и `links/*.json`. Нейтральные IDs, application methods,
project manifest version, settings bytes, immutable generations/digests и
исторические отчёты не переименовываются и не пересериализуются. Studio не
реализует новый configurator и не владеет миграциями Core или CLI Project schema.

Project-local состояние `.studio/workspace.json` переходит с `workspace/v3`
на `workspace/v4`. Переименование вкладки:
`plugins` → `studio-plugins` (id, kind и activeTabId). В editor-вкладках поля
`pluginId`/`pluginVersion` становятся `studioPluginId`/`studioPluginVersion`.
Process status использует `StudioPluginID` / JSON `studioPluginId`; package
manifest `id` не меняется. Старые поля читаются только миграцией v3, исходные
fixtures и recovery bytes сохраняются. Сохраняются порядок
вкладок, layout, Studio-plugin identity/version/routes, filters и неизвестные
пользовательские поля. Неизвестная версия отключает автосохранение, сохраняя
исходный файл. V2 с удалённым встроенным редактором не мигрируется автоматически.

Перед заменой состояния Studio сохраняет точные исходные байты в
`.studio/workspace-recovery-<sha256>.json`. Recovery-файлы принадлежат
пользователю; автоматического удаления нет.

## Предпросмотр и восстановление

Закройте Studio, чтобы остановить параллельное автосохранение. Из корня
Studio выполните read-only preview:

```bash
frontend/node_modules/.bin/tsx scripts/workspace/migrate.mts /absolute/project preview
```

Результат содержит текущий `digest`, `nextDigest`, `changed` и recovery path.
Для применения передайте точный digest, полученный при preview:

```bash
frontend/node_modules/.bin/tsx scripts/workspace/migrate.mts /absolute/project apply <digest>
```

Изменившийся файл, symlink, неизвестная версия или несовпадающий recovery
digest блокируют запись. Для восстановления снова выполните preview и передайте
текущий digest и digest исходного recovery-файла:

```bash
frontend/node_modules/.bin/tsx scripts/workspace/migrate.mts /absolute/project recover <current-digest> <recovery-digest>
```

Восстановление атомарно возвращает исходные байты, предварительно сохранив
текущее состояние. Project source files и reports скрипт не изменяет.
