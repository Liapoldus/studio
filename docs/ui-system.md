# UI system и рабочее пространство

## 1. Визуальная цель

Studio — спокойный light-first desktop workbench, а не IDE и не dashboard. Главный
экран помогает быстро выбрать Project; после открытия Project внимание переходит
на graph, inspector и diagnostics.

Есть две темы: `light` по умолчанию и `dark`, а preference `system` делегирует
выбор ОС. Theme preference сохраняется в global SQLite и применяется к
host-controlled tokens. Все цвета, размеры, focus states и motion задаются
design tokens, а не локальными hex-значениями в компонентах.

## 2. Application shell

### Home

- recent projects;
- add/open project;
- last revision и Git status;
- local CLI/Core toolchain status;
- installed local Studio plugins;
- application settings.

Toolchain status is a read-only local executable probe. Home shows the resolved
`liapoldus` path and version, or `CLI unavailable`; it never reads credentials,
target profiles or Core state.

### Project shell

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Project · branch · revision · validation · local Core · command palette│
├───────────────┬───────────────────────────────┬──────────────────────┤
│ Activity bar  │ Canvas / CodeMirror tabs      │ Inspector            │
│               │                               │                      │
│ project.yaml  │ runtime plugin graph         │ selected plugin       │
│ services/     │ links and diagnostics         │ settings schema       │
│ modules/      │                               │ file references      │
├───────────────┴───────────────────────────────┴──────────────────────┤
│ Problems · CLI output · Reports · Traffic · Studio plugin tools       │
└──────────────────────────────────────────────────────────────────────┘
```

Activity selection, document tabs, fixed bottom dock and navigator filters
persist as versioned `workspace/v2` state in `.studio/workspace.json`. A hidden
panel remains available through command palette and keyboard shortcuts.

Plugin nodes can be moved, selected, connected and deleted on a pan/zoom React
Flow canvas. Their finite `x`/`y` offsets are stored in the same workspace state
and restored on the next open; invalid local layout data is ignored without
changing the canonical Project. The bottom dock is fixed and only its active
panel expands.

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
- `prefers-reduced-motion` disables graph and panel transitions.

## 4. Component ownership

Built-in Studio owns:

- AppShell, TopBar, ActivityBar, Sidebar, Tree;
- Canvas, PluginNode, LinkEdge, Minimap;
- Inspector, FormField, SchemaField, FileReferencePicker;
- ProblemsPanel, LogViewer, ReportViewer, TrafficTable;
- Dialog, Popover, Select, Combobox, Tabs, Toast, CommandPalette;
- Loading, Empty, PermissionDenied, Conflict, Degraded and Error states.

Studio plugins contribute descriptors, not arbitrary renderer code. Host validates
field types, permissions, labels, descriptions and action scopes before render.

## 5. Interaction rules

- single click selects; graph handles create a versioned link contract;
- `Cmd/Ctrl+P` opens command palette; `↑/↓` navigates, `Enter` runs and `Esc`
  closes it;
- `Cmd/Ctrl+S` saves current draft;
- `Cmd/Ctrl+Shift+F` focuses project search;
- dangerous Git/Core actions require a confirmation dialog with exact scope;
- conflict view renders bounded base/ours/theirs snapshots; ours/theirs staging
  requires explicit confirmation, while manual three-way editing opens an
  external Git tool;
- Git changes expose explicit Stage/Unstage actions; commit operates only on
  staged paths, and Draft stash exposes include-untracked plus apply/drop with
  clean-tree safeguards;
- dirty state is visible in top bar and tab title; supported YAML, JSON, Markdown
  and text files open in internal CodeMirror 6 tabs with save/search/undo;
- unsaved project changes block deploy handoff;
- keyboard focus never disappears into canvas;
- every asynchronous operation has loading, success and failure feedback.
- CLI target registration requires a project-relative profile path and an exact
  confirmation; credentials remain owned by the CLI target registry.

## 6. External editor workflow

File tree actions:

1. Open with system default application.
2. Choose another application.
3. Optionally remember choice for this file type or project.
4. Show related plugin/configuration surface.

The selected application receives an absolute validated file path through a native
OS adapter. Associations are stored globally by exact relative path or glob
pattern such as `*.yaml`; matching uses the project-file basename for type-wide
rules. Studio never interpolates an untrusted path into a shell command.
