# Binary-only Docker runtime

Studio использует Docker только как локальную среду отладки уже собранных
service binaries. Studio и CLI не компилируют service и не выполняют `docker
build`/`buildx`.

## Control plane

Единственная цепочка управления:

```text
Studio → typed liapoldus CLI → Core Management API → Service SDK REST API
```

CLI владеет Docker CLI, staging бинарников, контейнерами, временной сетью,
логами, инфраструктурным inspect и allowlisted exec. В Core CLI отправляет
только `artifactId`, `artifactVersion`, digest, instance/replica IDs,
control/peer endpoints и runtime status.

Core через свой SDK client получает у живого service `manifest`, `config-schema`,
`identity` и `readiness`, применяет configuration generation и публикует peer
directory. CLI никогда не вызывает service REST, включая `/manifest`,
`/config-schema`, `/identity`, `/ready`, `/reload`.

## Data plane

```text
Server → wool authenticated peer session → Echo
```

Core выдаёт peer directory и generic link policy, но не проксирует business
traffic и не выполняет peer calls. Server и Echo независимы и не импортируют
код друг друга.

## Artifact registry

Project хранит только logical reference в `services/<service>/service.yaml`:

```yaml
id: server
version: 1.0.0
artifact:
  id: server
  version: 1.0.0
  platform: linux/arm64
  digest: sha256:...
```

Absolute binary path живёт только в CLI-owned local registry. Перед запуском
CLI проверяет наличие файла, SHA-256, строгую platform match и trust decision,
затем создаёт read-only temporary staging. Исходный binary не изменяется.
Studio выбирает artifact только для service с тем же ID, повторно сверяет
registry metadata через typed CLI и требует trust. При binding верхний
`service.yaml.version` и `artifact.version` синхронизируются; изменение
атомарно, сохраняет остальные manifest fields и не сохраняет path.

## Runtime sequence

1. `runtime start` проверяет target, artifact digest/platform/trust и наличие
   generic runtime image. В пределах выбранного target CLI автоматически
   удаляет только ожидаемые service containers в состояниях `created`, `exited`
   или `dead`, оставшиеся от старого/неудачного запуска. Любой активный или
   неизвестный контейнер блокирует Start без очистки.
2. CLI запускает Core lifecycle и service containers в temporary Docker network.
3. CLI отправляет Core safe registration metadata.
4. Core проверяет live SDK registration и сам читает Service SDK REST metadata.
5. Core применяет project settings, generic peer-link policy и configuration
   generation.
6. CLI poll/watch-ит Core operation и возвращает Studio typed JSON/JSONL events.

Generated Compose/staging/network state удаляется после stop и никогда не
становится canonical Project format или Git artifact.
Автоматическая reconciliation не удаляет Core container/state, volumes,
credentials, certificates, images, бинарные artifacts или контейнеры других
targets. Если состояние нельзя однозначно проверить, Studio показывает ошибку
typed CLI-команды и не выполняет cleanup.

## Studio surface

Global Settings expose Docker lifecycle and installed service versions. The
top-bar Run/Restart actions call typed CLI commands for every connected project
service; CLI starts an installed Docker Engine when its client is present and
the daemon is stopped, then waits for the Docker API before reconciling. Debug
collects per-service inspect and bounded logs. Studio never installs Docker or
builds service images.

Управление установленными версиями и Docker находится в глобальных Settings и
работает только через typed CLI intents:

```text
service artifact list|inspect|register|trust|remove
service inspect|manifest|schema|status <service> --target local
runtime start|stop|restart|status|logs|inspect
runtime start|stop|restart --service <service-id>
```

Local `runtime plan/start` используют Project `WORKING_TREE`, поэтому видят
не закоммиченные в Git service artifact references, настроенные через Studio.
Удаление registry entry требует подтверждения и digest match; binary можно
зарегистрировать заново через Artifacts.

Manifest/schema/status в UI всегда Core-backed. В Studio нет service REST URL,
SDK client, credential values или raw Docker args.

`Start` на выбранном сервисе сверяет Core live artifact version/digest с
Project binding. Если pin изменился, CLI заменяет только остановленный контейнер
этого сервиса, повторно регистрирует его через Core и проверяет Core provenance
и readiness. Предыдущий бинарник должен оставаться trusted и доступным для
rollback; при ошибке CLI восстанавливает его и подтверждает Core status.
Запущенный сервис не заменяется автоматически: Studio останавливает только
выбранный service, затем `Start` применяет новый pin. Core, соседние сервисы,
credentials и Project data при этом не пересоздаются.

## Failures

Ошибки классифицируются как `artifact_missing`, `artifact_digest_mismatch`,
`artifact_untrusted`, `artifact_platform_mismatch`, `runtime_image_missing`,
`manifest_unavailable`, `manifest_invalid`, `service_registration_failed`,
`configuration_apply_failed`, `peer_directory_unavailable` и
`peer_call_failed`. Каждая ошибка должна содержать следующий безопасный шаг.
