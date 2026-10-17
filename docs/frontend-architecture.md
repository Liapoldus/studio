# Frontend architecture

Studio frontend использует MVC-подобное разделение, адаптированное под React и
Wails. Это не классический MVC с mutable view-models: React отвечает за render,
Zustand — за observable state, а controllers — за сценарии и side effects.

```text
Wails API adapter
        │
        ▼
controllers/ ───────► stores/ (Zustand)
        │                    │
        ▼                    ▼
models/ ◄────────────── views/
```

## Boundaries

### Models

`frontend/src/models/` содержит frontend-owned типы и чистые функции:

- tabbed-модель (`Tab`, `TabKind`, `WorkspaceSnapshot`) и canvas state;
- workspace snapshot `workspace/v5` (v3/v4 recovery-aware migration removes retired file/runtime/artifact tabs);
- безопасная merge/patch-модель настроек: nested path edits, ограничение JSON,
  prototype-key rejection и удаление patch-пути при возврате к baseline;
- `view: 'workspace' | 'home' | 'settings'` вместо навигационного
  `screen: NavItem`;
- безопасный разбор layout и восстановление tabs без доступа к DOM или React
  state.

Document-модель (`DocumentState`, `documents`, `activeDocument`) удалена вместе с
встроенным редактором.

```ts
type TabKind =
  | 'canvas' | 'files' | 'git' | 'reports' | 'studio-plugins'
  | 'artifacts' | 'runtime' | 'problems' | 'output'
  | 'studio-plugin';

interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  studioPluginId?: string;   // для kind === 'studio-plugin'
  surfaceId?: string;  // id surface внутри плагина
}

interface WorkspaceSnapshot {
  schemaVersion: 'workspace/v5';
  activeTabId: string | null;
  tabs: Tab[];
  layout: LayoutState;
}
```

Неизвестная version схемы восстанавливается fail-closed: сброс к default
`workspace/v5`, а не частичный merge. Models не запускают CLI и не вызывают
Wails.

### Stores

`frontend/src/stores/` содержит один Zustand store Studio:

- workspace, project list и toolchain snapshot;
- `view`, tabs, activeTabId, selection, layout, canvas nodes/edges;
- dialogs, command palette и filters;
- diagnostics, CLI events и imported reports;
- project/service-keyed service-settings drafts: redacted baseline, изменённые
  поля, revision и состояния загрузки/сохранения/ошибки;
- pure setters и reducers. Нижний dock в state отсутствует: `problems`, `output`
  и `reports` — обычные вкладки.

Store не знает о Wails, filesystem, Git, CLI и Core. Async operations не живут
в store: это предотвращает скрытые race conditions и делает state transitions
тестируемыми.

### Controllers

`frontend/src/controllers/` содержит `StudioController`, создаваемый на один
Wails API instance. Controller:

- вызывает typed Wails adapter;
- планирует и запускает application workflows;
- открывает/фокусирует tabs и переключает `view`;
- делегирует открытие файла внешнему редактору (`selectExternalEditor` /
  `openInExternalEditor`), а не встроенному document-редактору;
- преобразует ошибки в actionable UI state;
- обновляет Zustand через явные setters;
- выполняет project persistence и восстанавливает `workspace/v5`;
- передаёт canvas mutations в Graph API и `UpdateServiceLink` для link contract;
- не содержит JSX и не зависит от конкретного view.

Все file, Git, CLI, graph, settings и link actions проходят через controller.
`openFile`, `Cmd/Ctrl+S` и document-модель в controller отсутствуют.

### Views

`frontend/src/views/` содержит dumb/presentational components. View:

- читает небольшой slice из Zustand;
- отображает состояние;
- передаёт user intent в controller или pure store action;
- не вызывает filesystem, process API или произвольный CLI.

Сюда же входят `SchemaRenderer` (`ui/schema/`) и `StudioPluginSurfaceFrame` —
schema-driven Inspector и sandboxed iframe host UI-surface.

`App.tsx` остаётся composition root: создаёт controller, подписывает lifecycle
events, выбирает `view` (`workspace | home | settings`) и монтирует shell.

## Async and consistency rules

1. Перед запуском operation controller очищает предыдущую actionable error.
2. Async результат применяется только после успешного typed API вызова.
3. Ошибка содержит конкретный path/command/context и не заменяется generic
   `unavailable`, если backend предоставил причину.
4. Workspace persistence (`workspace/v5`) best-effort и не блокирует работу;
   при неизвестной version — fail-closed сброс к default.
5. Текстовый контент файлов frontend не хранит: открытие делегируется внешнему
   редактору. Document/editor instance в state и `useRef` отсутствуют.
6. React Flow nodes/edges — UI projection canonical graph; layout хранится в
   `.studio`, source mutations проходят только через controller.
7. StudioPluginSurfaceFrame не получает Wails bindings и общается с host только через
   `postMessage`.
8. Settings Inspector, canvas и будущий service editor читают общий Zustand
   draft. Debounced patch сохраняется в локальной SQLite только после host-side
   проверки schema, чувствительных и read-only полей; полный settings document
   и secret values не сохраняются. Черновик изолирован ключом Project/service;
   typed Wails calls передают явные `projectId + serviceId`, а host открывает
   зарегистрированный Project без смены активной selection.
9. Settings snapshot включает SHA-256 исходного Project-файла. `Save to Project`
   проверяет ожидаемый digest, валидирует итоговый документ и атомарно заменяет
   canonical file. Несовпадение переводит draft в `conflict` и сохраняет patch
   для явного discard/review. Это optimistic stale-write guard с локальной
   сериализацией Studio, а не строгий межпроцессный compare-and-swap: внешний
   writer, не участвующий в протоколе, теоретически может изменить файл между
   последней проверкой и rename. После 800 ms без изменений или явного Save
   Studio валидирует и сохраняет Project, затем запускает typed `dev.apply`
   через CLI; CLI формирует content-addressed snapshot и передаёт его Core.
   При ошибке применения Project сохраняет desired settings, а оператор может
   явно повторить apply. Полная queue/recovery модель остаётся незавершённой.
10. До использования manifest UI hints host последовательно получает live
    manifest и schema через typed CLI → Core и сравнивает live schema с
    Project schema. При mismatch descriptor сбрасывается и Core apply закрыт;
    offline изменения остаются только локальными и не считаются применёнными.
    Явная повторная проверка перечитывает Project schema, redacted values и
    persisted patch, сохраняя несохранённую работу.

## Folder contract

```text
frontend/src/
├── api/          # typed Wails adapter and generated models
├── controllers/  # workflows and side effects
├── models/       # pure frontend models and copy
├── stores/       # Zustand state and pure reducers
├── views/        # React views for shell/features (Home, Settings, tabs)
├── ui/           # shared visual primitives (future extraction point)
│   ├── schema/   # schema-driven field renderers for the Inspector
│   └── frames/   # StudioPluginSurfaceFrame sandboxed iframe host
└── App.tsx       # composition root only
```

Новый workflow добавляется в controller и покрывается controller/API contract
test. Новый визуальный элемент добавляется во view/ui и не получает прямой
доступ к Wails generated bindings.
