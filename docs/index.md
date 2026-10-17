# Liapoldus Studio

[Миграция Services, StudioPlugins и project-local workspace](nomenclature-migration).

> Проектная спецификация целевой Studio. Нереализованные возможности ниже не
> являются готовыми API.

Studio — desktop-first среда разработки для разработчика-оператора. Она работает
с проектом и деревом файлов, формирует schema-driven editors и готовит
версионируемые конфигурации для универсального `liapoldus` CLI.

Studio работает с локальным Core и runtime через typed-команды `liapoldus` CLI.
Control plane остаётся таким: Studio → CLI → Core Management API → Service SDK
REST. Studio не содержит Core API/Service SDK REST-клиента и получает
Core-backed status, manifest, schema, operations и reports только из ответов
CLI. Локальный Docker runtime также управляется CLI; remote deployment остаётся
ответственностью CLI/CI.

Studio plugins — отдельный класс расширений самой Studio. Они могут добавлять
команды, страницы, панели и редакторы файлов, но не смешиваются с Core service
lifecycle.

## Владелец и границы

Документ является рабочей UX/product спецификацией Studio. Публичные контракты
Core, Service SDK и `wool` остаются в их репозиториях. Studio не
создаёт вторые копии этих контрактов.

Studio:

- управляет локальным project source и file tree;
- валидирует локальные изменения;
- не содержит встроенного управления версиями; исходники и их история
  управляются внешними инструментами;
- вызывает предусмотренные typed CLI workflows для локального Core/runtime;
- показывает Core-backed service metadata, status, operations и reports,
  полученные от CLI;
- предоставляет host для Studio plugins.

Studio не:

- вызывает Core Management API или Service SDK REST напрямую;
- принимает произвольные CLI args, Docker-команды или shell strings от UI;
- выполняет production/remote deployment самостоятельно;
- передаёт credentials и secrets в frontend или Studio plugin. UI Studio-плагинов
  исполняется в строго sandboxed iframe (см. выше).

## Карта документации

| Раздел | Содержание |
| --- | --- |
| [Продуктовая модель](product-model) | Термины, контексты, ownership и source of truth |
| [Проект и файлы](project-and-files) | Manifest, file tree, modules и local validation |
| [Техническая архитектура](technical-architecture) | Go/React/Wails layers, ports, state и failure boundaries |
| [UI system](ui-system) | Shell, canvas, inspector, panels, tokens и interaction rules |
| [Service workspace](core-workspace) | Runtime service graph, full links и schema-driven inspector |
| [Операции](operations) | Local validation, CLI reports и deploy diagnostics |
| [CLI integration](cli-integration) | Process boundary, JSONL events, local Core и remote handoff |
| [Studio plugins](studio-plugins) | Extension host, marketplace, capabilities и lifecycle |
| [Traffic inspector](traffic-inspector) | Observation reports, redaction и protocol diagnostics |
| [Docker runtime](docker-runtime) | Local Docker provider, runtime manifest и trust boundary |
| [Service build — удалён](build-workspace) | Сборка остаётся во внешнем SDK/CI; Studio использует готовые binaries |
| [Production readiness](production-readiness) | Release evidence, security gates и promotion policy |
| [Режимы и безопасность](security-and-modes) | Desktop, permissions, secrets и failure isolation |
| [Production release](release) | Platform packaging, reproducibility, QA и recovery |
| [Roadmap и решения](roadmap) | Этапы реализации, acceptance criteria и принятые решения (см. также [план конфигуратора](plan)) |

## Главная архитектурная схема

![Информационная архитектура Studio](/diagrams/studio-information-architecture.svg)

## Главный принцип

- **Tabbed workspace** (Zed-style): всё — вкладки, активити-rail как открыватели
вкладок, закрываемые/drag-reorder вкладки персистятся по схеме `workspace/v5`
  в `.studio/workspace.json` (без pin). Top bar — frameless, Home — стартовый экран
  без проекта, Settings — глобальная полноскролл-страница.
- Файловое открытие — одиночный клик → внешний редактор (OS default + глобальный
  + per-mask ассоциации). CodeMirror не используется.

В интерфейсе одновременно видны четыре независимых контекста:

1. активный project;
2. выбранный runtime service или link в project config graph;
3. открытые workbench tabs и Studio plugin panels.

Изменения сначала являются локальным draft, затем сохраняются в canonical
Project. Для локальной отладки Studio запускает typed CLI workflow выбранного
target. Production/remote deployment остаётся за CLI/CI.

## Целевой пользовательский путь

```text
Открыть Project → изменить service configuration → Validate → сохранить Project
→ проверить локальный target через Studio/typed CLI → проверить endpoint и logs.
Для remote release: подготовить source внешними инструментами → выполнить
deployment через CLI/CI → открыть report в Studio.
```

## Статус

Studio уже содержит desktop shell, работу с Project, typed CLI boundary,
Core-backed service workspace и runtime UI, общий configuration draft и host
для локальных Studio plugins. Это не означает завершённую production readiness:
сквозные recovery, resource publication, полная проверка сервисных контрактов,
упаковка и cross-platform gates остаются открытыми. Актуальные доказательства и
блокеры фиксируются в `TODO.md` и `plan.md` репозитория Studio.
