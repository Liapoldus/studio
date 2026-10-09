# Liapoldus Studio — каркас

Этот список фиксирует только направление Studio; здесь нет полной продуктовой
спецификации.

Studio развивается отдельно от текущих v2 milestones; не включать его в
параллельные задачи по Core, SDK или plugins. Web
режим привязан к одному Core, desktop допускает несколько сохранённых
подключений; оба показывают только подтверждённые Core rollout/replica/lease
observations. UI не обращается напрямую к plugin endpoints, Kubernetes/Swarm
или peer protocol и не отображает self-reported release digest как
криптографически проверенное происхождение бинарника.

## Каркас

- [x] Desktop entrypoint на Wails (корневой `main.go`) и отдельный web entrypoint
  без Wails (`cmd/web`).
- [x] Отдельные Go presentation layers и composition roots для desktop/web.
- [x] Общий React UI с раздельными Wails и same-origin HTTP API adapters.
- [x] ENV-only bootstrap с единственным фиксированным web Core endpoint;
  без UI переключения Core и без SSH bridge.
- [x] Минимальные web health/product-info endpoints и статическая раздача UI.
- [x] Собственный SQLite adapter desktop connections/client selection с native
  Go тестами; без credentials и копий Core/plugin settings, пока без UI.
- [x] ENV adapter с Go unit tests; legacy web JSON loader и `-config` удалены.
- [x] Blocking `make check`: pinned golangci-lint v2 и frontend ESLint
  strictTypeChecked без baseline/exclusions; typed TS scripts/tests и два
  изолированных reproducibility прогона Wails generation.
- [x] Корневой native `wails.json`, тематические product/assets подпакеты,
  короткие имена domain files; без reserved Core/SSH пакетов и config aliases.
- [x] Native product-info parity/HTTP tests, typed frontend adapter tests и
  standalone web E2E; ENV bootstrap и собственная SQLite сохранены.

## До управляемого продукта

- [ ] После появления Core v2 API отобразить живые replicas, incarnation,
  lease/readiness, два rollout cohorts, подтверждённый traffic weight, paused
  состояние и причины fencing; отдельным действием разрешить ручное
  подтверждение следующей canary ступени. Gate: web/desktop UI не объявляют
  продвижение завершённым без ACK внешнего traffic controller.

- [ ] Спроектировать и реализовать аутентификацию и авторизацию web-пользователей,
  CSRF/Origin-защиту, аудит, сессии и безопасный server-side доступ к Core.
- [ ] Подключить Core Management API в web backend через единственный
  настроенный endpoint; не раскрывать credentials браузеру.
- [ ] Реализовать desktop Core API adapters, UI сохранённых подключений и
  предусмотренный для desktop SSH bridge.
- [ ] Определить обновление и проверку конфигурации web-развёртывания; Core
  endpoint остаётся неизменяемым через пользовательский API.
- [ ] Добавить browser/desktop UI end-to-end проверки и packaging для остальных
  целевых платформ после фиксации требований; текущий gate проверяет web shell
  и packaged macOS desktop build.
