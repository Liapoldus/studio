# Liapoldus Studio

> Проектная спецификация целевой Studio. Нереализованные возможности ниже не
> являются готовыми API.

Studio — desktop-first клиент для разработчика-оператора. Она работает с
проектом и деревом файлов, подключается к Core, показывает Core services на
canvas, формирует schema-driven inspector и отслеживает операции применения.

Studio plugins — отдельный класс расширений самой Studio. Они могут добавлять
команды, страницы, панели и редакторы файлов, но не смешиваются с Core service
lifecycle.

## Владелец и границы

Документ является рабочей UX/product спецификацией Studio. Публичные контракты
Core, Plugin SDK и `pluginprotocol` остаются в их репозиториях. Studio не
создаёт вторые копии этих контрактов.

Studio:

- управляет локальным project source и file tree;
- показывает подключённые Core services и их observed state;
- валидирует локальные изменения;
- явно применяет изменения в Core через operation;
- предоставляет host для Studio plugins.

Studio не:

- запускает, останавливает или устанавливает Core services;
- является источником runtime desired state вместо Core;
- исполняет произвольный plugin HTML/JS в Core inspector;
- передаёт credentials и secrets в browser или Studio plugin.

## Карта документации

| Раздел | Содержание |
| --- | --- |
| [Продуктовая модель](product-model) | Термины, контексты, ownership и source of truth |
| [Проект и файлы](project-and-files) | Manifest, file tree, modules, validation и Apply |
| [Core workspace](core-workspace) | Shell, canvas, service nodes, links и inspector |
| [Операции](operations) | Rollout, diagnostics, problems и degraded state |
| [Studio plugins](studio-plugins) | Extension host, marketplace, capabilities и lifecycle |
| [Режимы и безопасность](security-and-modes) | Desktop/Web, permissions, secrets и failure isolation |
| [Roadmap и решения](roadmap) | Этапы реализации, acceptance criteria и открытые вопросы |

## Главная архитектурная схема

![Информационная архитектура Studio](/diagrams/studio/studio-information-architecture.svg)

## Главный принцип

В интерфейсе одновременно видны четыре независимых контекста:

1. активный project;
2. активное Core connection;
3. выбранный service или link на canvas;
4. открытые workbench tabs и Studio plugin panels.

Изменение файла является локальным draft. Изменение становится частью Core
desired state только после явного `Apply to Core` и завершения operation.

## Целевой пользовательский путь

```text
Открыть project → проверить file tree → выбрать Core connection →
увидеть services → изменить settings/module reference → Validate →
просмотреть diff → Apply → наблюдать operation → проверить replicas.
```

## Статус

Текущая Studio — каркас Wails/React и web shell. Этот раздел описывает целевую
модель, необходимую для следующих этапов проектирования и реализации.
