# Roadmap, acceptance criteria и открытые решения

## 1. Этапы реализации

### Этап 0. Product shell

- project/revision context model;
- file tree shell;
- canvas shell;
- inspector shell;
- operations shell;
- loading/empty/error states.

### Этап 1. Project config read model

- project service inventory;
- canvas nodes/links;
- schema and validation diagnostics;
- last known CLI/CI reports;
- report import and stale handling.

### Этап 2. Project source model

- project manifest;
- root directory selection;
- file indexing;
- local validation;
- service/module references;
- diff against selected Git revision and imported deploy report.

### Этап 3. Git и version control

- local repository always enabled;
- multiple remotes;
- branch switching and history;
- commit/push/pull;
- merge/rebase/cherry-pick/stash;
- conflict resolution;
- version-management page.

### Этап 4. CLI handoff

- schema-driven settings inspector;
- draft/save/validate;
- commit-gated plan/apply handoff;
- CLI/CI report import;
- degraded/failed report diagnostics;
- target/revision provenance.

### Этап 5. Studio plugin host

- extension manifest discovery;
- commands/pages/panels;
- capability consent;
- failure isolation;
- contextual file opening.

### Этап 6. Marketplace

- catalog;
- details;
- install/update/remove;
- compatibility;
- permissions;
- lifecycle state machine.

### Этап 7. Specialized editors

- Logic Modules plugin;
- module/source editor;
- schema-aware editors;
- plugin-specific validation;
- project artifact preview.

## 2. Acceptance criteria

Целевая модель считается согласованной, если:

- у Studio есть project context и file tree;
- project не смешан с Core connection;
- Git Project остаётся source of source configuration;
- Core SQLite остаётся source of applied runtime state;
- local source, desired state и observed state видны раздельно;
- canvas показывает Core services, но не Core как node;
- service settings открываются в schema-driven inspector;
- service links не становятся product-specific routing editor;
- deploy reports показывают фактический rollout result;
- Core process lifecycle не выглядит управляемым из Studio;
- Studio не имеет Core API adapter;
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
