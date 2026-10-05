# Инструкции проекта Liapoldus Studio

Studio — отдельный клиент экосистемы Liapoldus: TypeScript/React UI и Go
backend. Продукт имеет два способа доставки одного frontend: desktop на Wails и
web без Wails. Это каркас, не готовый Core-клиент.

## Архитектура

- `internal/domain` содержит только `models/` и `interfaces/`.
- `internal/application` содержит прикладные сценарии без вложенных слоёв.
- `internal/infrastructure` содержит адаптеры и технические детали.
- `internal/presentation/wails` — desktop presentation;
  `cmd/desktop/main.go` — её composition root.
- `internal/presentation/web` — HTTP presentation для web;
  `cmd/web/main.go` — её composition root.
- `frontend/src/App.tsx` и React-компоненты общие для обоих вариантов.
  Отличаются только адаптеры `frontend/src/api/wails.ts` и `http.ts`.

## Режимы Studio

- Desktop может в будущем поддержать прямое подключение или SSH bridge и
  несколько Core connections. Пока эти действия не реализованы.
- Web получает ровно один `coreEndpoint` из внешнего JSON bootstrap-конфига.
  Endpoint нельзя добавить, изменить или переключить из UI или публичного API.
  Web-вариант не содержит SSH bridge.
- Web-конфигурация задаётся оператором при развёртывании; не встраивать
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
`go build ./...`, `go vet ./...` и frontend сборки (предпочтительно через
`make check`). Wails CLI требует `wails.json` в каталоге запуска; Makefile
временно формирует его из `configs/wails.json` в `cmd/desktop/` и удаляет после
команды. Runtime-конфиги хранить только в `configs/`. Не коммитить, не
публиковать и не тегировать без явного запроса пользователя.
