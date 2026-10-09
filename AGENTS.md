# Инструкции проекта Liapoldus Studio

Studio — отдельный клиент экосистемы Liapoldus: TypeScript/React UI и Go
backend. Продукт имеет два способа доставки одного frontend: desktop на Wails и
web без Wails. Это каркас, не готовый Core-клиент.

## Архитектура

- `internal/domain` содержит только `models/` и `interfaces/`.
- `internal/application` содержит прикладные сценарии в тематических пакетах
  (сейчас `product/`), без дополнительных архитектурных слоёв.
- `internal/infrastructure` содержит адаптеры и технические детали.
- `internal/presentation/wails` — desktop presentation;
  корневой `main.go` — её composition root (нативное требование Wails CLI).
- `internal/presentation/web` — HTTP presentation для web;
  `cmd/web/main.go` — её composition root.
- `frontend/src/App.tsx` и React-компоненты общие для обоих вариантов.
  Отличаются только адаптеры `frontend/src/api/wails.ts` и `http.ts`.
- Frontend assets находятся в `internal/infrastructure/assets/{desktop,web}`;
  product metadata — typed Go definitions в `infrastructure/product/reader.go`.
  Не создавать runtime parsers для внутренних констант или reserved-пакеты
  будущих Core/SSH adapters; планы остаются в TODO.md.

## Режимы Studio

- Desktop может в будущем поддержать прямое подключение или SSH bridge и
  несколько Core connections. Пока эти действия не реализованы.
- Web получает ровно один Core endpoint из `STUDIO_CORE_ENDPOINT`.
  Endpoint нельзя добавить, изменить или переключить из UI или публичного API.
  Web-вариант не содержит SSH bridge.
- Bootstrap задаётся только ENV: без runtime JSON loaders и config flags.
  Web использует `STUDIO_WEB_LISTEN_ADDRESS` (default `127.0.0.1:8080`) и
  обязательный HTTPS `STUDIO_CORE_ENDPOINT`; desktop — `STUDIO_DESKTOP_DB_PATH`
  (абсолютный путь, default `os.UserConfigDir()/Liapoldus/Studio/client.sqlite`).
- SQLite Studio хранит только сохранённые desktop connections и локальное
  состояние клиента (selected connection). Не копировать Core/plugin settings
  или credentials. Адаптер пока не подключён к UI; открытие БД не означает
  доступность Core connection или SSH bridge.
- Web bootstrap задаётся оператором при развёртывании; не встраивать
  credentials в frontend, конфиг, логи или ответы API.
- До проектирования server-side identity, authorization, CSRF и secret handling
  не добавлять управляющие Core API endpoints. Текущий web endpoint возвращает
  только информацию о каркасе и health.
- Не изображать несуществующие Core API, подключения или авторизацию как готовые.

Не добавлять plugin lifecycle и product contracts в Studio. Не менять Core,
Plugin SDK или `pluginprotocol` из этого репозитория. Документация описывает
назначение и каркас, а не полную спецификацию экосистемы.

## Проверки и публикация

Перед изменениями проверить `git status`; сохранять чужие изменения. Проверять
`GOWORK=off GOFLAGS=-p=1 make check`, `make check-race` и `make desktop-build`.
Все Studio Go packages (корень, `cmd/`, `internal/`, включая native tests и
generated compilation) входят в lint/test/build/vet. Цели перечислены явно,
чтобы Go не считал npm vendor sources в `node_modules` пакетами Studio.
`make check` сначала собирает обе frontend версии, затем проверяет генерацию,
lint, native Go/typed TS tests, vet и Go build. Wails запускается из корня с
единственным `wails.json` — build tooling, не runtime-конфигурация; временных
копий, config aliases и каталога `configs/` нет.
SQLite driver использует CGO: для native tests/build нужен C compiler.
`make check` обязательно включает `make lint`: pinned golangci-lint v2.5.0
(`.golangci.yml`, все Studio packages, включая Go tests),
gofmt check и typed ESLint strictTypeChecked для всех frontend TS/TSX,
Vite configs, Wails declarations, `scripts/` и `tests/`; unsafe/promise rules
обязательны. `.mjs` ESLint config проверяется ESLint recommended.
`go vet`/gofmt отдельно не являются quality lint.
Не добавлять baseline, path/global exclusions или inline disables ради PASS.
Npm dependencies и generated Wails JS не являются authored Studio Go/TypeScript.
Wails output готовится `npm run bindings:prepare` после генерации; изменение
схемы должно fail closed до обновления adapter и тестов. `bindings:check`
дважды генерирует весь Wails output в изолированном временном каталоге и
сравнивает с checked-in artifacts, не меняя пользовательскую SQLite/WIP.
Desktop build также использует временную SQLite для генерации.
TS tests разделены на `tests/{bindings,frontend,e2e}`; Go tests лежат рядом
с кодом. `make desktop-build` повторяет reproducibility и lint после упаковки.
Коммиты и интеграцию текущей cleanup-сессии выполняет основной интегратор;
этот агент не коммитит и не пушит. Не публиковать и не тегировать без явного
запроса пользователя.
