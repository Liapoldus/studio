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

- document, navigation, dock и canvas state;
- workspace snapshot `workspace/v2`;
- безопасный разбор layout;
- восстановление tabs без доступа к DOM или React state.

Models не запускают CLI и не вызывают Wails.

### Stores

`frontend/src/stores/` содержит один Zustand store Studio:

- workspace, project list и toolchain snapshot;
- tabs, selection, layout, canvas nodes/edges;
- dialogs, command palette, dock и filters;
- diagnostics, CLI events и imported reports;
- pure setters и reducers.

Store не знает о Wails, filesystem, Git, CLI и Core. Async operations не живут
в store: это предотвращает скрытые race conditions и делает state transitions
тестируемыми.

### Controllers

`frontend/src/controllers/` содержит `StudioController`, создаваемый на один
Wails API instance. Controller:

- вызывает typed Wails adapter;
- планирует и запускает application workflows;
- преобразует ошибки в actionable UI state;
- обновляет Zustand через явные setters;
- выполняет project persistence и восстанавливает workspace;
- передаёт canvas mutations в Graph API;
- не содержит JSX и не зависит от конкретного view.

Все file, Git, CLI, graph и settings actions проходят через controller.

### Views

`frontend/src/views/` содержит dumb/presentational components. View:

- читает небольшой slice из Zustand;
- отображает состояние;
- передаёт user intent в controller или pure store action;
- не вызывает filesystem, process API или произвольный CLI.

`App.tsx` остаётся composition root: создаёт controller, подписывает lifecycle
events, выбирает active workspace view и монтирует shell.

## Async and consistency rules

1. Перед запуском operation controller очищает предыдущую actionable error.
2. Async результат применяется только после успешного typed API вызова.
3. Ошибка содержит конкретный path/command/context и не заменяется generic
   `unavailable`, если backend предоставил причину.
4. Workspace persistence best-effort и не блокирует редактирование файла.
5. CodeMirror instance живёт в `useRef`; document content живёт в Zustand.
   Изменение текста не пересоздаёт editor и не теряет cursor/undo history.
6. React Flow nodes/edges — UI projection canonical graph; layout хранится в
   `.studio`, source mutations проходят только через controller.

## Folder contract

```text
frontend/src/
├── api/          # typed Wails adapter and generated models
├── controllers/  # workflows and side effects
├── models/       # pure frontend models and copy
├── stores/       # Zustand state and pure reducers
├── views/        # React views for shell/features
├── ui/           # shared visual primitives (future extraction point)
└── App.tsx       # composition root only
```

Новый workflow добавляется в controller и покрывается controller/API contract
test. Новый визуальный элемент добавляется во view/ui и не получает прямой
доступ к Wails generated bindings.
