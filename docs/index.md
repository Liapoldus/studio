# Liapoldus Studio

> Проектная спецификация целевой Studio. Нереализованные возможности ниже не
> являются готовыми API.

Studio — desktop-first среда разработки для разработчика-оператора. Она работает
с проектом, деревом файлов и Git, формирует schema-driven editors и готовит
версионируемые конфигурации для универсального `liapoldus` CLI.

Studio не подключается к Core. Подключение target, plan, apply и наблюдение за
runtime выполняются отдельным CLI локально или в CI; Studio может показывать
импортированный безопасный report о результате.

Studio plugins — отдельный класс расширений самой Studio. Они могут добавлять
команды, страницы, панели и редакторы файлов, но не смешиваются с Core service
lifecycle.

## Владелец и границы

Документ является рабочей UX/product спецификацией Studio. Публичные контракты
Core, Plugin SDK и `pluginprotocol` остаются в их репозиториях. Studio не
создаёт вторые копии этих контрактов.

Studio:

- управляет локальным project source и file tree;
- валидирует локальные изменения;
- предоставляет полноценную Git-интеграцию;
- создаёт только commit-backed project revisions;
- показывает target/deploy reports, полученные от CLI;
- предоставляет host для Studio plugins.

Studio не:

- создаёт runtime targets и не вызывает Core API;
- выполняет plan/apply/deploy;
- показывает runtime observations как собственные live-данные;
- исполняет произвольный plugin HTML/JS в Core inspector;
- передаёт credentials и secrets в browser или Studio plugin.

## Карта документации

| Раздел | Содержание |
| --- | --- |
| [Продуктовая модель](product-model) | Термины, контексты, ownership и source of truth |
| [Проект и файлы](project-and-files) | Manifest, file tree, modules и local validation |
| [Git и версии](version-control) | Repository, branches, commits, remotes и version page |
| [Core workspace](core-workspace) | Shell, config graph, service nodes, links и inspector |
| [Операции](operations) | Local validation, CLI reports и deploy diagnostics |
| [Studio plugins](studio-plugins) | Extension host, marketplace, capabilities и lifecycle |
| [Режимы и безопасность](security-and-modes) | Desktop/Web, permissions, secrets и failure isolation |
| [Roadmap и решения](roadmap) | Этапы реализации, acceptance criteria и открытые вопросы |

## Главная архитектурная схема

![Информационная архитектура Studio](/diagrams/studio-information-architecture.svg)

## Главный принцип

В интерфейсе одновременно видны четыре независимых контекста:

1. активный project;
2. активный Git revision/branch;
3. выбранный service или link в project config graph;
4. открытые workbench tabs и Studio plugin panels.

Изменение файла является локальным draft. Изменение становится deployable только
после commit; Core desired state меняется позже отдельным запуском CLI для
выбранного target.

## Целевой пользовательский путь

```text
Открыть project → проверить file tree → изменить settings/module reference →
Validate → просмотреть Git diff → commit → push в approved remote → запустить
CLI plan/apply для target → открыть deploy report.
```

## Статус

Текущая Studio — каркас Wails/React и web shell. Этот раздел описывает целевую
модель, необходимую для следующих этапов проектирования и реализации.
