# Liapoldus Studio

Liapoldus Studio — отдельная среда разработки проектов Liapoldus. Она управляет
файлами проекта, локальным состоянием, Git-версиями и импортированными отчётами
универсального `liapoldus` CLI. Studio не запускает Core и не обращается к Core API.

## Запуск

| Вариант | Entry point | Presentation | Ответственность |
| --- | --- | --- | --- |
| Desktop | `main.go` | Wails bindings | проект, дерево файлов, локальные Git-операции и отчёты CLI |

React-приложение использует Wails bindings через адаптер
`frontend/src/api/wails.ts`. Core credentials, Core endpoint и управляющие
операции отсутствуют. Deployment и изменение runtime выполняются standalone
`liapoldus` CLI локально, вручную или в GitHub CI.

## Слои Go

- `internal/domain/models`, `internal/domain/interfaces` — модели и порты;
- `internal/application` — прикладные сценарии product/workspace и последующих
  cli/plugin/report use cases;
- `internal/infrastructure` — конфигурация и технические адаптеры;
- `internal/presentation/wails` — desktop presentation adapter;
- `main.go` — composition root приложения.
- Bootstrap читается только из ENV. Runtime JSON-конфигов и CLI config flags нет.
  Wails CLI запускается из корня с нативным `wails.json` и `main.go`;
  временные конфиги не создаются.

Frontend embed находится в `internal/infrastructure/assets/desktop`.
Product metadata хранится в Go (`internal/infrastructure/product/reader.go`),
без JSON asset/parser; native tests фиксируют значения и защиту от изменения
slices вызывающим кодом. Runtime-адаптер Core намеренно отсутствует: единственный
исполнительный контур — standalone CLI.

## Разработка

Требуются Go, C compiler (CGO SQLite), Node.js (20.19+, 22.13+ или 24+) / npm
и Wails v2 CLI для desktop-варианта.

```sh
make install
make desktop-dev
make desktop-build
```

Проверки:

```sh
GOWORK=off GOFLAGS=-p=1 make check
make check-race
make desktop-build
```

`make check` собирает desktop frontend, проверяет воспроизводимость Wails
artifacts, quality lint, native Go tests, typed TS tests, vet и Go build.
Каждая проверка блокирует gate. `make lint` — quality lint, `make test` — Go/TS
tests (после frontend сборок); `make check-race` — native Go race tests.
Полный packaged desktop build: `make desktop-build`.

Go quality lint закреплён на golangci-lint **v2.5.0**; Makefile устанавливает
его в ignored `.tools/` и проверяет версию. Config verify использует локальную
схему `tools/lint/schema.json`, взятую из upstream tag v2.5.0
(`jsonschema/golangci.jsonschema.json`, только JSON minification); сеть нужна
для первой установки зависимостей, а не для повторной проверки config.
Корневой `.golangci.yml` включает
20 анализаторов (в том числе contextcheck/noctx, staticcheck/all, gosec, errcheck/check-blank,
govet/all, SQL resource checks) и отдельную проверку gofmt. Проверяются все
пакеты Studio в корне, `cmd/` и `internal/`, включая тесты; npm-зависимости не являются
пакетами Studio. `go vet` и gofmt не заменяют этот quality lint.

Frontend использует закреплённые ESLint **9.39.5**, typescript-eslint **8.71.1**
и TypeScript **5.9.3** из `package-lock.json`. Vite **7.3.7** и React plugin
**5.2.0** согласованы с Node types; TS scripts/tests запускаются через pinned
tsx **4.20.6**. `strictTypeChecked` применяется ко
всем frontend `.ts`/`.tsx`, включая Vite-конфигурацию, Wails declarations,
handwritten TS scripts и тесты в `tests/{bindings,frontend,e2e}`. Unsafe и promise
checks блокируют gate; TypeScript проверяет declarations без `skipLibCheck`.
Warnings блокируют gate; baseline, path exclusions и inline rule disables отсутствуют.
Сам `.mjs` ESLint config входит в blocking ESLint recommended gate.
Generated Wails JavaScript остаётся SDK output; typed lint проверяет его TypeScript boundary.

Wails build/dev запускает `bindings:prepare` после генерации: модель перенаправляется
на валидируемый Studio-owned adapter с прежним `models.ProductInfo` factory;
event/notification payloads получают `unknown` вместо `any`. Не редактировать
prepared output вручную. Новая Wails model schema требует обновления adapter/tests,
иначе подготовка завершается ошибкой. Сам lint файлы не изменяет.

`scripts/bindings/{prepare,check}.mts` готовят и проверяют весь generated output.
`bindings:check` дважды запускает pinned Wails v2.12.0 generation в изолированной
копии Go sources с временной SQLite и сравнивает все файлы с checked-in output.
После `make desktop-build` reproducibility и lint проверяются повторно.
Сама упаковка также использует временную SQLite для генерации bindings;
база пользователя открывается при запуске приложения.
Blocking macOS CI выполняет `make check`, `make check-race`, packaged desktop build.

## ENV и локальное хранилище

| ENV | Назначение | Default |
| --- | --- | --- |
| `STUDIO_DESKTOP_DB_PATH` | Абсолютный путь к файлу SQLite Studio | `os.UserConfigDir()/Liapoldus/Studio/client.sqlite` |

Изменение bootstrap требует перезапуска. Значения не публикуются в product-info.

Desktop открывает собственную SQLite БД с транзакционной schema v5, сохранёнными
project metadata (ID, имя, абсолютный root path) и selected project. Адаптер
поддерживает upsert/list/delete и чтение/запись selection; удаление выбранного
project атомарно очищает selection. Данные сохраняются после reopen; неизвестная
новая версия schema отклоняется. Файл БД имеет права `0600`, новые каталоги — `0700`.
Editor associations, installed plugin metadata и trust decisions также принадлежат
этой базе. Workspace layout/tabs/filters хранятся только в project-local
`.studio/workspace.json`; redacted recoverable CLI/plugin diagnostics принадлежат
`.studio/diagnostics.jsonl`. Core settings, credentials и plugin settings здесь
не хранятся. Application theme (`system`, `light`, `dark`) хранится в global
SQLite и применяется host-controlled renderer theme tokens.

Открытые задачи и границы каркаса перечислены в [TODO.md](TODO.md).

Целевая продуктовая модель Studio, project/file tree, runtime plugin graph,
CLI boundary, Studio plugins, traffic reports и Mermaid-схемы описаны в разделе
[docs/](docs/index.md). Документ имеет статус проектной спецификации и не
заменяет контракты Core или Plugin SDK.

Лицензия проекта — GNU AGPL-3.0-only; полный текст находится в [LICENSE](LICENSE).
