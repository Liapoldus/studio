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
- install/update показывают publisher, version и permissions;
- companion tools запускаются только через Tool Registry с declared scope;
- production companion processes запускаются только при доступном OS sandbox;
- tool artifact digests проверяются до регистрации; cryptographic publisher
  signature verification выполняется только для configured release trust roots;
- tool запуск не получает Core credentials, private keys или raw secrets;
- plugin UI-surface исполняется только в `<iframe sandbox="allow-scripts">`, без
  `allow-same-origin`, `allow-popups` и forms;
- iframe UI-surface не имеет доступа к Wails bindings, файловой системе и Node;
- обмен host↔frame идёт только через `postMessage` bridge, без raw secrets;
- ассеты plugin UI-surface отдаются path-confined через Wails `AssetServer`;
- host применяет строгий CSP `frame-src`.

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

- несколько CLI targets отображаются через imported reports;
- локальные projects;
- file system project tree;
- plugin pages/panels как workspace tabs; произвольное docking отсутствует;
- Studio-managed companion console tools;
- Studio plugin lifecycle;
- sandboxed iframe UI-surfaces установленных Studio-плагинов;
- CLI handoff и report import;
- Git remotes через OS credential manager.

Локальная Studio SQLite хранит project/Git metadata, client state,
импортированные безопасные CLI reports и schema-validated settings drafts.
Для настройки сервиса сохраняется только redacted/non-sensitive JSON patch,
не полный settings document; новый SHA-256 digest защищает от обычной записи
поверх более свежей версии Project. Это optimistic stale-write guard, не
межпроцессный lock/CAS.
Исключение для schema-owned JSON documents требует явной аннотации
`x-studio-json-document: true`; ограниченная replace-operation живёт только в
draft, а на диск записывается чистое JSON-значение. Открытые объекты без этой
аннотации по-прежнему отклоняются.

## 4. Состояния страниц

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

## 5. Credentials и storage

Credentials не попадают в:

- frontend bundle;
- project manifest;
- logs;
- operation metadata;
- plugin page payload;
- screenshot/export artifacts.

Core-owned settings и runtime observations не копируются в локальную Studio
SQLite. Draft patch не содержит secrets: host валидирует schema, sensitive и
read-only annotations перед сохранением и повторно при чтении.

## 6. Plugin UI-surface (sandboxed iframe)

Studio может исполнять UI-surface установленного Studio-плагина как HTML/JS в
отдельном sandboxed iframe. Это единственный случай, когда plugin HTML/JS
исполняется в Studio, и он ограничен жёстким контрактом:

- iframe объявляется строго как `<iframe sandbox="allow-scripts">`; атрибуты
  `allow-same-origin`, `allow-popups`, `allow-forms` и прочие не добавляются;
- без `allow-same-origin` frame получает opaque origin: он не читает DOM host,
  cookies, storage и same-origin ресурсы Studio;
- frame не имеет доступа к Wails bindings, файловой системе и Node;
- единственный канал обмена host↔frame — `postMessage` bridge; bridge не
  передаёт credentials, private keys или raw secret values;
- origin проверяется направленно: host принимает только сообщения от
  `iframe.contentWindow` с opaque `origin === "null"`; plugin принимает только
  `parent`, закрепляет его origin при валидном handshake и затем проверяет тот
  же origin. Значение origin отправителя host не является `null` только потому,
  что получатель — sandboxed iframe;
- host применяет строгий CSP `frame-src` только для path-confined ассетов
  плагина;
- ассеты плагина (HTML/JS/CSS) отдаются Wails `AssetServer` по path-confined
  маршруту из installed package root; symlink и выход за пределы package root
  запрещены;
- запуск iframe-вкладки инициируется только кнопкой в левом rail.

### Модель угроз

- XSS внутри frame и попытки выйти в same-origin;
- злоупотребление bridge-сообщениями и подделка host-сообщений;
- чтение host-ресурсов и утечка секретов через bridge или ассеты;
- вредоносный payload в отдаваемых ассетах.

### Residual risk

Выбор «разрешить UI-surface для любого установленного плагина» повышает риск:
UI-surface не требует publisher signature, поэтому строгий sandbox — **единственная**
граница доверия. Отсюда strict sandbox обязателен для всех UI-surface без
исключений; `allow-same-origin` и любые ослабления sandbox токенов не
допускаются, и нет opt-out для install trust. Остаточный риск: sandboxed iframe
не защищает от браузерных 0-day и не снимает CPU/DoS-нагрузку внутри frame;
Studio не даёт frame никакого privileged channel и не рендерит его содержимое в
основном renderer.

## 7. Failure boundaries

| Сбой | Что остаётся доступным |
| --- | --- |
| Core unavailable | Project tree, local validation, drafts и Git |
| Service degraded | Последний CLI report, canvas, inspector и evidence |
| Studio plugin stopped | Config workspace и базовый inspector |
| Companion tool unavailable | Plugin UI, project files и базовый inspector |
| Plugin UI-surface failed | Workspace, config workspace и базовый inspector; вкладка — unavailable |
| File editor unavailable | File preview и validation diagnostics |
| Stale surface | Безопасный reload schema, без dispatch устаревшего action |
