# Project и дерево файлов

## 1. Project как source workspace

Project — это локальная root-папка с manifest и индексируемым деревом файлов.
Он работает без доступного Core. Deploy не выполняется из Studio: commit
передаётся универсальному `liapoldus` CLI для выбранного target.

Project не хранит копию Core SQLite, Core credentials или secret values. Он
содержит source references, modules, schemas и локальные metadata, необходимые
для сборки config bundle универсальным `liapoldus` CLI.

Runtime service binaries собираются вне Studio. Project хранит только artifact
references; CLI проверяет зарегистрированный внешний бинарник и использует его
в локальной Docker-среде без сборки service image.

Studio умеет создать новый Project из Home: пользователь задаёт `id` и имя,
выбирает родительскую папку, а host сам создаёт внутри неё новую директорию с
именем `id` и записывает минимальный canonical `project.yaml`. Родительская
папка может быть непустой. Studio не принимает произвольный shell и не
перезаписывает уже существующую директорию проекта; после создания Project
сразу открывается в workspace.

## 2. Целевая структура

Эта структура является каноническим Project-контрактом CLI. Studio не вводит
второй формат и не превращает `.studio/` в источник runtime-конфигурации.
Studio не содержит встроенного файлового менеджера: исходники остаются обычными
файлами проекта и открываются внешним редактором. Подключение сервисов
выполняется через каталог установленных локальных бинарников в Settings.

```text
liapoldus-project/
├── project.yaml                 # identity, format version, target profiles
├── services/
│   ├── runtime-service/
│   │   ├── service.yaml         # identity, service version, schema references
│   │   ├── settings.json        # schema-driven service settings
│   │   └── links/               # полные versioned service-to-service contracts
│   │       └── forms-db.json
│   ├── forms-db-service/
│   │   └── service.yaml
│   └── server-service/
│       └── service.yaml
├── modules/
│   ├── auth-flow/
│   │   ├── module.yaml
│   │   └── source/
│   └── form-validation/
│       ├── module.yaml
│       └── source/
├── schemas/
│   ├── service-bindings/
│   └── modules/
├── environments/
│   ├── local.yaml                # target/profile metadata, без credentials
│   └── production.yaml
└── .studio/
    ├── workspace.json           # canvas/layout, tabs и filters
    ├── index/                   # generated local index
    ├── reports/                 # imported redacted reports
    ├── diagnostics.jsonl        # redacted recoverable CLI/plugin diagnostics
    └── drafts/                  # local drafts без secrets

`project.yaml`, `service.yaml`, `settings.json` и `links/*.json` редактируются
как source. `.studio/workspace.json` хранит состояние вкладок и layout по схеме
`workspace/v5` (вкладки закрываемые, drag-reorder, без pin). `.studio/` — локальное
desktop state, исключается из CLI bundle и не содержит Core credentials.
Git repository является частью Project:
Studio явно показывает branch, revision и dirty state, но не подменяет Git
источник истории своей SQLite-базой.
```

## 3. Узлы дерева

Дерево должно отличать:

- project metadata;
- runtime service services;
- modules;
- schemas;
- environment profiles;
- generated/local metadata;
- validation problems;
- changed и untracked files.

Для файла показываются:

- имя и тип;
- относительный путь;
- dirty state;
- validation state;
- связанный service/module;
- plugin, который умеет его открыть;
- последний применённый digest, если он известен.

## 4. Project source files

Project source files не отображаются во встроенном файловом менеджере. Studio
открывает выбранные ресурсы во внешнем редакторе через typed resource picker и
настройки ассоциаций файлов; создание и удаление структуры проекта остаётся
за CLI и профильными инструментами.

Project service tree и project file tree остаются разными представлениями:

```text
PROJECT
  services/
  modules/
  schemas/

PROJECT SERVICES
  runtime-service        Ready · gen 42
  forms-db-service       Degraded · gen 41
  server-service         Ready · gen 42
```

## 5. File tree и canvas

У них разные задачи:

- file tree отвечает «где находится source»;
- canvas отвечает «как services связаны»;
- inspector отвечает «что настроено у выбранного объекта»;
- operations отвечает «что произошло после CLI deploy».

Выбор service в списке открывает canvas и inspector. Выбор файла открывает его
во внешнем редакторе через OS default или сохранённую editor association.

## 6. Local source → CLI → Core

```mermaid
sequenceDiagram
    actor Operator
    participant Studio
    participant Files as "Project files"
    participant Git
    participant CLI as "liapoldus CLI"
    participant CoreAPI as "Core Management API"

    Operator->>Studio: Открывает project
    Studio->>Files: Индексирует manifest и дерево
    Studio->>Files: Запускает local validation
    Operator->>Studio: Меняет settings/module reference
    Studio->>Files: Сохраняет draft
    Operator->>Studio: Validate → Git diff → Commit
    Studio->>CLI: validate/plan/apply для local target
    CLI->>Files: Читает canonical project
    CLI->>CoreAPI: Локальный Core workflow через CLI
    CoreAPI-->>CLI: operationId и deploy report
    Operator->>Studio: Remote handoff
    Studio->>CLI: exact revision + target metadata
    CLI-->>Operator: CLI/CI deployment workflow
```

Studio не подключается к Core API, не хранит target credentials и не выполняет
remote deployment. Для `local` Studio запускает `liapoldus` как дочерний процесс
и импортирует его JSONL events/reports. Для remote Studio только подготавливает
exact CLI handoff и открывает provenance результата. Встроенный редактор файлов
отсутствует; открытие файла делегируется внешнему редактору (OS default + глобальный
редактор + per-mask ассоциации).

## 7. Inspector и files

Поле `file reference` остаётся project-relative reference. Оно не раскрывает
secrets и не превращает файл в runtime config автоматически.

Пример:

```text
Runtime service: runtime-service
Field: Logic module
Value: modules/auth-flow
Action: Open in Logic Modules
```

Встроенного текстового редактора и file-content bindings нет. Для файла доступны
системный default application, глобальный редактор и per-mask association.
Studio передаёт project-scoped path через native launcher, не строит
shell-команду из пользовательской строки и не передаёт редактору secrets.

Для service Admin Surface Studio может явно импортировать выбранный оператором
`.tar.gz`/`.tgz` artifact из внешней папки в `resources/` Project. Исходный файл
не меняется; импорт ограничен 128 MiB, не принимает symlink и публикуется под
именем с SHA-256 суффиксом без перезаписи существующего файла. В CLI передаётся
только project-relative path. Секреты нельзя упаковывать в публикуемый archive:
проверка имени и размера не заменяет проверку его содержимого.

## 8. Draft, validation и deploy handoff

Inspector различает четыре действия:

- `Save draft` — сохранить локальное изменение;
- `Validate` — проверить schema и references;
- `Diff` — показать отличие от выбранной Git revision;
- `Commit` — создать immutable revision;
- `Open deploy report` — открыть результат CLI/CI.

`Commit` disabled при:

- невалидном manifest;
- неизвестном field type;
- отсутствующем обязательном module/file;
- конфликте файлов;
- невалидном project source;
- незаполненном commit message.

Studio не имеет кнопки `Apply to Core`. Deploy запускается универсальным CLI:

```bash
liapoldus apply --project ./project --revision <commit> --target production
```

CLI обязан получить exact commit, собрать bundle и передать его Core API. Studio
может открыть сохранённый report, но не является его источником.

## 9. Project и target report switching

В верхней панели явно показываются контексты проекта и последнего deploy report:

```text
Project: forms-platform       Revision: 0123456       Target report: production
```

При смене project, branch или report Studio предупреждает о:

- dirty files;
- inspector drafts;
- незавершённых Git operations;
- недоступных plugin editors;
- несоответствии target profile.

## 10. Offline и deploy handoff

Всегда доступны без Core:

- открытие file tree;
- preview source;
- local validation;
- draft;
- plugin pages, не требующие Core;
- commit, push/pull и другие Git operations.

Deploy state без CLI report не считается применённым. Studio не должна выдавать
локальный source за active Core generation.
