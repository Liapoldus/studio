# UI system и рабочее пространство

## 1. Визуальная цель

Studio — спокойный light-first desktop workbench, а не классический IDE: у него
нет встроенного текстового редактора. Главный экран помогает быстро выбрать
Project; после открытия Project внимание переходит на graph, inspector и
diagnostics.

Есть две темы: `light` по умолчанию и `dark`, а preference `system` делегирует
выбор ОС. Theme preference сохраняется в global SQLite и применяется к
host-controlled tokens. Все цвета, размеры, focus states и motion задаются
design tokens, а не локальными hex-значениями в компонентах.

## 2. Application shell

Оболочка — Zed-style frameless окно с tabbed workspace. Одна оболочка на всё
приложение; `view` переключает `workspace | home | settings`.

### Верхняя панель (Top Bar)

Top bar монтируется **всегда** (frameless окну нужны постоянные window controls
и drag region). Workspace switcher и TabStrip показываются только при открытом
проекте; в Home/Settings они скрыты.

- окно — `Frameless` + кастомный top bar;
- macOS — нативные traffic lights (`Mac.TitleBarHiddenInset()`, слева), без
  собственных кнопок;
- Windows/Linux — собственные 3 кнопки слева (закрыть/развернуть/свернуть);
- top bar — drag region; интерактивные контролы из drag исключены;
- Home и Settings — входы в глобальные страницы;
- workspace switcher — переключатель проекта;
- логотип Studio.

### Home

Home — стартовый экран без активного проекта:

- recent projects;
- open/create project;
- project availability and local CLI/Core toolchain status;
- local CLI/Core toolchain status;
- installed local Studio plugins;
- вход в Settings.

Toolchain status is a read-only local executable probe. Home shows the resolved
`liapoldus` path and version, or `CLI unavailable`; it never reads credentials,
target profiles or Core state.

### Settings

Settings — глобальная полноэкранная страница в области контента (top bar
остаётся; вкладкой не является). Разделы:

- **Editor** — внешний редактор: OS default, глобальный редактор и per-mask
  ассоциации;
- **Appearance** — тема (`light`/`dark`/`system`);
- **Language**;
- **Toolchain & CLI**;
- **Local Core**.

### Workspace shell

`workspace = проект/папка` (модель Zed). Открытие проекта переводит приложение в
workspace: workspace switcher = переключатель проекта.

```text
┌───────────────────────────────────────────────────────────────────────┐
│ ● ● ●   [Home] [Settings]  │  <project> ▾   │   tabs…            [logo] │  TopBar (drag)
├───────────────────────────────────────────────────────────────────────┤
│ [Canvas][Files][Reports][Plugins][Artifacts][Runtime] │ [Problems] │  TabStrip
│ [Output] │ plugins…                                                    │
├──────┬────────────────────────────────────────────────────┬───────────┤
│ rail │                Workbench (active tab)               │ Inspector │
│      │                                                    │           │
└──────┴────────────────────────────────────────────────────┴───────────┘
```

- **Workspace switcher**: recent projects, открыть проект, создать проект,
  путь/действия проекта. Пункт «закрыть проект» заменён на действия проекта.
- **TabStrip**: активная рабочая вкладка, закрытие, drag-reorder, горизонтальный
  скролл. Вкладки закрываемые; pin отсутствует.
- **Левая rail**: кнопки-открыватели вкладок — Canvas, Reports,
  Problems, Output. ПКМ по rail/sidebar даёт действие «Добавить плагин».
  На Canvas есть «Подключить сервис», а в верхней панели — Run/Restart/Debug.
  После разделителя — кнопки
  общих `workspace` surfaces последней установленной версии Studio-плагинов. Нажатие открывает вкладку,
  повторное — фокусирует уже открытую.
- **Инспектор**: правый schema-driven property editor (см. ниже).
- Нижний dock **отсутствует**. `Problems`, `Output` и `Reports` — обычные
  вкладки workbench.

Вкладки персистятся как versioned `workspace/v5` в project-local
`.studio/workspace.json`. Глобальные Settings управляют версиями установленных
Studio-плагинов и сервисных бинарников, а canvas подключает выбранную доверенную
версию из локального каталога. File Manager и отдельная runtime-страница удалены.
Восстановление fail-closed: неизвестная version схемы
сбрасывает состояние к default, а не выполняет частичный merge. Недопустимые
локальные layout-данные игнорируются без изменения canonical Project.

В **Настройки → Плагины → Редакторы сервисов** пользователь назначает кнопке
из `service-editor-buttons/v1` страницу установленного плагина с контекстом
`service`. Кнопки поступают из live manifest сервисов открытого проекта через
typed CLI. Раздел виден и до получения метаданных: он предлагает запустить
сервисы и обновить список. Назначения глобальны и сохраняются при временном
отсутствии кнопки в текущем проекте. В списке показываются только страницы
последней установленной версии; недоступное назначение можно снять.
Inspector показывает назначенную кнопку, открывающую вкладку с точным
контекстом проекта и сервиса. Редактор endpoints Server находится в этой
вкладке.

Service nodes can be moved, selected, connected and deleted on a pan/zoom React
Flow canvas. Their finite `x`/`y` offsets are stored in the same workspace state
and restored on the next open.

### Inspector

Правый inspector — schema-driven property editor уровня Figma/Unity, а не набор
ручных полей. Для service-узла и для link-узла он показывает collapsible-секции:

1. **Identity / Info** — read-only: id, name, service, version, manifest, source;
2. **Settings** — форма по JSON Schema (draft 2020-12) из `readProjectSchema`;
   до применения live UI hints Studio сверяет эту схему с Core-backed
   `service.schema`, полученной через typed CLI. Drift блокирует edits и Core
   apply, сохраняя draft; при offline работе доступно только сохранение в Project
   с последующей явной перепроверкой. Backend validation/merge/redaction
   переиспользуется. Секреты отдаются только redacted (`secret-ref`); raw secret
   values не ходят во frontend. Для массивов с protected полями доступна
   перестановка, дублирование, удаление и редактирование видимых полей без
   передачи скрытых values. Typed resource picker поддерживает
   `service-admin` catalogs и host-owned Project file/public certificate
   references; содержимое файлов и приватные ключи не передаются. Peer widget
   для строкового поля показывает только сервисы текущего Project; до записи
   выбранный ID проверяется по live manifest целевого сервиса через typed CLI →
   Core на наличие указанного `peerContractId`. Адреса не раскрываются, Core не
   проксирует peer calls. Object-valued peer bindings и создание protected
   object-array items остаются неподдержанными;
3. **Link contract** — полное редактирование link-полей;
4. **Source binding** — где в проекте определён service/link (path, module ref);
5. **Last deploy** — последний импортированный CLI/Core report (redacted);
6. **Context** — project;
7. **Actions** — Run / Restart / Logs / Inspect (typed CLI intents, ephemeral
   status; при недоступности CLI/Core — `unknown`).

Schema-renderer (`frontend/src/ui/schema/`) поддерживает типы полей: `string`,
`number`, `boolean`, `select`, `multiselect`, `duration`, `size`, `file`, `dir`,
`array`, `object`, `secret-ref`. Неизвестный тип поля помечает секцию
`unavailable` (fail-closed), без угадывания.

## 3. Design tokens

- spacing: 4px base, 8px primary grid;
- radius: 6px controls, 8px cards, 10px dialogs;
- typography: Inter with system fallback;
- compact control height: 32px;
- standard control height: 36px;
- dense table row: 32px;
- semantic colors: info, success, warning, danger, degraded, muted;
- visible focus ring on every interactive control;
- no color-only status communication;
- `prefers-reduced-motion` disables graph, tab и panel transitions.

## 4. Component ownership

Built-in Studio owns:

- AppShell, TopBar, TabStrip, Rail, Tree;
- Home и Settings pages;
- Canvas, ServiceNode, LinkEdge, Minimap;
- Inspector, FormField, SchemaField, FileReferencePicker;
- SchemaRenderer (`frontend/src/ui/schema/`);
- ProblemsView, LogViewer, ReportViewer, TrafficTable;
- StudioPluginSurfaceFrame (sandboxed iframe host для UI Studio-плагина);
- Dialog, Popover, Select, Combobox, Tabs, Toast, CommandPalette;
- Loading, Empty, PermissionDenied, Conflict, Degraded and Error states.

Studio plugins contribute descriptors, not arbitrary renderer code. Host validates
field types, permissions, labels, descriptions and action scopes before render.
Исключение — explicit UI-surface плагина: он исполняется только в sandboxed
`<iframe sandbox="allow-scripts">` (без `allow-same-origin`/popups/forms), без
доступа к Wails bindings, файловой системе и Node; обмен — только через
`postMessage` bridge. UI-surface, manifest и host bridge принадлежат
Studio Plugin SDK/Studio host contract; Service SDK и Wool не загружают и не
исполняют Studio extensions.

## 5. Interaction rules

- single click selects; graph handles create a versioned link contract;
- single click по файлу в дереве открывает внешний редактор; встроенного
  текстового редактора и document-вкладок нет;
- `Cmd/Ctrl+P` opens command palette; `↑/↓` navigates, `Enter` runs and `Esc`
  closes it;
- `Cmd/Ctrl+Shift+F` focuses project search;
- управление версиями и историей исходников выполняется внешними инструментами;
- dirty settings/draft state видно в top bar и заголовке вкладки; сохранение
  файлового текста Studio не выполняет — это ответственность внешнего редактора;
- keyboard focus never disappears into canvas;
- every asynchronous operation has loading, success and failure feedback.
- CLI target registration requires a project-relative profile path and an exact
  confirmation; credentials remain owned by the CLI target registry.

## 6. External editor workflow

Встроенный редактор удалён полностью. Клик по файлу в дереве делегирует открытие
внешнему редактору, а не открывает вкладку внутри Studio.

File tree actions:

1. Single click по файлу → открыть внешним редактором.
2. OS default application.
3. Глобальный редактор (Settings → Editor).
4. Per-mask ассоциации (точный относительный путь или glob, например `*.yaml`)
   с add/remove.
5. Show related plugin/configuration surface.

The selected application receives an absolute validated file path through a native
OS adapter. Associations are stored globally by exact relative path or glob
pattern such as `*.yaml`; matching uses the project-file basename for type-wide
rules. Studio never interpolates an untrusted path into a shell command.
