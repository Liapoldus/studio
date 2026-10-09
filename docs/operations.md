# Operations и диагностика

## 1. Смысл operations

Любое действие Studio, которое меняет project source или Git history, должно
иметь локально наблюдаемый lifecycle. Core deploy operation принадлежит
универсальному CLI и Core, а Studio показывает только импортированный report.

Studio не объявляет deploy успешным по локальному действию. Она показывает
только импортированный CLI/CI report.

## 2. Состояния

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Validating: "Validate"
    Validating --> Invalid: "schema/reference error"
    Invalid --> Draft: "Fix source"
    Validating --> ReadyToApply: "valid"
    ReadyToApply --> Committed: "Commit"
    Committed --> Report: "Import CLI report"
    Report --> Succeeded
    Report --> Failed
    Report --> Degraded
    Failed --> Draft: "new correction"
    Succeeded --> Observed: "refresh observations"
    Observed --> Draft: "new local edit"
```

CLI/Core terminal states `succeeded`, `failed` и `degraded` не должны называться
одинаково в UI. Особенно важно не превращать `degraded` в «почти success».

## 3. Operations workspace

Фильтры:

- project;
- target/revision;
- service;
- operation kind;
- state;
- time range.

Запись содержит только безопасные metadata:

- operation id;
- kind;
- service/resource id;
- generation/digest, если разрешено контрактом;
- timestamps;
- state;
- error code;
- target replicas и ACK state.

Raw request/response, credentials, secret references и private keys не выводятся.

## 4. Bottom panel

Bottom panel открывается для:

- pending/running operations;
- validation problems;
- degraded rollout;
- failed operation;
- stale observation;
- plugin disconnect.

В спокойном состоянии панель скрыта, но краткий summary operation остаётся в
top bar.

## 5. Diagnostic model

Диагностика отвечает на вопросы:

1. что хотел изменить оператор;
2. какая generation стала active;
3. какие replicas подтвердили target;
4. что можно сделать дальше.

Для degraded state показываются evidence и remediation hint. Не показывается
фиктивная кнопка `Restart service`, если Core не владеет process lifecycle.

## 6. Problems

Категории:

- project validation;
- schema validation;
- connection/authentication;
- conflict/CAS;
- Core operation;
- replica/lease/readiness;
- Studio plugin compatibility;
- file access/permissions.

У каждой проблемы есть severity, owner, location и suggested next step.

## 7. Commit → CLI deploy flow

```mermaid
flowchart LR
    A["Local draft"] --> B["Validate"]
    B -->|"invalid"| C["Problems panel"]
    C --> A
    B -->|"valid"| D["Show Git diff"]
    D --> E["Commit revision"]
    E --> F["liapoldus plan/apply"]
    F --> G["Generation + replica ACK report"]
    G --> H{ "State" }
    H -->|"succeeded"| I["Observed ready"]
    H -->|"failed"| C
    H -->|"degraded"| J["Evidence + reconcile guidance"]
```

## 8. Audit/context

Оператору нужно показывать безопасный context:

- actor;
- request/correlation id;
- resource/service;
- operation id;
- timestamps;
- result/error code.

Audit не должен раскрывать body settings, credentials и secret values.
