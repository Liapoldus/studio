# Binary-only Docker runtime

Studio использует Docker только как локальную среду отладки уже собранных
plugin binaries. Studio и CLI не компилируют plugin и не выполняют `docker
build`/`buildx`.

## Control plane

Единственная цепочка управления:

```text
Studio → typed liapoldus CLI → Core Management API → Plugin SDK REST API
```

CLI владеет Docker CLI, staging бинарников, контейнерами, временной сетью,
логами, инфраструктурным inspect и allowlisted exec. В Core CLI отправляет
только `artifactId`, `artifactVersion`, digest, instance/replica IDs,
control/peer endpoints и runtime status.

Core через свой SDK client получает у живого plugin `manifest`, `config-schema`,
`identity` и `readiness`, применяет configuration generation и публикует peer
directory. CLI никогда не вызывает plugin REST, включая `/manifest`,
`/config-schema`, `/identity`, `/ready`, `/reload`.

## Data plane

```text
Server → pluginprotocol authenticated peer session → Echo
```

Core выдаёт peer directory и generic link policy, но не проксирует business
traffic и не выполняет peer calls. Server и Echo независимы и не импортируют
код друг друга.

## Artifact registry

Project хранит только logical reference в `services/<plugin>/service.yaml`:

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

## Runtime sequence

1. `runtime start` проверяет target, artifact digest/platform/trust и наличие
   generic runtime image.
2. CLI запускает Core lifecycle и plugin containers в temporary Docker network.
3. CLI отправляет Core safe registration metadata.
4. Core проверяет live SDK registration и сам читает Plugin SDK REST metadata.
5. Core применяет project settings, generic peer-link policy и configuration
   generation.
6. CLI poll/watch-ит Core operation и возвращает Studio typed JSON/JSONL events.

Generated Compose/staging/network state удаляется после stop и никогда не
становится canonical Project format или Git artifact.

## Studio surface

Разделы `Artifacts` и `Runtime` работают только через typed CLI intents:

```text
plugin artifact list|inspect|register|trust
plugin inspect|manifest|schema|status <plugin> --target local
runtime start|stop|restart|status|logs|inspect
```

Manifest/schema/status в UI всегда Core-backed. В Studio нет plugin REST URL,
SDK client, credential values или raw Docker args.

## Failures

Ошибки классифицируются как `artifact_missing`, `artifact_digest_mismatch`,
`artifact_untrusted`, `artifact_platform_mismatch`, `runtime_image_missing`,
`manifest_unavailable`, `manifest_invalid`, `plugin_registration_failed`,
`configuration_apply_failed`, `peer_directory_unavailable` и
`peer_call_failed`. Каждая ошибка должна содержать следующий безопасный шаг.
