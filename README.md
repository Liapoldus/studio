# Liapoldus Studio

Liapoldus Studio — отдельная среда разработки проектов Liapoldus. Она управляет
файлами проекта, локальным состоянием, Git-версиями и импортированными отчётами
универсального `liapoldus` CLI. Studio не запускает Core и не обращается к Core API.

## Варианты запуска

| Вариант | Entry point | Presentation | Ответственность |
| --- | --- | --- | --- |
| Desktop | `main.go` | Wails bindings | проект, дерево файлов, локальные Git-операции и отчёты CLI |
| Web | `cmd/web/main.go` | HTTP + same-origin API | тот же workspace-shell без Core transport |

React-приложение и основные компоненты общие. Тонкие адаптеры в
`frontend/src/api/` направляют вызовы к Wails bindings либо к same-origin REST.
Сборки используют отдельные Vite entrypoints, но общий `App.tsx`.

Web endpoint намеренно ограничен health, product-info и workspace-shell. Core
credentials, Core endpoint и управляющие операции отсутствуют. Deployment и
изменение runtime выполняются standalone `liapoldus` CLI локально, вручную или
в GitHub CI.

## Слои Go

- `internal/domain/models`, `internal/domain/interfaces` — модели и порты;
- `internal/application/product` — прикладные сценарии информации о продукте;
- `internal/infrastructure` — конфигурация и технические адаптеры;
- `internal/presentation/wails` и `internal/presentation/web` — отдельные
  presentation adapters;
- `main.go` и `cmd/web/main.go` — независимые composition roots.
- Bootstrap читается только из ENV. Runtime JSON-конфигов и CLI config flags нет.
  Wails CLI запускается из корня с нативным `wails.json` и `main.go`;
  временные конфиги не создаются.

Frontend embeds сгруппированы в `internal/infrastructure/assets/{desktop,web}`.
Product metadata хранится в Go (`internal/infrastructure/product/reader.go`),
без JSON asset/parser; native parity tests фиксируют desktop/web значения и
защиту от изменения slices вызывающим кодом. Runtime-адаптер Core намеренно
отсутствует: единственный исполнительный контур — standalone CLI.

## Разработка

Требуются Go, C compiler (CGO SQLite), Node.js (20.19+, 22.13+ или 24+) / npm
и Wails v2 CLI для desktop-варианта.

```sh
make install
make desktop-dev
make desktop-build
make web-build
make web-run
```

Проверки:

```sh
GOWORK=off GOFLAGS=-p=1 make check
make check-race
make desktop-build
```

`make check` собирает обе frontend версии, проверяет воспроизводимость Wails
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
всем frontend `.ts`/`.tsx`, включая обе Vite-конфигурации, Wails declarations,
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
TS E2E собирает standalone web binary с `GOWORK=off`, проверяет ENV-only bootstrap,
health/product-info и раздачу embedded HTML/JS из постороннего рабочего каталога.

## ENV и локальное хранилище

| ENV | Назначение | Default |
| --- | --- | --- |
| `STUDIO_WEB_LISTEN_ADDRESS` | HTTP listener Studio web, host:port | `127.0.0.1:8080` |
| `STUDIO_DESKTOP_DB_PATH` | Абсолютный путь к файлу SQLite Studio | `os.UserConfigDir()/Liapoldus/Studio/client.sqlite` |

Изменение bootstrap требует перезапуска. Значения не публикуются в product-info.
Web не имеет Core endpoint и не выполняет runtime-запросы.

Desktop открывает собственную SQLite БД с транзакционной schema v1, сохранёнными
project metadata (ID, имя, абсолютный root path) и selected project. Адаптер
поддерживает upsert/list/delete и чтение/запись selection; удаление выбранного
project атомарно очищает selection. Данные сохраняются после reopen; неизвестная
новая версия schema отклоняется. Файл БД имеет права `0600`, новые каталоги — `0700`.
Core settings, credentials и plugin settings здесь не хранятся.

Открытые задачи и границы каркаса перечислены в [TODO.md](TODO.md).

Целевая продуктовая модель Studio, project/file tree, Core workspace, Core
services, Studio plugins, marketplace и Mermaid-схемы описаны в разделе
[docs/](docs/index.md). Документ имеет статус проектной спецификации и не
заменяет контракты Core или Plugin SDK.

Лицензия проекта — GNU AGPL-3.0-only; полный текст находится в [LICENSE](LICENSE).
