# Liapoldus Studio — сервисы, Service SDK, Wool и конфигуратор

> Согласованный целевой план от 2026-10-13, не отчёт о готовности.
> Breaking-change переименование завершается ДО реализации конфигуратора.
> Предыдущий UI-план сохранён без изменений: docs/archive/plan-ui-2026-10-13.md.

## Режим исполнения согласованной цели

Эта цель ведётся непрерывно: агент сам выполняет связанные локальные этапы,
проверки и исправления, не запрашивая повторное разрешение на обычные шаги и
не прекращая работу после промежуточной неудачи. Каждый результат заканчивается
следующим проверяемым действием или точным внешним блокером; checkpoint
поддерживается в `TODO.md`.
Подтверждение считается действующим для неизменной комбинации Project, target,
artifact digest и операции; менять scope можно только с отдельным явным
решением. Для текущего вертикального smoke это `Server Echo Studio` и target
`local`. Пользователь разрешил Core-only update для Linux/arm64 digest
`71803f1e0c85d699dbb8a6aeb46d134cc5777e2302110a32ea949b48465eda86`; разрешение
не относится к другим бинарникам/окружениям.

При блокере агент сначала завершает все независимые безопасные пункты и
фиксирует точную ошибку/недостающий prerequisite. Вопрос задаётся только если
конкретное следующее действие невозможно без нового выбора или доступа. Эта
политика не разрешает менять production/remotes, credentials, сертификаты,
Core DB, чужие данные или неизвестные контейнеры; не разрешает push/deploy/
release и необратимую очистку без отдельного запроса. Локальные проверки и
восстанавливаемая очистка созданных smoke-тестом артефактов остаются в scope.
Для неизменного согласованного scope не задавать повторные общие вопросы о
разрешении на продолжение. Если сама платформа требует подтверждение exact
установки/запуска неизвестного software или выдачи trust непосредственно перед
действием, подготовить и проверить конкретный artifact/digest, продолжить все
независимые работы и остановиться только на этом action-time gate; не обходить
его альтернативным интерфейсом, shell или ослаблением trust policy.

## 1. Цель и словарь

Полная конфигурируемость Core и независимых сервисов из desktop Studio,
без второго Project format, обхода Core и взаимных зависимостей сервисов.

| Сущность | Публичное название | Техническое имя |
| --- | --- | --- |
| Компонент runtime, управляемый через Core | Сервис | Service, ServiceInstance, ServiceReplica |
| Регистрация, конфигурация и observability | Service SDK | service-sdk; github.com/Liapoldus/service-sdk/v2 |
| Прямой транспорт между независимыми сервисами | Wool | wool; github.com/Liapoldus/wool/v3 |
| Расширение редактора | Плагин Studio | StudioPlugin |
| Контракт разработки расширений редактора | Studio Plugin SDK | Отдельный versioned host contract |

Server, Echo, Domain, Runtime и forms-db — сервисы. «Плагин» в действующем UI
означает только расширение Studio. instanceId, replicaId, generation,
capability и application methods вроде echo.handle остаются прежними.

Control plane: Studio → typed CLI → Core Management API → Service SDK REST.
Core передаёт configuration generations и peer directory сервисам.
Data plane: Server → Wool → Echo. Core не проксирует бизнес-вызовы.

Studio/CLI работают с готовыми внешними бинарниками. CLI владеет локальным
Docker runtime, staging, контейнерами, сетями, logs и infrastructure inspect.
CLI не вызывает REST сервисов: manifest/schema/ready/identity/reload получает
Core; Studio получает только Core-backed CLI operations/reports. SDK и Wool
независимы друг от друга, Core и продуктовых сервисов. Remote deployment — CLI/CI.

## 2. Этап 0 — согласованное техническое переименование

- Снять status/branch/HEAD/remotes всех владельцев и consumers; сохранить WIP.
- Репозиторий/каталог plugin-sdk → service-sdk, Go module → github.com/Liapoldus/service-sdk/v2.
- Репозиторий/каталог pluginprotocol → wool, Go module → github.com/Liapoldus/wool/v3.
- Обновить remotes/imports/go.mod/go.work/replace/dependencies/CI/generators.
  Majors v2/v3 и нейтральный wire namespace не меняются ради имени Go-модуля.
- Перенести только активные самостоятельные runtime-service repos из прежнего
  каталога `plugins/*` в `services/*`, сохраняя `.git` и историю. Это не касается
  расширений редактора: каждый исходный пакет StudioPlugin реализуется и живёт
  только в корневом workspace-каталоге `plugins/<studio-plugin>/`; не переносить
  его в `services/` или `studio/plugins/`. Frozen captcha/identity и archive
  исключены.
- Runtime Plugin* → Service*: types, operations, JSON, events, errors, ENV,
  routes, help, UI, tests. Editor extension names уточнить до StudioPlugin*.
- CLI plugin ... → service ...; Core /api/plugins/... → /api/services/....
- Совместно обновить manifest/configuration/report schemas и Wails bindings.
- Owner docs: /services/, /service-sdk/, /wool/; расширения редактора — Studio.
  Правила терминологии добавить в инструкции и canonical owner docs.
- Domain/Runtime/forms-db: только механические imports/contract names, не
  продуктовые функции. Старые CLI/HTTP/module aliases не сохраняются.

### Сохранность данных

SQLite получает новые versioned migrations с сохранением данных, регистрации,
trust и связей; применённая история migrations не редактируется.
Project/workspace migration детерминированна, с preview и recovery originals.
Immutable configuration generations, artifact digests, исторические reports
и Git history не переписываются ради терминологии.
Studio plugins сохраняют .studio-plugin, registry, trust и sandbox.

### Gate переименования

Все active Go modules собираются отдельно и в workspace; contracts/bindings/
frontend/integration tests проходят. CLI предоставляет service ..., Core —
/api/services/..., SDK владеет универсальными healthz/metrics.
Server/Echo общаются через Wool без взаимных импортов. Migration preserves
Project/SQLite/trust. Старые runtime-имена допустимы только в архивах и коде/
fixtures migrations. Docs build проходит по новым маршрутам. Агрегатор
публикуется только после owner commits и обновления точных SHA pins.

## 3. Service SDK configuration contract

Сервис регистрирует typed descriptor: identity/versions, JSON Schema 2020-12,
отдельный declarative UI descriptor, resources, required/offered peer contracts.
SDK генерирует manifest/schema, Core получает их по REST. Peer descriptors —
opaque references: SDK не исполняет peer calls.

UI descriptor: groups/order/widgets/units/RU-EN labels/help/reference kinds.
Schema остаётся validation authority; UI hints не ослабляют constraints.
Контракт versioned, digest и compatibility bounds; cache с provenance не
подменяет live Core-backed metadata. Studio/CLI не имеют SDK REST client.

Go-host validation — jsonschema/v6 (та же семья, что Server), parity fixtures
между host/frontend/product. $ref только внутри поставленного contract bundle;
никаких arbitrary remote schema fetch. Unsupported schemas/widgets fail closed.

## 4. Generic forms

Главный редактор — полноценные контролы, не textarea с JSON:

- Nested objects/collapsible groups, maps/dictionaries.
- Arrays: add/duplicate/delete, drag reorder и keyboard alternative. Для item
  schemas со скрытыми/sensitive/readOnly полями host применяет bounded,
  versioned structural operations к canonical value; замена массива запрещена,
  скрытые поля не попадают в draft. Move/duplicate/remove и видимые leaf edits
  поддерживаются; Add использует безопасный шаблон schema и блокируется, только
  если required hidden reference нельзя инициализировать безопасно.
- oneOf/discriminator variants, conditional/dependent/required fields.
- Strings/numbers/booleans, enum/multiselect, sliders + exact numeric input,
  durations/bytes/ranges.
- Files: choose/import into Project/open external editor/metadata/publication.
  Project `certificate` import accepts only bounded public X.509 material;
  it is not a secret-reference editor and cannot contain private keys. In
  particular Server `certificateRef`/`privateKeyRef` remain opaque Core-owned
  references and must never be populated with Project paths or certificate
  bytes.
- Resources и peer refs: typed picker + drag-and-drop links из canvas;
  не hardcoded neighbour address. Peer widget сохраняет только service ID из
  текущего Project и перед записью проверяет target live manifest через typed
  CLI → Core на объявленный `peerContractId`; SDK schema принимает для этого
  widget только string. Object-valued bindings требуют отдельного явного mapping
  contract и до его появления закрыты fail-closed.
- Field errors/jump/search, dirty/conflict/unknown states.
- Secrets: opaque references; plaintext never enters renderer.

## 5. Единый draft / MVC

Inspector, canvas и specialised editor используют один draft.
Zustand models/selectors, controllers command boundary, views без прямого
filesystem/process/Core доступа. CAS-versioned mutations, undo/redo целыми
logical actions, undo apply проходит обычную validation pipeline.

Раздельно показывать Project source/draft, desired Core generation и applied
state каждой replica. External file digest conflicts pause + diff.
Partial rollout никогда не показывается как успешный rollback всех replicas.

## 6. Inspector / canvas / shell

Resizable right panel: Settings, Links, Resources, Status; search/collapsible
sections/errors jump. SDK generic fields или compatible extension projection.

Graph только services/logical links. Expanded Server показывает listeners,
endpoints/peer bindings. Route reorder меняет настоящую precedence.
Port drag создаёт typed contract binding/Core policy. Selection/focus общего
draft синхронизирован с inspector/editor. Layout — только Studio state.
Core открывается глобальным индикатором, не graph node.

Tabbed desktop workspace без внутреннего IDE и нижнего dock. Files открываются
external editor. Monochrome surfaces, оригинальный цветной logo справа —
Home-кнопка. Lucide icons, compact density, RU/EN, focus/keyboard/reduced-motion.

## 7. Studio Plugin SDK / Server extension

Host-owned versioned bridge: context, draft read/mutate с CAS, validation,
navigation, scoped files/resources, operations, declarative graph projections.
Local .studio-plugin package, explicit trust/permissions, compatibility runtime
version + contract digest. Без compatible extension работает generic renderer.

Custom UI в iframe sandbox=allow-scripts, без allow-same-origin/Wails/Node/
filesystem/credentials. Host checks source/session/version/scope/permissions/
message limits. Canvas renders host, не arbitrary extension JS.

Каждый исходный пакет расширения Studio живёт в корневом workspace-каталоге
`plugins/<studio-plugin>/` и поставляется как отдельный `.studio-plugin`.
Каталог `services/<service>/` предназначен только для runtime-сервисов. Server
editor реализуется в `plugins/studio-server/`, не размещается в
`services/server/` и не входит в runtime binary. Runtime Server, его settings
schema и HTTP contracts остаются owned в `services/server/`; пакет Studio
потребляет их через versioned Studio host bridge и Core-backed CLI metadata, не
копируя второй canonical contract. Локальные frozen service snapshots
`services/captcha/` и `services/identity/` не входят в `services/go.work` и не
имеют remotes; их не менять и не использовать как активных consumers до явной
разморозки.

Server extension даёт компактный Inspector и полноценную editor tab с typed
HTTP endpoint/request/response controls. Любое чтение/изменение Project draft,
валидация и apply выполняются только через typed host API Studio. Запрещены
прямой filesystem/Wails access, собственные Core/Service SDK HTTP clients и
обход общего Zustand draft. Минимальный `studio-service-editor/v1` bridge уже
поддерживает redacted settings read, schema-safe общий draft и сохранение
canonical Project через host при выданных разрешениях. Это не Core apply.
Пока полный security corpus и installed-package acceptance не пройдены,
расширение обязано fail-closed на неизвестные методы, scope, permission и
некорректную схему; сохранение Project нельзя показывать как применение к Core.

## 8. Server editor и API requests

Покрыть listeners/TLS/hosts/method/path matchers/static-site/reverseProxy/peer
handlers/upstreams/weights/cookies/stream limits. Candidate application atomic.

Новые request contracts: template paths + named path params; typed query/header
params с required/limits; repeat-array encoding explicit; unknown params allowed
по умолчанию, policy configurable. JSON body schema. Response status/contentType
schemas/examples. Request validation ДО handler, bounded structured client error.
Response schemas сначала documentation/example validation; live response
validator/arbitrary transformations вне этого scope.

Server config только Core/SDK, peers только Core directory. Никаких Echo imports,
hardcoded upstream/implementation dependencies.

## 9. Независимый configurable Echo

Собственная SDK schema: query parameter name, prefix, maximum text size,
JSON/text response и explicit bounded console text logging с injection protection.
Stable generic peer HTTP envelope; echo.handle сохраняется. Не знает Server.
Universal /healthz и /metrics обоих services принадлежат SDK.

## 10. Автоприменение из working tree

После 800ms inactivity apply valid draft; slider/drop commit после gesture.
Invalid/incomplete draft persists .studio, не отправляется Core. Canonical
settings save atomic. Новый typed local CLI dev workflow создаёт immutable
working-tree snapshot вместо HEAD, без implicit Git commit.

Per-target serial queue/coalesced pending snapshots, poll/watch submitted Core
operations, CAS/file digests/idempotency/safe reports; conflicts pause + diff.
Undo/redo проходит тот же workflow.

Error/partial rollout pauses, Project desired remains. Retry/rollback явные;
реальное applied state по replicas. Core promotes desired до ACK: не обещать
старую config всем replicas при failure. Offline drafts allowed; reconnection
requires confirmation diff накопленных изменений.

## 11. Core settings / ресурсы

Core operational settings имеют единственный durable source of truth — SQLite
Core, с отдельными desired/effective revisions. Studio не читает и не изменяет
Core DB и не хранит копию Core settings в Project. Изменения проходят только
через versioned typed CLI intents → Core Management API; CLI возвращает Studio
Core operation/report, а не собственное состояние-копию. Core сам применяет
изменения и подтверждает effective state.

Renderer получает только versioned `CoreSettingsView`: schema,
desired/effective revisions, pending state и значения, безопасные для UI. CLI
не передаёт в UI management token, raw credential values, private filesystem
paths, mounts или полный Core inspect. Для path-backed Core operational settings
используются стабильные локальные reference IDs из CLI-owned target registry;
CLI разрешает их непосредственно перед Core Management update. Неизвестный
reference или неподдерживаемое поле блокирует изменение, а не превращается в
raw path input. Update использует revision CAS и точный target scope; Studio не
передаёт произвольный Core JSON, shell arguments или environment values.

Service secret references are distinct from CLI Management credentials, target
references and Project resources. The owner contract is:

- The CLI credential vault stores the private material in the platform's
  credential store. A reference has a random opaque ID, safe user label,
  service ID and SDK-declared purpose; the secret bytes and local keychain
  locator never enter Project, Core metadata, argv, reports or renderer state.
- Core SQLite stores only reference metadata and active/revoked state. Its
  Management API lists, registers and revokes references under an exact service
  ID and purpose. Registration is accepted only from the typed CLI caller; Core
  returns opaque IDs/labels and never a value, host path, mount or credential
  handle. At secret-grant issuance Core verifies that the active reference is
  bound to the authenticated service and requested purpose in addition to the
  active configuration generation.
- `service-sdk` configuration UI metadata can declare an allowlisted secret
  purpose for a string field. Studio uses a host-controlled picker backed by
  the typed CLI/Core catalog; it writes only the chosen opaque reference to the
  shared Project draft. Unknown purposes, services, references and revoked
  entries fail closed. Resource/file widgets are not a substitute.
- Before local Docker Core starts, CLI resolves only references present in the
  selected immutable Project snapshot from its credential store, writes them
  into a private ephemeral staging directory, and mounts that directory
  read-only into the Core container. Core resolves opaque IDs only inside this
  mounted namespace for the existing one-use Service SDK grant; service
  containers never mount the secret directory. CLI removes staging after Core
  and runtime stop. Remote targets are not added to this Studio-local workflow.
- Creation/rotation uses a new immutable reference ID. CLI stores the material
  first and registers safe metadata second; if Core rejects registration, CLI
  deletes the just-created vault entry. Revocation disables Core grants first;
  CLI then removes the vault entry. If the second step fails, the orphaned
  vault entry remains inaccessible and a typed cleanup diagnostic is reported.

Until Core SQLite/API, CLI vault/runtime staging, Service SDK purpose metadata,
and Studio picker ship as one contract, service-secret fields remain
read-only/unavailable. Do not infer a catalog from filesystem paths, enumerate
secret directories, expose grant handles through an Admin Surface, put secret
material in Project, or pass secret bytes through the renderer. Server
`certificateRef`, `privateKeyRef` and upstream CA references are opaque Core
service-secret IDs, not Project certificate resources.

`environments/<target>.yaml` — только non-secret target profile: target ID,
тип/locality, безопасные CLI-owned references и display metadata. Это не файл
операционных настроек Core, не runtime config и не fallback при недоступности
Core. Credential values, private paths и secret material остаются в владельческих
хранилищах CLI/OS. Core bootstrap остаётся ENV/API-only по контракту Core;
Project profile не подменяет bootstrap.

Для restart-required Core changes CLI сериализует operation: validate → submit
desired settings → контролируемый restart только Core в точно выбранном local
target, если это предписано Core operation → повторное подключение → проверка
effective revision. Core не управляет собственным/чужим процессом и workloads;
restart выполняет CLI runtime adapter. Planned reconnect входит в operation,
не создаёт отдельный Studio→Core транспорт или restart loop. Destructive scope
подтверждается с указанием target и сохраняемых/заменяемых компонентов.

Resources copied into Project relative path/digest. Publication explicit:
CLI → Core → service-owned control/admin resource API. Unready refs block apply.
Secrets отсутствуют в Project/resources/plans/reports. Один canonical format.
The public-certificate importer is usable only for a manifest-declared Project
resource whose service contract expects public certificate material; it does
not satisfy Server custom TLS configuration. A Server TLS reference picker
requires the missing service-secret-reference catalog contract first.

## 12. Функциональные фазы после naming gate

1. SDK configuration/UI/resource descriptors + Core-backed metadata.
2. Common draft/generic forms/validation/working-tree CLI dev apply.
3. Studio Plugin SDK bridge/scoped host API + isolated Server extension.
4. Full Server editor/API parameter contracts + independent Echo settings.
5. Core restart/resource publication/recovery/rollback UX.
6. Studio/Docker/curl acceptance, security/docs/packaging.

Server/Echo config migrations deterministic preview/recovery, без parallel legacy
editor. Domain/Runtime и второстепенные product features отложены в owner TODO.

## 13. Acceptance / production gates

- Deterministic contract/manifest/schema parity, no secret leakage; SDK REST/
  observability conformance; Wool carrier/security conformance.
- Draft validation/CAS/undo/redo/reorder/variants/conditions/refs, keyboard/
  accessibility/RU-EN; sandbox malicious messages/scope tests.
- Working-tree без commit, coalescing/cancel/conflicts/offline confirmation,
  partial replica rollout/retry/rollback/restart tests.
- SQLite/Project migration preservation/digests/trust/recovery.
- СТРОГО через Studio: установить Server extension, зарегистрировать independent
  готовые Server/Echo binaries, отдельные Docker services через CLI, создать
  GET /echo?text=..., peer link, включить console logging.
- Обычным curl проверить happy/missing/invalid text и Echo logs; остановить Echo —
  Server остаётся запущен с peer-unavailable; восстановить Echo.
- Core config delivery, direct Server → Wool → Echo, без CLI/Core proxy,
  SDK clients в Studio/CLI и docker build/image compilation.
- Go tests/build/vet/race, reproducible contracts/bindings, frontend checks,
  macOS/Windows/Linux packaging/smoke. PASS только фактически исполненный gate.

Production-ready не объявляется до cross-repo migration, real acceptance и
cross-platform gates. Коммиты/push/releases — по отдельной авторизации.

## 14. Studio shell: local catalog and project lifecycle

This product change replaces the prior Files / Artifacts / Runtime navigation:

- Studio has no in-app file manager. Project files remain canonical CLI source
  and open through external-editor associations or typed resource pickers.
- Global Settings own installed StudioPlugin packages and trusted service
  binaries, with version/platform/digest state. The catalog is local only;
  Studio does not fetch or build packages.
- Canvas has a **Connect service** picker backed by trusted installed artifacts.
  A project service pins the chosen package version/platform. Plugin add/install
  stays subject to the existing package review and permission trust flow; the
  left rail/sidebar context menu leads to that installer.
- Docker settings live globally. CLI owns Engine and container lifecycle. A
  Run/Restart asks CLI to start Docker Engine when its client exists and daemon
  is stopped, waits for the Docker API, then reconciles all services pinned by
  the current project. It does not install Docker or cross target ownership.
- Top bar Run / Restart covers all connected project services; Debug gathers
  typed inspect and bounded logs per service. Output remains the event viewer.
- The Core-backed runtime page is removed. Core configuration remains in global
  Settings and service status/metadata remains scoped to the selected service.
- Saved workspace state advances to `workspace/v5`; recovery snapshots retain
  exact pre-migration bytes while retired Files/Artifacts/Runtime tabs are
  removed from the active view.

Cross-platform Engine auto-start is implemented through the installed platform
service entrypoint (Docker Desktop on macOS, systemd on Linux, Docker service on
Windows). Missing Docker clients and Engine startup failures remain explicit CLI
errors; Studio never silently installs or elevates Docker.
