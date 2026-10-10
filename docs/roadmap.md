# Roadmap, acceptance criteria и границы готовности

Roadmap описывает production-ready desktop Studio. Реализация идёт
вертикальными срезами: каждый срез должен оставлять работающий offline desktop
workspace, typed Wails boundary и тестируемый контракт. Отсутствующий Core/CLI
не блокирует разработку shell и source workspace.

## 1. Этапы реализации

### Этап 0. Architecture freeze

- канонический CLI Project contract и ownership map;
- typed CLI JSON/JSONL events, reports и provenance;
- manifest/schema/link-contract Studio plugin host;
- redaction annotations и traffic report contract;
- product, security, UI, release и cross-platform documents.

### Этап 1. Desktop shell и design system

- Wails-only desktop bootstrap для macOS, Windows и Linux;
- Home, Settings и Project shell;
- собственные tokens, light-first/dark themes и headless primitives;
- command palette, keyboard/focus/accessibility и reduced motion;
- loading, empty, error и degraded states.

### Этап 2. Project и Git workspace

- discovery/open/import canonical Project;
- project/file tree с `.studio/` boundary;
- безопасное чтение/запись project-owned files;
- native Git status, diff, history, branches, commit, push/pull;
- conflict state и `.studio` layout/workspace persistence;
- external editor associations без встроенного IDE.

### Этап 3. Canvas и configuration workspace

- runtime plugin graph: только plugin instances и plugin-to-plugin links;
- layout, selection, focus и validation badges;
- schema-driven settings forms для `settings.json`;
- полный link contract editor для `links/*.json`;
- compatibility, diagnostics и generated safe references;
- Core не показывается отдельным canvas node.

### Этап 4. CLI и local Core workflow

- typed `CliRunner`, JSONL parser и cancellation/timeout;
- local `validate`, `plan`, `apply` и Core start/stop/status/logs через CLI;
- target catalog и operation progress;
- report import с commit/target/bundle/CLI/Core provenance;
- remote deployment только exact CLI handoff, без remote execution из Studio.

### Этап 5. Local Studio plugin host

- local `.studio-plugin` file import и manifest validation;
- explicit trust dialog, version/signature/digest metadata и rollback;
- declarative pages, panels, inspectors, forms и commands;
- out-of-process companion tools с Tool Registry policy;
- permission grants, cancellation, limits, crash/timeout isolation.

### Этап 6. Traffic inspector

- CLI/Core observation report ingestion;
- schema annotation based redaction до UI и `.studio/` persistence;
- timeline/table/payload/schema views;
- filters по plugin, method, status, latency и time;
- safe diagnostic export без secrets и live Studio→Core connection.

### Этап 7. Production packaging

- macOS bundle, signing и notarization;
- Windows installer, WebView2 prerequisite, signing и upgrade path;
- Linux AppImage и package artifact;
- migrations, crash diagnostics, release channels и reproducible builds;
- cross-platform packaged smoke tests и release evidence.

## 2. Acceptance criteria

Целевая production-ready модель считается достигнутой, если:

- Studio запускается только как desktop application и открывает Project offline;
- canonical CLI Project редактируется без второго project format;
- branch, exact revision и dirty state видны явно;
- canvas показывает только runtime plugins и связи между ними;
- plugin settings и полный link contract редактируются schema-driven;
- traffic view строится только из CLI/Core report и показывает redacted payloads;
- внешний системный IDE открывает выбранный файл;
- local Core workflow выполняется через `liapoldus` child process;
- remote deployment отсутствует в Studio и передаётся CLI/CI;
- local Studio plugins импортируются package-файлом с explicit trust;
- plugin UI declarative, tools out-of-process, plugin failure изолирован;
- credentials и secrets не попадают в frontend, plugin UI или persisted reports;
- package/build/smoke matrix проходит на macOS, Windows и Linux;
- product, architecture, UI, CLI, plugin, traffic, security и release decisions
  описаны в Studio docs.

## 3. Принятые решения

1. Project format принадлежит CLI; Studio лишь читает и редактирует его source.
2. `.studio/` — локальное состояние Studio, не часть bundle и не secret store.
3. Canvas показывает plugins и links; Core не является отдельным узлом.
4. Link editor работает с полным versioned contract, а не с декоративным edge.
5. Local debugging разрешён через CLI; прямой Core API adapter запрещён.
6. Remote deployment остаётся CLI/CI responsibility.
7. Studio plugins устанавливаются локально; remote marketplace registry не входит
   в первую production scope.
8. Production plugin UI — только declarative host-controlled surfaces.
9. Companion tools запускаются без arbitrary shell и с declared permissions.
10. Base Studio не содержит IDE; code/module editors принадлежат specialized
    plugins или внешним приложениям.

## 4. Definition of done по срезу

Срез считается готовым, если его Go port/application code, Wails binding,
frontend state/UI, negative/error states, tests и documentation обновлены вместе.
Нельзя считать этап завершённым по одному нарисованному экрану или stub API.

## 5. Document status

Этот файл фиксирует целевую архитектуру и порядок реализации. Он не утверждает,
что все этапы уже реализованы. Текущую фактическую готовность следует проверять
по git diff, тестам и разделам технической архитектуры.
