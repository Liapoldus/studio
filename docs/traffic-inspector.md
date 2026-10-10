# Traffic inspector

## 1. Purpose

Traffic inspector помогает диагностировать plugin-to-plugin communication without
making Studio a Core client. Источник данных — CLI/Core observation report.

## 2. Data model

An observation record contains:

- timestamp;
- correlation id;
- caller and target plugin ids;
- method/stream name;
- transport and security profile;
- request/response status;
- latency and payload sizes;
- request/response schema versions;
- redacted structured payloads;
- validation diagnostics.

## 3. Redaction

Runtime plugin contract schemas declare fields as:

- public;
- sensitive;
- secret;
- internal;
- omitted from capture.

Studio never stores or renders `secret` and `omitted` values. Redaction occurs at
the CLI/Core report boundary and is repeated before persistence as defense in
depth.

## 4. UI

Traffic panel provides:

- plugin/method/status/time filters;
- timeline and table views;
- request/response split view;
- schema validation badges;
- latency and size summary;
- correlation-id navigation;
- copy-safe redacted JSON;
- export of safe diagnostics.

There is no direct live socket from Studio to Core. If a report is stale, the UI
shows its capture time and offers a new CLI observation run.

В текущем desktop vertical slice Wails отдаёт renderer отдельную
`TrafficRecordView`: она содержит provenance report, route, method, status,
transport, schema validation, latency и уже redacted payload strings. UI
показывает таблицу с текстовым фильтром, фильтрами status/transport и диапазоном
latency, раскрытием request/response и экспортом safe JSON projection; отсутствие
записей явно означает отсутствие импортированного report, а не отсутствие
трафика в Core.
