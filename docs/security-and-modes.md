# Безопасность и режимы работы

## 1. Основные invariants

- secrets не хранятся в project source без отдельного утверждённого механизма;
- credentials не передаются Studio plugin напрямую;
- plugin получает только declared capabilities;
- Studio не вызывает Core API;
- CLI/CI получает target credentials через отдельный secure provider;
- Studio не получает Core credentials;
- Core service не регистрирует произвольный HTTP handler в Studio;
- неизвестные field/page/action types отклоняются;
- опасные действия требуют явного confirmation;
- install/update показывают publisher, version и permissions.

## 2. Project files

Project source не должен содержать автоматически:

- bearer tokens;
- private keys;
- cookies;
- secret values;
- database passwords;
- raw service credentials.

Studio может предупреждать о вероятном secret в неподходящем файле, но не
логирует значение.

## 3. Desktop

Desktop — основной целевой режим:

- несколько CLI targets отображаются через импортированные reports;
- локальные projects;
- file system project tree;
- dockable panels;
- Studio plugin lifecycle;
- будущие direct/SSH adapters после отдельного решения.

Локальная Studio SQLite хранит только project/Git metadata, client state и
импортированные безопасные CLI reports; Core settings туда не копируются.

## 4. Web

Web получает один Core endpoint из `STUDIO_CORE_ENDPOINT`. Endpoint нельзя
добавить, изменить или переключить через UI без отдельной server-side
identity/auth/session модели.

Ограничения web:

- один фиксированный deploy context;
- нет SSH bridge;
- нет автоматического доступа к локальной файловой системе;
- credentials остаются на server side;
- desktop-only controls показываются только при наличии capability.

Web не должен выдавать bootstrap binding за пользовательский connection manager.

## 5. Состояния страниц

Каждая страница поддерживает:

- loading;
- empty;
- ready;
- dirty;
- validating;
- unavailable;
- permission denied;
- conflict;
- degraded;
- failed;
- stale data;
- plugin disconnected.

Особенно важно различать:

- `No project` и `Project has no Git repository`;
- `No deploy report` и `Service degraded in last report`;
- `No operation` и `Operation not loaded`;
- `Plugin not installed` и `Plugin installed but stopped`;
- `File missing` и `File intentionally untracked`.

## 6. Credentials и storage

Credentials не попадают в:

- frontend bundle;
- project manifest;
- logs;
- operation metadata;
- plugin page payload;
- screenshot/export artifacts.

Core settings и runtime observations не копируются в локальную Studio SQLite.

## 7. Failure boundaries

| Сбой | Что остаётся доступным |
| --- | --- |
| Core unavailable | Project tree, local validation, drafts и Git |
| Service degraded | Последний CLI report, canvas, inspector и evidence |
| Studio plugin stopped | Core workspace и базовый inspector |
| File editor unavailable | File preview и validation diagnostics |
| Stale surface | Безопасный reload schema, без dispatch устаревшего action |
