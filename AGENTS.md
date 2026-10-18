# Инструкции проекта Liapoldus Studio

Studio — отдельная desktop-среда разработки экосистемы Liapoldus: TypeScript/React
UI и Go backend на Wails. Studio — workspace для файлов, сервисного графа и отчётов CLI, не
Core-клиент.

## Архитектура

- `internal/domain` содержит только `models/` и `interfaces/`.
- `internal/application` содержит прикладные сценарии в тематических пакетах
  (`product/`, `workspace/`, далее `cli/`, `plugins/`, `reports/`), без
  дополнительных архитектурных слоёв.
- `internal/infrastructure` содержит адаптеры и технические детали.
- `internal/presentation/wails` — desktop presentation;
  корневой `main.go` — её composition root (нативное требование Wails CLI).
- `frontend/src/App.tsx` и React-компоненты работают через Wails adapter
  `frontend/src/api/wails.ts`.
- Desktop shell — tabbed workspace: Zed-style top bar, левый rail как
  открыватели вкладок, правый schema-driven Inspector. Встроенного текстового
  редактора нет — открытие файла делегируется внешнему редактору. Нижний dock
  отсутствует; `Problems`/`Output`/`Reports` — вкладки. UI-состояние вкладок —
  `workspace/v5` в project-local `.studio/workspace.json`. Переходы из v3/v4
  сохраняют layout и plugin tabs, удаляют file-manager/runtime/artifact tabs и
  переводят active tab на Canvas при удалении текущей вкладки; исходные байты сохраняются в
  `.studio/workspace-recovery-<sha256>.json`. Неизвестные версии не перезаписывать.
  Apply recovery metadata использует версионированный `studio-apply-recovery`
  marker и хранит только bounded safe Core operation ID + local target; после
  перезапуска operation сверяется typed `operation.watch`, а маркер снимается
  лишь после подтверждённого terminal success. Retry доступен только если
  typed event подтвердил failed Core operation; отклонённый запрос без такой
  операции требует явного подтверждения и не запускает failed-operation
  recovery. Не retry-ить operation, пока её сохранённый ID не сверён.
- Frontend assets находятся в `internal/infrastructure/assets/desktop`;
  product metadata — typed Go definitions в `infrastructure/product/reader.go`.
  Не создавать Core transport, SSH adapters или runtime parsers для внутренних
  констант; планы остаются в TODO.md.

## Непрерывная работа над текущей целью

- Если пользователь поручил довести согласованный сценарий до результата и
  просит не задавать повторных вопросов, самостоятельно выполняй обычные шаги
  внутри выбранного Project/репозитория/target: UI-проверки, правки, локальные
  сборки и тесты, исправления и повторные целевые проверки. Не спрашивай
  разрешение на каждый штатный шаг и не останавливайся на первой неудаче:
  зафиксируй evidence, обнови checkpoint в `TODO.md` и продолжай до целевого
  acceptance либо конкретного внешнего барьера.
- Уже подтверждённая комбинация artifact digest + target + typed operation
  остаётся достаточной для повтора той же операции. Для текущего локального
  acceptance scope это `Server Echo Studio` / `local`; Core candidate
  `71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86` разрешён
  только для Core-only update. Не распространять согласие на иные binaries,
  targets или окружения.
- При ошибке сначала диагностируй и пробуй безопасные локальные исправления.
  Если один шаг требует отсутствующей информации/authority, зафиксируй точную
  причину и продолжай остальные независимые этапы; задавай один конкретный
  вопрос только когда без ответа этот шаг действительно нельзя выполнить.
- Повторно используй уже данное точное согласие, пока не изменились binary/
  digest, target, операция или последствия. Обязательные per-action барьеры
  интерфейса соблюдай непосредственно перед таким действием; обычные
  локальные проверки, диагностика и исправления ими не блокируются.
- Не превращай продолжение согласованной цели в серию общих permission-вопросов.
  Если конкретная установка/запуск нового локального software требует
  подтверждения интерфейса в момент действия, подготовь package/binary, проверь
  его digest и tests, выполни все независимые проверки и остановись только на
  exact action-time gate. Не обходи этот gate shell-командой, заменой artifact
  или ослаблением host trust.
- Сохраняй границы данных и операций: не менять credentials, сертификаты,
  Core DB, remote/prod state, чужие/неизвестные контейнеры; не выполнять
  push/deploy/release и необратимое удаление без отдельного запроса. Не
  повторять подтверждение для неизменившейся уже одобренной операции.

## Режимы Studio

- Studio не подключается к Core и не содержит Core endpoint, Core credentials
  или SSH bridge. Deployment выполняется standalone `liapoldus` CLI.
- Bootstrap задаётся только ENV: без runtime JSON loaders и config flags.
  Desktop использует `STUDIO_DESKTOP_DB_PATH` (абсолютный путь, default
  `os.UserConfigDir()/Liapoldus/Studio/client.sqlite`).
- SQLite Studio хранит project metadata, локальные drafts, imported CLI/CI
  reports и client state. Не копировать Core/service settings или credentials.
- Service readiness на canvas разрешено показывать только по typed CLI-команде
  `service status`, возвращающей Core-backed ответ. Это ephemeral status текущей
  сессии: при недоступности CLI/Core отображается `unknown`; Studio не открывает
  Core API/SQLite напрямую и не заявляет Core authorization как собственную
  возможность.

Studio implementation includes the approved local Studio-plugin host,
declarative surfaces, companion-tool boundary и sandboxed iframe UI-surface для
установленных Studio plugins. UI-surface плагина исполняется только в
`<iframe sandbox="allow-scripts">` без `allow-same-origin`, без доступа к Wails
bindings, файловой системе и Node; обмен — только через `postMessage` bridge.
Runtime сущности называются Services; только расширения редактора — StudioPlugins.
Control plane: Studio → CLI → Core → Service SDK REST. Data plane:
независимые Services → Wool. Namespace SDK — `github.com/Liapoldus/service-sdk/v2`,
Wool — `github.com/Liapoldus/wool/v3`; major versions не изменяются.
Runtime/Core service contracts остаются в Project/CLI/Core репозиториях; Studio
потребляет только их versioned schemas и никогда не загружает runtime service
executables.
Не менять Core, Service SDK или `wool` из этого репозитория.

Активные исходники расширений редактора размещаются в workspace
`plugins/<studio-plugin>/`, а не в `services/<service>/`. Server editor package
— `plugins/studio-server/`; `services/server/` остаётся владельцем runtime и
product contracts. Замороженные local snapshots `services/captcha/` и
`services/identity/` (вне `services/go.work`, без remotes) не изменять. Server
extension не обращается к Wails, Core или Service SDK напрямую. Host уже
предоставляет ограниченный typed `studio-service-editor/v2` bridge: redacted
settings read, Core-backed `service.configuration-ui.read` и
`service.peer.catalog.read`, общий draft и сохранение canonical Project через
host. Peer catalog выдаёт только сервисы открытого Project либо ограниченные
capability `id`/`version` из live manifest, полученного через typed CLI → Core;
endpoints и raw manifest в iframe не передаются. Descriptor читается только
Studio → typed CLI → Core; этот read сам по себе не применяет конфигурацию.
Специализированный Server contract editor реализован: `/echo` и временный
Add/Delete endpoint проверены через общий draft. Сохранение Project и
Core-backed apply отдельно подтверждены на локальном `Server Echo Studio` /
target `local`: Echo prefix изменён и автоматически применён как generation 52,
затем восстановлен как generation 53; curl проверил оба ответа. Эти локальные
проверки не закрывают recovery, ресурсную публикацию или cross-platform release
gates. Server Editor `.40` исправляет live rendering `listeners[].hostnames`;
текущие evidence и digest находятся в `TODO.md`. Пакет fail-closed при
отсутствии permission, выбранного сервиса, валидного schema path или доступного
host API.
`service.configuration-ui.read` — отдельное permission: declared + granted
`service.settings.read` не авторизует чтение SDK UI descriptor.
`service.peer.catalog.read` требует отдельные declared + granted permissions и
не наследуется от settings/resource permissions.
При sandbox bridge проверять origin по направлению: host принимает сообщения
только от точного `iframe.contentWindow` с opaque origin `null`; plugin получает
сообщения от `parent` с origin Studio, закрепляет этот origin после валидного
handshake и сверяет его для ответов. Не требовать `origin === "null"` для
сообщений host → iframe.

## Согласованный конфигуратор сервисов

Нормативный scope — workspace [`../studio/plan.md`](../studio/plan.md). Все
Core-backed manifest/schema/status/configuration metadata получает Studio только
через reviewed typed CLI intents и CLI operations/reports; не добавлять Core API
или Service SDK REST client в Studio. Project settings остаются canonical source
files, а локальный draft — только версионированное состояние Studio до
validation/save/apply.

Inspector, canvas и specialized editor должны разделять одну persisted draft
модель и digest conflict state в Zustand. Settings mutations используют
owner-provided `UpdateIfDigest`: Studio проверяет digest повторно под per-file
OS lock и атомарно заменяет файл, что сериализует cooperating Studio processes.
Это не координирует произвольный внешний редактор, который не берёт тот же lock;
изменения такого редактора обнаруживаются digest conflict, но конкурентная
запись в коротком промежутке между повторной проверкой и replace остаётся
открытым ограничением. React views не получают произвольные CLI argv,
filesystem/process APIs или секретные значения. Configuration UI следует
versioned Service SDK descriptor и schema, fail-closed для неизвестного widget.
Auto-apply, resources и Core restart идут typed CLI workflow с отчётным статусом;
никакого прямого lifecycle управления из renderer. Текущие незавершённые пункты
и evidence фиксировать в `TODO.md`, не выдавать существующий частичный Inspector
за завершённый конфигуратор.

## Проверки и публикация

Перед изменениями проверить `git status`; сохранять чужие изменения. Проверять
`GOWORK=off GOFLAGS=-p=1 make check`, `make check-race` и `make desktop-build`.
Все Studio Go packages (корень, `cmd/`, `internal/`, включая native tests и
generated compilation) входят в lint/test/build/vet. Цели перечислены явно,
чтобы Go не считал npm vendor sources в `node_modules` пакетами Studio.
`make check` сначала собирает desktop frontend, затем проверяет генерацию,
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
