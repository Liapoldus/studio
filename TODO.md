# Liapoldus Studio — каркас

Этот список фиксирует только направление Studio; здесь нет полной продуктовой
спецификации.

## Каркас

- [x] Desktop entrypoint на Wails и отдельный web entrypoint без Wails.
- [x] Отдельные Go presentation layers и composition roots для desktop/web.
- [x] Общий React UI с раздельными Wails и same-origin HTTP API adapters.
- [x] Web bootstrap-конфигурация с единственным фиксированным Core endpoint;
  без UI переключения Core и без SSH bridge.
- [x] Минимальные web health/product-info endpoints и статическая раздача UI.

## До управляемого продукта

- [ ] Спроектировать и реализовать аутентификацию и авторизацию web-пользователей,
  CSRF/Origin-защиту, аудит, сессии и безопасный server-side доступ к Core.
- [ ] Подключить Core Management API в web backend через единственный
  настроенный endpoint; не раскрывать credentials браузеру.
- [ ] Реализовать desktop Core API adapters, сохранённые подключения и
  предусмотренный для desktop SSH bridge.
- [ ] Определить обновление и проверку конфигурации web-развёртывания; Core
  endpoint остаётся неизменяемым через пользовательский API.
- [ ] Добавить Go/TypeScript тесты, end-to-end проверки и packaging для целевых
  платформ после фиксации требований.
