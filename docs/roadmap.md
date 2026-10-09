# Roadmap, acceptance criteria и открытые решения

## 1. Этапы реализации

### Этап 0. Product shell

- project/connection context model;
- file tree shell;
- canvas shell;
- inspector shell;
- operations shell;
- loading/empty/error states.

### Этап 1. Core read model

- desktop connections;
- Core service inventory;
- canvas nodes/links;
- service observations;
- operations list;
- refresh/stale handling.

### Этап 2. Project source model

- project manifest;
- root directory selection;
- file indexing;
- local validation;
- service/module references;
- diff against Core desired state.

### Этап 3. Apply workflow

- schema-driven settings inspector;
- draft/save/validate;
- explicit Apply;
- operation polling;
- degraded/failed diagnostics;
- reconcile guidance.

### Этап 4. Studio plugin host

- extension manifest discovery;
- commands/pages/panels;
- capability consent;
- failure isolation;
- contextual file opening.

### Этап 5. Marketplace

- catalog;
- details;
- install/update/remove;
- compatibility;
- permissions;
- lifecycle state machine.

### Этап 6. Specialized editors

- Logic Modules plugin;
- module/source editor;
- schema-aware editors;
- plugin-specific validation;
- project artifact preview.

## 2. Acceptance criteria

Целевая модель считается согласованной, если:

- у Studio есть project context и file tree;
- project не смешан с Core connection;
- Core остаётся runtime source of truth;
- local source, desired state и observed state видны раздельно;
- canvas показывает Core services, но не Core как node;
- service settings открываются в schema-driven inspector;
- service links не становятся product-specific routing editor;
- operations показывают фактический rollout result;
- Core process lifecycle не выглядит управляемым из Studio;
- Studio plugins отделены от Core services;
- marketplace управляет только Studio plugins;
- module/code editor принадлежит специализированному plugin;
- plugin failure не ломает Core workspace;
- опасные действия имеют scope, permission и confirmation;
- страницы имеют empty/loading/error/degraded states;
- web ограничения не маскируются под desktop возможности.

## 3. Вопросы, которые нужно утвердить

1. Точный формат project manifest и его владелец.
2. Может ли один project иметь несколько `environment → Core` mappings.
3. Какие типы файлов являются базовыми, а какие полностью принадлежат Studio
   plugins.
4. Где физически запускаются Studio plugin services.
5. Кто владеет install/update/start/stop lifecycle Studio plugins.
6. Формат и trust model marketplace packages.
7. Capability consent и authorization model для Studio plugins.
8. Безопасный способ работы web с project files.
9. Связь local source с plugin-owned settings schemas.
10. Допустимый уровень bidirectional sync между project и Core.
11. Как показывать v1 Core state до полного v2 rollout API.
12. Нужна ли отдельная audit page или достаточно Operations workspace.

## 4. Документный статус

До утверждения вопросов выше этот раздел является target UX/product model. Он
не добавляет runtime API, SQLite tables, plugin SDK endpoints или process
control в текущую Studio.
