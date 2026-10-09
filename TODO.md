# Liapoldus Studio — каркас

Этот список фиксирует только направление Studio; здесь нет полной продуктовой
спецификации.

Studio развивается отдельно от текущих v2 milestones; не включать его в
параллельные задачи по Core, SDK или plugins. Web
режим работает с проектом и файлами, а deployment выполняется standalone
`liapoldus` CLI. Studio не показывает live Core observations и не обращается
к plugin endpoints, Kubernetes/Swarm или peer protocol.

## Каркас

- [x] Desktop entrypoint на Wails (корневой `main.go`) и отдельный web entrypoint
  без Wails (`cmd/web`).
- [x] Отдельные Go presentation layers и composition roots для desktop/web.
- [x] Общий React UI с раздельными Wails и same-origin HTTP API adapters.
- [x] ENV-only bootstrap только для listener Studio; Core endpoint отсутствует.
- [x] Минимальные web health/product-info endpoints и статическая раздача UI.
- [x] Собственный SQLite adapter desktop projects/client selection с native
  Go тестами; без credentials и копий Core/plugin settings.
- [x] ENV adapter с Go unit tests; legacy web JSON loader и `-config` удалены.
- [x] Blocking `make check`: pinned golangci-lint v2 и frontend ESLint
  strictTypeChecked без baseline/exclusions; typed TS scripts/tests и два
  изолированных reproducibility прогона Wails generation.
- [x] Корневой native `wails.json`, тематические product/assets подпакеты,
  короткие имена domain files; без reserved Core/SSH пакетов и config aliases.
- [x] Native product-info parity/HTTP tests, typed frontend adapter tests и
  standalone web E2E; ENV bootstrap и собственная SQLite сохранены.

## До управляемого продукта

- [ ] Реализовать project file tree и schema-aware editing поверх файлов проекта.
- [ ] Реализовать Git status, commit, pull, push и обязательный commit перед
  `liapoldus apply`; remote repository остаётся source of truth.
- [ ] Реализовать импорт plan/apply/deploy reports из CLI/CI без запуска Core.
- [ ] Добавить browser/desktop UI end-to-end проверки и packaging для остальных
  целевых платформ после фиксации требований; текущий gate проверяет web shell
  и packaged macOS desktop build.
