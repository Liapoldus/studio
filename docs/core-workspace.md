# Core workspace

## 1. Shell

Core workspace — основной canvas-first экран Studio.

```mermaid
flowchart LR
    A["Activity bar"] --> B["Project / services navigator"]
    B --> C["Central service canvas"]
    C --> D["Selected service or link"]
    D --> E["Right inspector"]
    C --> F["Bottom operations panel"]
    G["Top bar: project + Core + target"] --> C
    H["Workbench tabs"] --> C
```

Зоны:

- activity bar — переключение разделов;
- top bar — project, Core connection, target, search, operation summary;
- navigator — files и services;
- canvas — nodes и links;
- inspector — выбранный node/link;
- bottom panel — operations, problems, events;
- workbench tabs — Core workspace и Studio plugin pages.

По умолчанию виден canvas. Navigator и bottom panel скрываемы. Inspector
открывается при выборе объекта.

## 2. Страницы

### Start / Connections

Показывает сохранённые desktop connections и состояние подключения. Для web
показывает только bootstrap-bound Core и не предлагает сменить endpoint.

### Project workspace

Показывает file tree, project metadata, validation и drafts.

### Core workspace

Показывает canvas сервисов, links и inspector.

### Services

Показывает inventory services в таблице с фильтрами и переходом в canvas.

### Operations

Показывает durable operations, ACKs, errors и degraded states.

### Marketplace

Показывает только Studio plugins: Discover, Installed, Updates и Details.

### Settings

Показывает Studio connections, project preferences, layout и plugin permissions.

## 3. Canvas

На canvas отображаются:

- Core service nodes;
- Core-owned service links;
- readiness/status badges;
- generation/rollout indicators;
- project binding markers;
- selection и focus.

Сам Core, Core database, credentials и plugin internals на canvas не рисуются.

### Service node

Минимум:

- display name;
- stable service id;
- type/manifest version;
- readiness;
- active generation;
- problem badge;
- project binding.

Click выбирает node и открывает inspector. Double-click переводит фокус в
settings section inspector.

### Link

Link создаётся drag-жестом между двумя service nodes. Inspector показывает:

- caller;
- target;
- link id;
- observed state;
- policy generation;
- generic contract/transport metadata, если оно доступно Core.

Product-specific routing и payload editor в общий Studio inspector не входят.

### Layout

Положение node — локальное представление Studio, а не автоматически Core-owned
configuration. Доступны move, multi-select, zoom/pan, fit to content, focus from
tree/search и reset local layout.

## 4. Service inspector

Секции inspector:

1. identity — name, id, manifest version;
2. settings — schema-generated fields;
3. source binding — project file/module references;
4. replicas — health, lease, generation, incarnation;
5. rollout — operation и ACK state;
6. links — входящие и исходящие связи;
7. context — безопасные timestamps и actor metadata.

Поддерживаемые UX-типы полей: string, number, boolean, select, multiselect,
duration, size, code/reference, file, directory, array/object и secret
reference без возврата secret value.

Неизвестный тип поля делает surface недоступным с diagnostic, а не превращается
в произвольный HTML control.

## 5. Link inspector

Показывает generic данные:

- caller и target;
- link id;
- policy generation;
- eligibility;
- contract compatibility;
- transport/profile;
- operation history.

Общий inspector не знает product-specific методы и payloads.

## 6. Services workspace

Таблица services должна показывать:

- service id/name;
- manifest/schema version;
- health/readiness;
- active generation;
- replica count;
- lease state;
- rollout/operation state;
- local project binding.

Таблица и canvas используют один Core read model и не создают второй источник
истины.
