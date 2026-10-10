# Production packaging и release

## 1. Supported platforms

Первая production matrix:

- macOS arm64/x64: signed and notarized `.app`/DMG;
- Windows x64/arm64 where Wails toolchain supports it: signed installer;
- Linux x64: AppImage и проверочный package artifact.

Desktop WebView runtime остаётся частью packaged application. Web distribution
Studio не выпускается.

## 2. Reproducibility

Release build pins:

- Go toolchain;
- Wails CLI and Go module;
- Node LTS and npm lockfile;
- frontend dependencies;
- platform packaging tools.

CI publishes build metadata, source revision and artifact digest. Local builds do
not silently alter checked-in generated bindings.

## 3. Quality gates

Every release candidate runs:

- Go tests, vet and build;
- frontend typecheck, lint and component tests;
- Wails binding reproducibility;
- SQLite migration tests;
- native Git and CLI runner integration tests;
- package install/trust/rollback tests;
- manifest Ed25519 verification against release trust roots and artifact
  SHA-256 verification;
- platform packaging smoke;
- secret-redaction and path-safety tests.

## 4. Upgrade and recovery

- app update never overwrites active user database;
- schema migrations are versioned and fail closed;
- plugin updates keep the previous verified package until new install passes;
- interrupted CLI/plugin runs become redacted recoverable diagnostics in
  `.studio/diagnostics.jsonl` and are shown in the Problems panel after reopen;
- crash logs exclude credentials, payload secrets and private paths where possible.

`.github/workflows/verify.yml` содержит отдельную package matrix для Linux
amd64, Windows amd64 и macOS arm64. Linux job устанавливает `bubblewrap` для
sandbox smoke/runtime prerequisites. Она устанавливает pinned Go/Node/Wails,
запускает platform Go test/vet и `scripts/desktop/package-smoke.mjs`, собирает
Go build, Wails bindings reproducibility, frontend lint, native Wails package и
`scripts/desktop/package-smoke.mjs`, публикует build artifact для smoke/QA. Release
workflow `.github/workflows/release.yml` запускается вручную с `sign=true` и
использует certificate-backed secrets для macOS codesign/notarization и
Windows Authenticode. Перед production build workflow fail-closed проверяет
`STUDIO_PLUGIN_TRUST_ROOTS`, `STUDIO_PLUGIN_REQUIRE_SIGNATURES=true` и
`STUDIO_PLUGIN_SANDBOX_MODE=required`; trust roots передаются только через
GitHub Actions secret и никогда не печатаются в логе. Без `sign=true` workflow
создаёт только QA artifacts; unsigned artifacts не считаются production release.

Windows packaging also builds `cmd/sandbox-launcher` as a separate native
`studio-sandbox-launcher.exe`. The helper is shipped beside the Wails binary,
is included in the Authenticode signing pass, and is required by the Windows
package and AppContainer smoke tests. It creates an ephemeral AppContainer
profile, grants only the declared package/project access, launches the plugin
with explicit standard handles, and restores directory ACLs after the child
exits.

Production desktop configuration must provide `STUDIO_PLUGIN_TRUST_ROOTS` and
`STUDIO_PLUGIN_REQUIRE_SIGNATURES=true`, and set
`STUDIO_PLUGIN_SANDBOX_MODE=required`; local development may omit these and
still install unsigned packages only after explicit user trust.
