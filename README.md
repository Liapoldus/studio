# Liapoldus Studio

Liapoldus Studio — отдельный клиент для обслуживания экосистемы Liapoldus.
Это начальный каркас, а не готовая система управления Core.

## Варианты запуска

| Вариант | Entry point | Presentation | Привязка к Core |
| --- | --- | --- | --- |
| Desktop | `cmd/desktop/main.go` | Wails bindings | целевой режим допускает direct и SSH bridge; сами подключения пока не реализованы |
| Web | `cmd/web/main.go` | HTTP + same-origin API | один `coreEndpoint` из внешнего JSON-конфига; переключения и SSH bridge нет |

React-приложение и основные компоненты общие. Тонкие адаптеры в
`frontend/src/api/` направляют вызовы к Wails bindings либо к same-origin REST.
Сборки используют отдельные Vite entrypoints, но общий `App.tsx`.

Web endpoint намеренно ограничен health и информацией о каркасе. Хотя один
Core endpoint уже задаётся в bootstrap-конфиге, подключение к Core и операции
управления ещё не реализованы. Перед их добавлением нужно спроектировать
server-side аутентификацию/авторизацию, управление credentials, CSRF, проверку
Origin и аудит. Браузер не должен получать Core credentials или обращаться к
Core напрямую.

## Слои Go

- `internal/domain/models`, `internal/domain/interfaces` — модели и порты;
- `internal/application` — прикладные сценарии;
- `internal/infrastructure` — конфигурация и технические адаптеры;
- `internal/presentation/wails` и `internal/presentation/web` — отдельные
  presentation adapters;
- `cmd/desktop/main.go` и `cmd/web/main.go` — независимые composition roots.
- Runtime-конфиги хранятся в `configs/`. Wails CLI требует `wails.json` в
  каталоге запуска; Makefile временно формирует его из `configs/wails.json`
  внутри `cmd/desktop/` и удаляет после завершения команды.

## Разработка

Требуются Go, Node.js/npm и Wails v2 CLI для desktop-варианта.

```sh
make install
make desktop-dev
make desktop-build
make web-build
make web-config
make web-run
```

Проверки:

```sh
make check
```

Открытые задачи и границы каркаса перечислены в [TODO.md](TODO.md).

Лицензия проекта — GNU AGPL-3.0-only; полный текст находится в [LICENSE](LICENSE).
