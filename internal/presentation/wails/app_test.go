package wails

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io/fs"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	workspaceapp "github.com/Liapoldus/studio/internal/application/workspace"
	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
	projectfs "github.com/Liapoldus/studio/internal/infrastructure/filesystem"
	projectinfra "github.com/Liapoldus/studio/internal/infrastructure/project"
	settingsinfra "github.com/Liapoldus/studio/internal/infrastructure/settings"
)

type surfaceAssetStub struct {
	assetPath string
	data      []byte
}

func (s *surfaceAssetStub) SurfaceAsset(_ context.Context, id, version, surfaceID, assetPath string) ([]byte, string, error) {
	if id != "studio.tools" || version != "1.0.0" || surfaceID != "console" {
		return nil, "", models.ErrInvalidStudioPlugin
	}
	s.assetPath = assetPath
	return s.data, "text/html; charset=utf-8", nil
}

func TestStudioPluginAssetHandlerScopesFilesAndSetsSandboxPolicy(t *testing.T) {
	plugin := &surfaceAssetStub{data: []byte("<!doctype html>")}
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/studio-plugin-assets/studio.tools/1.0.0/console/ui/index.html", nil)
	response := httptest.NewRecorder()
	serveStudioPluginAsset(response, request, plugin)
	if response.Code != http.StatusOK || plugin.assetPath != "ui/index.html" {
		t.Fatalf("unexpected plugin asset response: status=%d path=%q", response.Code, plugin.assetPath)
	}
	if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("missing nosniff: %q", got)
	}
	if got := response.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("ordinary asset navigation unexpectedly enabled CORS: %q", got)
	}
	policy := response.Header().Get("Content-Security-Policy")
	for _, required := range []string{"default-src 'none'", "script-src wails:", "connect-src 'none'", "frame-ancestors 'self'"} {
		if !strings.Contains(policy, required) {
			t.Errorf("CSP does not include %q: %s", required, policy)
		}
	}
	for _, path := range []string{
		"/studio-plugin-assets/studio.tools/1.0.0/console/../manifest.json",
		"/studio-plugin-assets/studio.tools/1.0.0/console/%2e%2e/manifest.json",
		"/studio-plugin-assets/studio.tools/1.0.0/console/ui%2findex.html",
	} {
		invalidResponse := httptest.NewRecorder()
		serveStudioPluginAsset(invalidResponse, httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil), plugin)
		if invalidResponse.Code == http.StatusOK {
			t.Errorf("served invalid or escaped path %q", path)
		}
	}
	response = httptest.NewRecorder()
	serveStudioPluginAsset(response, httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/studio-plugin-assets/studio.tools/1.0.0/console/ui/index.html", nil), plugin)
	if response.Code != http.StatusMethodNotAllowed {
		t.Errorf("unexpected method status %d", response.Code)
	}
}

func TestStudioPluginAssetHandlerAllowsModuleFetchOnlyFromOpaqueSandboxOrigin(t *testing.T) {
	plugin := &surfaceAssetStub{data: []byte("export const ready = true")}
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/studio-plugin-assets/studio.tools/1.0.0/console/ui/bridge.js", nil)
	request.Header.Set("Origin", "null")
	response := httptest.NewRecorder()
	serveStudioPluginAsset(response, request, plugin)
	if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != "null" {
		t.Fatalf("sandbox module fetch was not allowed: status=%d headers=%v", response.Code, response.Header())
	}
	if !strings.Contains(response.Header().Get("Vary"), "Origin") {
		t.Fatalf("opaque-origin response must vary by Origin: %v", response.Header())
	}

	for _, origin := range []string{"https://attacker.invalid", "wails://wails"} {
		request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/studio-plugin-assets/studio.tools/1.0.0/console/ui/bridge.js", nil)
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		serveStudioPluginAsset(response, request, plugin)
		if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("unexpected CORS grant for origin %q: status=%d headers=%v", origin, response.Code, response.Header())
		}
	}
}

func TestStudioPluginPackagePickerDoesNotFilterUnknownCustomExtension(t *testing.T) {
	options := studioPluginPackageDialogOptions()
	if options.Title != "Import Studio plugin" {
		t.Fatalf("unexpected dialog title %q", options.Title)
	}
	if len(options.Filters) != 0 {
		t.Fatalf("custom .studio-plugin extension must be validated by the installer, not filtered by native dialog: %#v", options.Filters)
	}
}

type diagnosticStoreStub struct {
	items []models.Diagnostic
}

func (s *diagnosticStoreStub) Append(_ context.Context, _ string, diagnostic models.Diagnostic) error {
	s.items = append(s.items, diagnostic)
	return nil
}

func (s *diagnosticStoreStub) List(context.Context, string) ([]models.Diagnostic, error) {
	return s.items, nil
}

func TestStructuredCLIResultUsesSafeDiagnosticWhenOutputIsMissing(t *testing.T) {
	events := make(chan models.CLIEvent, 2)
	events <- models.CLIEvent{Type: "diagnostic", Severity: "error", Code: "cli.protocol", Message: "invalid liapoldus CLI event"}
	events <- models.CLIEvent{Type: "run.completed"}
	close(events)

	if _, err := structuredCLIResult(events); err == nil || err.Error() != "liapoldus: cli.protocol: invalid liapoldus CLI event" {
		t.Fatalf("expected actionable safe diagnostic, got %v", err)
	}
}

func TestStructuredCLIResultPrefersSafeDiagnosticOverGenericExitFailure(t *testing.T) {
	events := make(chan models.CLIEvent, 2)
	events <- models.CLIEvent{Type: "diagnostic", Severity: "warning", Code: "cli.stderr", Message: "read Core CA file: open [redacted path] no such file or directory"}
	events <- models.CLIEvent{Type: "run.failed", Code: "cli.exit", Message: "liapoldus exited with an error", ExitCode: 5}
	close(events)

	if _, err := structuredCLIResult(events); err == nil || err.Error() != "liapoldus: cli.stderr: read Core CA file: open [redacted path] no such file or directory" {
		t.Fatalf("expected specific safe diagnostic instead of generic exit failure, got %v", err)
	}
}

func TestStructuredCLIResultReturnsRunOutput(t *testing.T) {
	events := make(chan models.CLIEvent, 2)
	events <- models.CLIEvent{Type: "run.output", Payload: []byte(`{"registered":true}`)}
	events <- models.CLIEvent{Type: "run.completed"}
	close(events)

	result, err := structuredCLIResult(events)
	if err != nil || string(result) != `{"registered":true}` {
		t.Fatalf("unexpected structured result %s: %v", result, err)
	}
}

type metadataProjectStore struct {
	interfaces.DesktopStore
	projects []models.Project
}

type selectedProjectStore struct {
	metadataProjectStore
}

func (store selectedProjectStore) ReadClientState(context.Context) (models.ClientState, error) {
	if len(store.projects) == 0 {
		return models.ClientState{}, nil
	}
	return models.ClientState{SelectedProjectID: store.projects[0].ID}, nil
}

func (store metadataProjectStore) ListProjects(context.Context) ([]models.Project, error) {
	return store.projects, nil
}

type metadataProjectSource struct {
	interfaces.ProjectSource
	workspace models.Workspace
}

func (source metadataProjectSource) Open(context.Context, string) (models.Workspace, error) {
	return source.workspace, nil
}

type metadataCLIRunner struct {
	interfaces.CLIRunner
	request  models.CLIRequest
	artifact models.ArtifactReference
	calls    []models.CLIRequest
	schema   []byte
}

//nolint:govet // Keep the test fake's observed request and captured file together.
type coreSettingsCLIRunner struct {
	interfaces.CLIRunner
	calls       []models.CLIRequest
	patch       []byte
	patchPath   string
	patchMode   os.FileMode
	updateError bool
}

func (runner *coreSettingsCLIRunner) Run(_ context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	runner.calls = append(runner.calls, request)
	payload := []byte(`{"schemaVersion":"core-settings-view/v1","target":"local","desiredRevision":8,"effectiveRevision":8,"pending":false,"restartRequired":false,"settings":{"management":{"listen":"0.0.0.0:18180","maxBodyBytes":1048576,"headerTimeout":"5s","requestTimeout":"30s","tls":{"certificate":{"configured":true,"available":true,"state":"mapped"}}},"secretRoot":{"state":"unmapped"}}}`)
	if len(request.Args) > 2 && request.Args[0] == "core" && request.Args[1] == "settings" && request.Args[2] == "update" {
		runner.patchPath = request.Args[6]
		info, err := os.Stat(runner.patchPath)
		if err != nil {
			return nil, err
		}
		runner.patchMode = info.Mode().Perm()
		runner.patch, err = os.ReadFile(runner.patchPath)
		if err != nil {
			return nil, err
		}
		if runner.updateError {
			return closedCLIEvents(models.CLIEvent{Type: "run.failed", Code: "settings.conflict", Message: "revision conflict", ExitCode: 5}), nil
		}
		payload = []byte(`{"schemaVersion":"core-settings-update-result/v1","target":"local","previousRevision":8,"result":{"schemaVersion":"core-settings-view/v1","target":"local","desiredRevision":9,"effectiveRevision":8,"pending":true,"restartRequired":true,"settings":{"management":{"listen":"0.0.0.0:18180","maxBodyBytes":2097152,"headerTimeout":"10s","requestTimeout":"45s"}}}}`)
	}
	return closedCLIEvents(models.CLIEvent{Type: "run.output", Payload: payload}, models.CLIEvent{Type: "run.completed"}), nil
}

func closedCLIEvents(items ...models.CLIEvent) <-chan models.CLIEvent {
	events := make(chan models.CLIEvent, len(items))
	for _, item := range items {
		events <- item
	}
	close(events)
	return events
}

func TestCoreSettingsReadAndUpdateUseOnlyTypedLocalCLIAndPrivatePatch(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "core-settings-project")
	project := models.Project{ID: "core-settings", Name: "Core settings", RootPath: root}
	workspace := models.Workspace{Project: &project}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &coreSettingsCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	view, err := app.ReadCoreSettings()
	if err != nil || !strings.Contains(view, `"desiredRevision":8`) || strings.Contains(view, "secretRoot") || strings.Contains(view, "certificate") {
		t.Fatalf("read returned unredacted or invalid settings: %s err=%v", view, err)
	}
	if len(cli.calls) != 1 || !reflect.DeepEqual(cli.calls[0].Args, []string{"core", "settings", "inspect", "--target", "local"}) {
		t.Fatalf("inspect escaped the typed local CLI intent: %+v", cli.calls)
	}

	updated, err := app.UpdateCoreSettings(8, 2097152, "10s", "45s")
	if err != nil || !strings.Contains(updated, `"desiredRevision":9`) || !strings.Contains(updated, `"restartRequired":true`) {
		t.Fatalf("update returned invalid result: %s err=%v", updated, err)
	}
	if len(cli.calls) != 2 || !reflect.DeepEqual(cli.calls[1].Args[:6], []string{"core", "settings", "update", "--target", "local", "--request-file"}) || cli.calls[1].Args[7] != "--confirm" {
		t.Fatalf("update did not use the exact typed CLI contract: %+v", cli.calls)
	}
	if cli.patchMode != 0o600 || !strings.Contains(string(cli.patch), `"schemaVersion":"core-settings-patch/v1"`) || !strings.Contains(string(cli.patch), `"expectedRevision":8`) || strings.Contains(string(cli.patch), "certificate") {
		t.Fatalf("request patch was not private, typed and secret-free: mode=%#o body=%s", cli.patchMode, cli.patch)
	}
	if _, err := os.Stat(cli.patchPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary request file was not removed: %v", err)
	}
}

func TestCoreSettingsUpdateRejectsInvalidValuesBeforeRunningCLI(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "core-settings-invalid")
	project := models.Project{ID: "core-settings-invalid", Name: "Core settings", RootPath: root}
	workspace := models.Workspace{Project: &project}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &coreSettingsCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)
	//nolint:govet // This test table groups the exact typed API arguments by semantic field.
	for _, test := range []struct {
		revision        uint64
		max             int64
		header, request string
		name            string
	}{
		{name: "revision", revision: 0, max: 1, header: "1s", request: "1s"},
		{name: "body limit", revision: 8, max: 0, header: "1s", request: "1s"},
		{name: "duration", revision: 8, max: 1, header: "not-duration", request: "1s"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := app.UpdateCoreSettings(test.revision, test.max, test.header, test.request); err == nil {
				t.Fatal("invalid Core settings patch was accepted")
			}
		})
	}
	if len(cli.calls) != 0 {
		t.Fatalf("invalid patches reached CLI: %+v", cli.calls)
	}
}

func TestLocalServiceSecretManagerUsesTypedCLIAndNeverSendsValueInArguments(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "service-secrets", Name: "Service secrets", RootPath: root}
	settingsPath := "services/server/settings.json"
	if err := os.MkdirAll(filepath.Dir(filepath.Join(root, settingsPath)), 0o700); err != nil {
		t.Fatal(err)
	}
	settingsJSON := []byte(`{"schemaVersion":2,"config":{"routes":[]}}`)
	if err := os.WriteFile(filepath.Join(root, settingsPath), settingsJSON, 0o600); err != nil {
		t.Fatal(err)
	}
	configurationJSON, err := json.Marshal(json.RawMessage(settingsJSON))
	if err != nil {
		t.Fatal(err)
	}
	configurationDigest := sha256.Sum256(configurationJSON)
	digest := fmt.Sprintf("sha256:%x", configurationDigest)
	statusPayload := fmt.Sprintf(`{"instanceId":"server","replicas":[{"replicaId":"replica-a","artifactVersion":"1.2.0","artifactDigest":"sha256:%s","ready":true,"identity":{"instanceId":"server","replicaId":"replica-a"},"readiness":{"instanceId":"server","replicaId":"replica-a","ready":true,"generation":"7","pendingGeneration":"","schemaVersion":"service-readiness/v1","sha256":%q},"configuration":{"state":"acknowledged","desiredGeneration":7,"appliedGeneration":7,"lastFailureCode":""}}]}`, strings.Repeat("b", 64), digest)
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server", Name: "Server", SettingsPath: settingsPath}}}}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &serviceSecretCLIRunner{statusPayload: statusPayload}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, projectfs.FileSystem{}, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	listed, err := app.ReadLocalServiceSecretReferences("server")
	if err != nil || !strings.Contains(listed, "ssr:v1:00112233445566778899aabbccddeeff") {
		t.Fatalf("list returned invalid catalog: %s error=%v", listed, err)
	}
	secret := []byte("host-owned-sensitive-value")
	created, err := app.CreateLocalServiceSecret("server", "server.http.auth.credential", "edge token", secret, true)
	if err != nil || !strings.Contains(created, "service-secret-create-result/v1") {
		t.Fatalf("create returned invalid result: %s error=%v", created, err)
	}
	if !reflect.DeepEqual(secret, make([]byte, len(secret))) {
		t.Fatal("host secret input remained in memory after CLI completion")
	}
	if len(cli.requests) != 3 || cli.requests[2].Args[0] != "service" || cli.requests[2].Args[1] != "secret" || cli.requests[2].Args[2] != "create" ||
		!reflect.DeepEqual(cli.requests[2].SecretInput, make([]byte, len("host-owned-sensitive-value"))) || strings.Contains(strings.Join(cli.requests[2].Args, " "), "host-owned-sensitive-value") {
		t.Fatalf("secret value escaped the stdin boundary or request was retained: %+v", cli.requests)
	}
	if err := app.RevokeLocalServiceSecret("server", "ssr:v1:00112233445566778899aabbccddeeff", true); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if len(cli.requests) != 5 || cli.requests[3].Args[1] != "status" || cli.requests[4].Args[2] != "revoke" {
		t.Fatalf("revoke did not use the typed CLI contract: %+v", cli.requests)
	}
}

func TestLocalServiceSecretManagerRequiresCurrentServiceAndConfirmation(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "service-secrets-invalid")
	project := models.Project{ID: "service-secrets-invalid", Name: "Service secrets", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server", Name: "Server"}}}}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &serviceSecretCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)
	if _, err := app.CreateLocalServiceSecret("other", "server.http.auth.credential", "edge", []byte("value"), true); err == nil {
		t.Fatal("secret creation accepted a service outside the active Project")
	}
	if _, err := app.CreateLocalServiceSecret("server", "server.http.auth.credential", "edge", []byte("value"), false); err == nil {
		t.Fatal("secret creation skipped explicit host confirmation")
	}
	if err := app.RevokeLocalServiceSecret("server", "ssr:v1:00112233445566778899aabbccddeeff", false); err == nil {
		t.Fatal("secret revoke skipped explicit confirmation")
	}
	if len(cli.requests) != 0 {
		t.Fatalf("invalid secret operations reached CLI: %+v", cli.requests)
	}
}

func TestLocalServiceSecretManagerRedactsCLIErrorAndClearsInput(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "service-secrets-error")
	project := models.Project{ID: "service-secrets-error", Name: "Service secrets", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server", Name: "Server"}}}}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &serviceSecretCLIRunner{failCreate: true}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)
	secret := []byte("private-secret-material")
	if _, err := app.CreateLocalServiceSecret("server", "server.http.auth.credential", "edge", secret, true); err == nil || strings.Contains(err.Error(), string(secret)) {
		t.Fatalf("CLI failure leaked the value or was hidden: %v", err)
	}
	if !reflect.DeepEqual(secret, make([]byte, len(secret))) {
		t.Fatal("secret input remained in memory after CLI failure")
	}
}

type serviceSecretCLIRunner struct {
	statusPayload string
	requests      []models.CLIRequest
	failCreate    bool
}

func (runner *serviceSecretCLIRunner) Run(_ context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	request.SecretInput = append([]byte(nil), request.SecretInput...)
	secretEcho := string(request.SecretInput)
	runner.requests = append(runner.requests, request)
	const item = `{"reference":"ssr:v1:00112233445566778899aabbccddeeff","serviceId":"server","purpose":"server.http.auth.credential","label":"edge token","state":"active","createdAt":"2026-10-17T00:00:00Z"}`
	payload := `{"schemaVersion":"service-secret-references/v1","target":"local","serviceId":"server","items":[` + item + `],"pendingRotations":[],"pendingRegistrations":[]}`
	if len(request.Args) > 2 && request.Args[2] == "create" {
		payload = `{"schemaVersion":"service-secret-create-result/v1","target":"local","item":` + item + `}`
	}
	if len(request.Args) > 2 && request.Args[2] == "revoke" {
		payload = `{"schemaVersion":"service-secret-revoke-result/v1","target":"local","serviceId":"server","reference":"ssr:v1:00112233445566778899aabbccddeeff","state":"revoked"}`
	}
	if len(request.Args) > 1 && request.Args[0] == "service" && request.Args[1] == "status" && runner.statusPayload != "" {
		payload = runner.statusPayload
	}
	if len(request.Args) > 1 && request.Args[0] == "service" && request.Args[1] == "manifest" {
		payload = `{"id":"server","secretPurposes":["server.http.auth.credential"]}`
	}
	clear(request.SecretInput)
	if runner.failCreate && len(request.Args) > 2 && request.Args[2] == "create" {
		return closedCLIEvents(models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.failed", Code: "secret.store", Message: "store rejected value: " + secretEcho}), nil
	}
	return closedCLIEvents(models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.output", Payload: []byte(payload)}, models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.completed"}), nil
}

func (runner *metadataCLIRunner) Run(_ context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	runner.request = request
	runner.calls = append(runner.calls, request)
	payload := []byte(metadataManifestFixture)
	if len(request.Args) >= 3 && request.Args[0] == "core" && request.Args[1] == "binary" && request.Args[2] == "inspect" {
		payload = []byte(`{"digest":"sha256:` + strings.Repeat("a", 64) + `","platform":"linux/arm64","sizeBytes":4096}`)
	}
	if len(request.Args) >= 3 && request.Args[0] == "core" && request.Args[1] == "binary" && request.Args[2] == "update" {
		payload = []byte(`{"configured":true,"running":true,"target":"local","digest":"sha256:` + strings.Repeat("a", 64) + `","platform":"linux/arm64"}`)
	}
	if len(request.Args) >= 2 && request.Args[0] == "service" && request.Args[1] == "schema" {
		payload = []byte(`{"type":"object","properties":{"port":{"type":"integer","minimum":1,"maximum":65535}}}`)
		if len(runner.schema) > 0 {
			payload = runner.schema
		}
	}
	if len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "artifact" && request.Args[2] == "inspect" {
		artifact := runner.artifact
		if artifact.ID == "" {
			artifact = models.ArtifactReference{ID: "server", Version: "1.1.4", Platform: "linux/arm64", Digest: "sha256:" + strings.Repeat("c", 64), Trusted: true}
		}
		encoded, marshalErr := json.Marshal(artifact)
		if marshalErr != nil {
			return nil, marshalErr
		}
		payload = encoded
	}
	if len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "resource" && request.Args[2] == "list" {
		payload = []byte(`{"items":[{"value":"site-a","label":"Site A"}]}`)
	}
	if len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "admin-surface" && request.Args[2] == "inspect" {
		payload = []byte(`{"serviceId":"server","digest":"sha256:` + strings.Repeat("a", 64) + `","descriptor":{"pages":[{"id":"sites","sections":[{"id":"sites","actions":[{"id":"publish","title":"Publish","confirmation":"Publish this archive?","artifactInput":{"mediaTypes":["application/gzip"],"maxBytes":134217728,"maxMetadataBytes":65536}}]}]}]}}`)
	}
	if len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "resource" && request.Args[2] == "publish" {
		payload = []byte(`{"operationId":"publish-operation","state":"pending"}`)
	}
	events := make(chan models.CLIEvent, 2)
	events <- models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.output", Payload: payload}
	events <- models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.completed"}
	close(events)
	return events, nil
}

type publicationCLIRunner struct {
	inspect func(models.CLIRequest) error
	metadataCLIRunner
}

func (runner *publicationCLIRunner) Run(ctx context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	if len(request.Args) >= 3 && request.Args[0] == "service" && request.Args[1] == "resource" && request.Args[2] == "publish" && runner.inspect != nil {
		if err := runner.inspect(request); err != nil {
			return nil, err
		}
	}
	return runner.metadataCLIRunner.Run(ctx, request)
}

const metadataManifestFixture = `{"id":"server","configurationUI":{"version":"service-configuration-ui/v1"},"resources":[{"id":"sites","kind":"site","provider":"service-admin","pageId":"sites","queryResource":"sites","valuePointer":"/siteId","labelPointer":"/siteId"},{"id":"project-files","kind":"file","provider":"project"},{"id":"public-certificates","kind":"certificate","provider":"project"}]}`

type blockingCLIRunner struct {
	started chan models.CLIRequest
}

func (runner *blockingCLIRunner) Run(ctx context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	runner.started <- request
	events := make(chan models.CLIEvent)
	go func() {
		<-ctx.Done()
		close(events)
	}()
	return events, nil
}

type gatedCLIRunner struct {
	started chan models.CLIRequest
	finish  chan struct{}
}

func (runner *gatedCLIRunner) Run(ctx context.Context, request models.CLIRequest) (<-chan models.CLIEvent, error) {
	runner.started <- request
	events := make(chan models.CLIEvent)
	go func() {
		defer close(events)
		events <- models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.started", RunID: "run-1"}
		select {
		case <-runner.finish:
			events <- models.CLIEvent{SchemaVersion: "cli-events/v1", Type: "run.completed"}
		case <-ctx.Done():
		}
	}()
	return events, nil
}

func TestRunStudioCommandDoesNotCancelAnExistingCLIProcess(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "busy-project")
	project := models.Project{ID: "project-busy", Name: "Busy", RootPath: root}
	workspace := models.Workspace{Project: &project}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &blockingCLIRunner{started: make(chan models.CLIRequest, 1)}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	if err := app.RunStudioCommand("dev.apply", "local", "", ""); err != nil {
		t.Fatalf("start first CLI command: %v", err)
	}
	request := <-cli.started
	if !reflect.DeepEqual(request.Args, []string{"dev", "apply", "--project", root, "--target", "local", "--confirm", "--wait"}) {
		t.Fatalf("unexpected planned command: %v", request.Args)
	}
	if err := app.RunStudioCommand("validate", "local", "", ""); !errors.Is(err, ErrCLICommandRunning) {
		t.Fatalf("second command error=%v, want %v", err, ErrCLICommandRunning)
	}

	app.CancelCLI()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		app.cliMu.Lock()
		active := app.cliCancel != nil
		app.cliMu.Unlock()
		if !active {
			break
		}
		time.Sleep(time.Millisecond)
	}
	app.cliMu.Lock()
	active := app.cliCancel != nil
	app.cliMu.Unlock()
	if active {
		t.Fatal("CLI slot remained occupied after cancellation completed")
	}
}

func TestRunStudioCommandAndWaitHoldsTheCLIQueueUntilTerminalEvent(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "wait-project")
	project := models.Project{ID: "project-wait", Name: "Wait", RootPath: root}
	workspace := models.Workspace{Project: &project}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &gatedCLIRunner{started: make(chan models.CLIRequest, 1), finish: make(chan struct{})}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	result := make(chan error, 1)
	go func() { result <- app.RunStudioCommandAndWait("dev.apply", "local", "", "") }()
	select {
	case <-cli.started:
	case err := <-result:
		t.Fatalf("wait command failed before process start: %v", err)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the CLI process to start")
	}
	if err := app.RunStudioCommand("validate", "local", "", ""); !errors.Is(err, ErrCLICommandRunning) {
		t.Fatalf("concurrent command error=%v, want %v", err, ErrCLICommandRunning)
	}
	select {
	case err := <-result:
		t.Fatalf("wait returned before the CLI terminal event: %v", err)
	default:
	}
	close(cli.finish)
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("waited CLI command failed: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the CLI terminal event")
	}
}

func TestRunStudioRuntimeCommandHoldsTheCLIQueueUntilTerminalEvent(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "runtime-wait-project")
	project := models.Project{ID: "runtime-wait", Name: "Runtime wait", RootPath: root}
	workspace := models.Workspace{Project: &project}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &gatedCLIRunner{started: make(chan models.CLIRequest, 1), finish: make(chan struct{})}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	result := make(chan error, 1)
	go func() { result <- app.RunStudioRuntimeCommand("runtime.start", "server") }()
	select {
	case request := <-cli.started:
		if !slices.Contains(request.Args, "--service") || !slices.Contains(request.Args, "server") || !slices.Contains(request.Args, "--target") || !slices.Contains(request.Args, "local") {
			t.Fatalf("runtime command lost its typed service/target scope: %v", request.Args)
		}
	case err := <-result:
		t.Fatalf("runtime command failed before starting: %v", err)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the runtime CLI process to start")
	}
	if err := app.RunStudioCommand("validate", "local", "", ""); !errors.Is(err, ErrCLICommandRunning) {
		t.Fatalf("concurrent command error=%v, want %v", err, ErrCLICommandRunning)
	}
	select {
	case err := <-result:
		t.Fatalf("runtime command returned before the terminal event: %v", err)
	default:
	}
	close(cli.finish)
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("runtime command failed after terminal event: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for the runtime CLI terminal event")
	}
}

func TestReadRuntimeServiceMetadataUsesExplicitRegisteredProjectAndServiceIntent(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "metadata-project")
	project := models.Project{ID: "project-a", Name: "Metadata", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server"}}}}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	body, err := app.ReadRuntimeServiceMetadata("project-a", "server", "manifest")
	if err != nil || !strings.Contains(body, "service-configuration-ui/v1") {
		t.Fatalf("metadata body=%s err=%v", body, err)
	}
	wantArgs := []string{"service", "manifest", "server", "--target", "local"}
	if !reflect.DeepEqual(cli.request.Args, wantArgs) || cli.request.ProjectRoot != root {
		t.Fatalf("CLI request=%+v; want project=%q args=%q", cli.request, root, wantArgs)
	}
}

func TestReadRuntimeServiceAdminSurfaceUsesCoreBackedTypedCLI(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "admin-surface-project")
	project := models.Project{ID: "project-a", Name: "Admin surface", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server"}}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	body, err := app.ReadRuntimeServiceAdminSurface(project.ID, "server")
	if err != nil || !strings.Contains(body, `"digest"`) {
		t.Fatalf("admin surface body=%s err=%v", body, err)
	}
	wantArgs := []string{"service", "admin-surface", "inspect", "server", "--target", "local"}
	if !reflect.DeepEqual(cli.request.Args, wantArgs) || cli.request.ProjectRoot != root {
		t.Fatalf("CLI request=%+v; want project=%q args=%q", cli.request, root, wantArgs)
	}
}

func TestCoreBinaryUpdateUsesOneReviewedTypedCLIOperation(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "core-update-project")
	project := models.Project{ID: "core-update-project", Name: "Core update", RootPath: root}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	workspace := models.Workspace{Project: &project}
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)
	path := filepath.Join(string(filepath.Separator), "tmp", "core-candidate")
	digest := "sha256:" + strings.Repeat("a", 64)

	inspection, err := app.InspectCoreBinary(path)
	if err != nil || !strings.Contains(inspection, digest) {
		t.Fatalf("Core binary inspection=%s err=%v", inspection, err)
	}
	if _, err := app.UpdateLocalCoreBinary(path, digest, true); err != nil {
		t.Fatalf("Core binary update failed: %v", err)
	}
	want := [][]string{
		{"core", "binary", "inspect", "--path", path},
		{"core", "binary", "inspect", "--path", path},
		{"core", "binary", "update", "--target", "local", "--path", path, "--digest", digest, "--confirm"},
	}
	if len(cli.calls) != len(want) {
		t.Fatalf("CLI call count=%d, want %d: %+v", len(cli.calls), len(want), cli.calls)
	}
	for index := range want {
		if !reflect.DeepEqual(cli.calls[index].Args, want[index]) || cli.calls[index].ProjectRoot != root {
			t.Errorf("CLI call %d=%+v, want project=%q args=%q", index, cli.calls[index], root, want[index])
		}
	}
}

func TestImportServiceSettingsSchemaUsesCoreBackedTypedCLIAndCreatesMissingCanonicalFile(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "project-schema-import", Name: "Schema import", RootPath: root}
	service := models.RuntimeService{ID: "server", SettingsPath: "services/server/settings.json", SettingsSchemaPath: "schemas/server/settings.json"}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{service}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	files := projectfs.FileSystem{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, files, settingsinfra.Store{Files: files}, cli, nil, nil, nil, nil, nil, nil, nil)

	refreshed, err := app.ImportServiceSettingsSchema(project.ID, service.ID)
	if err != nil || refreshed.Project == nil || refreshed.Project.ID != project.ID {
		t.Fatalf("schema import returned workspace=%+v err=%v", refreshed, err)
	}
	contents, err := files.ReadFile(context.Background(), root, service.SettingsSchemaPath)
	if err != nil || !strings.Contains(string(contents), "65535") {
		t.Fatalf("canonical schema file=%s err=%v", contents, err)
	}
	wantArgs := []string{"service", "schema", "server", "--target", "local"}
	if !reflect.DeepEqual(cli.request.Args, wantArgs) || cli.request.ProjectRoot != root {
		t.Fatalf("schema was not fetched through the typed Core-backed CLI: %+v", cli.request)
	}
}

func TestImportServiceSettingsSchemaNeverOverwritesAnExistingProjectFile(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "project-schema-existing", Name: "Schema existing", RootPath: root}
	service := models.RuntimeService{ID: "server", SettingsPath: "services/server/settings.json", SettingsSchemaPath: "schemas/server/settings.json"}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{service}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	files := projectfs.FileSystem{}
	if err := files.WriteFile(context.Background(), root, service.SettingsSchemaPath, []byte(`{"type":"string"}`)); err != nil {
		t.Fatal(err)
	}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, files, settingsinfra.Store{Files: files}, cli, nil, nil, nil, nil, nil, nil, nil)
	if _, err := app.ImportServiceSettingsSchema(project.ID, service.ID); !errors.Is(err, os.ErrExist) {
		t.Fatalf("expected an explicit no-overwrite error, got %v", err)
	}
	contents, err := files.ReadFile(context.Background(), root, service.SettingsSchemaPath)
	if err != nil || string(contents) != `{"type":"string"}` {
		t.Fatalf("existing schema was overwritten: %s (%v)", contents, err)
	}
	if len(cli.calls) != 0 {
		t.Fatalf("existing schema should be checked before calling Core: %+v", cli.calls)
	}
}

func TestRefreshServiceSettingsSchemaReplacesOnlyTheDerivedSchemaThroughCoreCLI(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "project-schema-refresh", Name: "Schema refresh", RootPath: root}
	service := models.RuntimeService{ID: "server", SettingsPath: "services/server/settings.json", SettingsSchemaPath: "schemas/server/settings.json"}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{service}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	cli.schema = []byte(`{"type":"object","required":["port"],"properties":{"port":{"type":"integer","minimum":1,"maximum":65535},"apiToken":{"type":"string","writeOnly":true,"default":"must-not-leak"}}}`)
	files := projectfs.FileSystem{}
	if err := files.WriteFile(context.Background(), root, service.SettingsSchemaPath, []byte(`{"type":"object","properties":{"port":{"type":"integer","minimum":1}}}`)); err != nil {
		t.Fatal(err)
	}
	if err := files.WriteFile(context.Background(), root, service.SettingsPath, []byte(`{"port":8080}`)); err != nil {
		t.Fatal(err)
	}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, files, settingsinfra.Store{Files: files}, cli, nil, nil, nil, nil, nil, nil, nil)
	const patch = `{"port":9000}`
	preview, err := app.PreviewServiceSettingsSchema(project.ID, service.ID, patch)
	if err != nil || !preview.ValuesCompatible || preview.SchemaJSON == "" || preview.MigrationChangedPaths == nil {
		t.Fatalf("schema preview=%+v err=%v", preview, err)
	}
	previewJSON, marshalErr := json.Marshal(preview)
	if marshalErr != nil || strings.Contains(string(previewJSON), `"migrationChangedPaths":null`) {
		t.Fatalf("non-migration preview must serialize an empty changed-path list: %s err=%v", previewJSON, marshalErr)
	}
	if strings.Contains(preview.SchemaJSON, "must-not-leak") {
		t.Fatalf("schema preview disclosed a sensitive default: %s", preview.SchemaJSON)
	}
	refreshed, err := app.RefreshServiceSettingsSchema(project.ID, service.ID, string(previewJSON), patch)
	if err != nil || refreshed.Project == nil || refreshed.Project.ID != project.ID {
		t.Fatalf("schema refresh returned workspace=%+v err=%v", refreshed, err)
	}
	schema, err := files.ReadFile(context.Background(), root, service.SettingsSchemaPath)
	if err != nil || !strings.Contains(string(schema), "65535") {
		t.Fatalf("derived schema was not refreshed: %s (%v)", schema, err)
	}
	settings, err := files.ReadFile(context.Background(), root, service.SettingsPath)
	if err != nil || string(settings) != `{"port":8080}` {
		t.Fatalf("settings values were mutated during schema refresh: %s (%v)", settings, err)
	}
	if len(cli.calls) != 2 || !reflect.DeepEqual(cli.request.Args, []string{"service", "schema", "server", "--target", "local"}) || cli.request.ProjectRoot != root {
		t.Fatalf("schema refresh did not use typed Core-backed CLI: %+v", cli.calls)
	}
}

func TestRefreshServiceSettingsSchemaMigratesOnlyTheVersionAndKeepsExactRecoveryCopies(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "project-schema-migration", Name: "Schema migration", RootPath: root}
	service := models.RuntimeService{ID: "server", SettingsPath: "services/server/settings.json", SettingsSchemaPath: "schemas/server/settings.json"}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{service}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	oldSchema := []byte(`{"type":"object","required":["schemaVersion","config"],"properties":{"schemaVersion":{"const":1},"config":{"type":"object","additionalProperties":true}}}`)
	newSchema := []byte(`{"type":"object","required":["schemaVersion","config"],"additionalProperties":false,"properties":{"schemaVersion":{"const":2},"config":{"type":"object","additionalProperties":true}}}`)
	originalSettings := []byte(`{"schemaVersion":1,"config":{"unknown":{"keep":"opaque"}},"legacyField":{"preserve":true}}`)
	cli.schema = newSchema
	files := projectfs.FileSystem{}
	if err := files.WriteFile(context.Background(), root, service.SettingsSchemaPath, oldSchema); err != nil {
		t.Fatal(err)
	}
	if err := files.WriteFile(context.Background(), root, service.SettingsPath, originalSettings); err != nil {
		t.Fatal(err)
	}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, files, settingsinfra.Store{Files: files}, cli, nil, nil, nil, nil, nil, nil, nil)
	preview, err := app.PreviewServiceSettingsSchema(project.ID, service.ID, `{}`)
	if err != nil || !preview.MigrationRequired || preview.MigrationFromVersion != 1 || preview.MigrationToVersion != 2 || preview.ValuesCompatible {
		t.Fatalf("migration preview=%+v err=%v", preview, err)
	}
	if !reflect.DeepEqual(preview.MigrationChangedPaths, []string{"/schemaVersion"}) || preview.RecoveryCopyPath == "" || !validSettingsDigest(preview.MigrationCandidateDigest) {
		t.Fatalf("migration preview lacks bounded review metadata: %+v", preview)
	}
	settingsBefore, err := files.ReadFile(context.Background(), root, service.SettingsPath)
	if err != nil || !reflect.DeepEqual(settingsBefore, originalSettings) {
		t.Fatalf("preview mutated the source Project file: %s err=%v", settingsBefore, err)
	}
	previewJSON, err := json.Marshal(preview)
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := app.RefreshServiceSettingsSchema(project.ID, service.ID, string(previewJSON), `{}`)
	if err != nil || refreshed.Project == nil || refreshed.Project.ID != project.ID {
		t.Fatalf("schema migration failed: workspace=%+v err=%v", refreshed, err)
	}
	migratedSettings, err := files.ReadFile(context.Background(), root, service.SettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	var migrated map[string]json.RawMessage
	if json.Unmarshal(migratedSettings, &migrated) != nil || string(migrated["schemaVersion"]) != "2" || string(migrated["config"]) != `{"unknown":{"keep":"opaque"}}` || string(migrated["legacyField"]) != `{"preserve":true}` {
		t.Fatalf("migration changed fields other than schemaVersion: %s", migratedSettings)
	}
	recoveredSettings, err := files.ReadFile(context.Background(), root, preview.RecoveryCopyPath)
	if err != nil || !reflect.DeepEqual(recoveredSettings, originalSettings) {
		t.Fatalf("exact original settings bytes were not preserved: %s err=%v", recoveredSettings, err)
	}
	recoveredSchema, err := files.ReadFile(context.Background(), root, preview.RecoverySchemaCopyPath)
	if err != nil || !reflect.DeepEqual(recoveredSchema, oldSchema) {
		t.Fatalf("exact original schema bytes were not preserved: %s err=%v", recoveredSchema, err)
	}
	updatedSchema, err := files.ReadFile(context.Background(), root, service.SettingsSchemaPath)
	expectedSchema, schemaErr := safeCLIJSON(newSchema)
	if err != nil || schemaErr != nil || !reflect.DeepEqual(updatedSchema, expectedSchema) {
		t.Fatalf("new schema was not installed: %s err=%v schemaErr=%v", updatedSchema, err, schemaErr)
	}
}

func TestCreateServiceSettingsRecoveryCopyPreservesReviewedBytesAndRejectsStaleDigest(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "project-settings-recovery", Name: "Settings recovery", RootPath: root}
	service := models.RuntimeService{ID: "server", SettingsPath: "services/server/settings.json", SettingsSchemaPath: "schemas/server/settings.json"}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{service}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	files := projectfs.FileSystem{}
	original := []byte("{\n  \"schemaVersion\": 1,\n  \"legacy\": { \"keep\": true }\n}\n")
	if err := files.WriteFile(context.Background(), root, service.SettingsPath, original); err != nil {
		t.Fatal(err)
	}
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(original))
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, files, settingsinfra.Store{Files: files}, nil, nil, nil, nil, nil, nil, nil, nil)

	copy, err := app.CreateServiceSettingsRecoveryCopy(project.ID, service.ID, digest)
	if err != nil || copy.Path == "" || copy.Digest != digest {
		t.Fatalf("recovery copy=%+v err=%v", copy, err)
	}
	recovered, err := files.ReadFile(context.Background(), root, copy.Path)
	if err != nil || !reflect.DeepEqual(recovered, original) {
		t.Fatalf("recovery copy did not retain exact source bytes: %q err=%v", recovered, err)
	}
	info, err := os.Stat(filepath.Join(root, filepath.FromSlash(copy.Path)))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("recovery copy permissions=%v err=%v", info, err)
	}
	if _, staleErr := app.CreateServiceSettingsRecoveryCopy(project.ID, service.ID, "sha256:"+strings.Repeat("0", 64)); !errors.Is(staleErr, ErrSchemaPreviewStale) {
		t.Fatalf("stale digest should be rejected, got %v", staleErr)
	}
	unchanged, err := files.ReadFile(context.Background(), root, service.SettingsPath)
	if err != nil || !reflect.DeepEqual(unchanged, original) {
		t.Fatalf("backup operation mutated Project settings: %q err=%v", unchanged, err)
	}
}

func TestRefreshServiceSettingsSchemaRejectsChangedSettingsAfterPreview(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "project-schema-preview-stale", Name: "Schema preview", RootPath: root}
	service := models.RuntimeService{ID: "server", SettingsPath: "services/server/settings.json", SettingsSchemaPath: "schemas/server/settings.json"}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{service}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	files := projectfs.FileSystem{}
	if err := files.WriteFile(context.Background(), root, service.SettingsSchemaPath, []byte(`{"type":"object","properties":{"port":{"type":"integer"}}}`)); err != nil {
		t.Fatal(err)
	}
	if err := files.WriteFile(context.Background(), root, service.SettingsPath, []byte(`{"port":8080}`)); err != nil {
		t.Fatal(err)
	}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, files, settingsinfra.Store{Files: files}, cli, nil, nil, nil, nil, nil, nil, nil)
	const patch = `{}`
	preview, err := app.PreviewServiceSettingsSchema(project.ID, service.ID, patch)
	if err != nil {
		t.Fatal(err)
	}
	err = files.WriteFile(context.Background(), root, service.SettingsPath, []byte(`{"port":8081}`))
	if err != nil {
		t.Fatal(err)
	}
	previewJSON, marshalErr := json.Marshal(preview)
	if marshalErr != nil {
		t.Fatal(marshalErr)
	}
	_, err = app.RefreshServiceSettingsSchema(project.ID, service.ID, string(previewJSON), patch)
	if !errors.Is(err, ErrSchemaPreviewStale) {
		t.Fatalf("expected stale preview rejection, got %v", err)
	}
	schema, err := files.ReadFile(context.Background(), root, service.SettingsSchemaPath)
	if err != nil || !strings.Contains(string(schema), `"type":"integer"`) || strings.Contains(string(schema), "65535") {
		t.Fatalf("stale preview changed Project schema: %s (%v)", schema, err)
	}
	err = files.WriteFile(context.Background(), root, service.SettingsPath, []byte(`{"port":8080}`))
	if err != nil {
		t.Fatal(err)
	}
	cli.schema = []byte(`{"type":"object","properties":{"port":{"type":"integer","maximum":100}}}`)
	_, err = app.RefreshServiceSettingsSchema(project.ID, service.ID, string(previewJSON), patch)
	if !errors.Is(err, ErrSchemaPreviewStale) {
		t.Fatalf("expected changed live schema rejection, got %v", err)
	}
	cli.schema = nil
	_, err = app.RefreshServiceSettingsSchema(project.ID, service.ID, string(previewJSON), `{"port":8081}`)
	if !errors.Is(err, ErrSchemaPreviewStale) {
		t.Fatalf("expected changed draft rejection, got %v", err)
	}
	schemaAfter, err := files.ReadFile(context.Background(), root, service.SettingsSchemaPath)
	if err != nil || !reflect.DeepEqual(schema, schemaAfter) {
		t.Fatalf("rejected stale previews changed Project schema: before=%s after=%s err=%v", schema, schemaAfter, err)
	}
}

func TestBindRuntimeServiceArtifactRequiresTrustedCLIRegistryEntry(t *testing.T) {
	root := t.TempDir()
	project := models.Project{ID: "project-artifact-binding", Name: "Artifact binding", RootPath: root}
	if err := os.WriteFile(filepath.Join(root, "project.yaml"), []byte("id: project-artifact-binding\nname: Artifact binding\nversion: 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	serviceRoot := filepath.Join(root, "services", "server")
	if err := os.MkdirAll(serviceRoot, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(serviceRoot, "service.yaml"), []byte("id: server\nversion: 1.1.4\nmanifestVersion: studio-runtime/v1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	store := metadataProjectStore{projects: []models.Project{project}}
	workspaceStore := workspaceapp.New(store, projectinfra.Source{})
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceStore, nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil, projectinfra.Mutations{})
	refreshed, err := app.BindRuntimeServiceArtifact(project.ID, "server", "1.1.4", "linux/arm64")
	if err != nil || refreshed.Project == nil || len(refreshed.Graph.Services) != 1 || refreshed.Graph.Services[0].Artifact == nil {
		t.Fatalf("bind returned workspace=%+v err=%v", refreshed, err)
	}
	wantArgs := []string{"service", "artifact", "inspect", "--id", "server", "--version", "1.1.4", "--platform", "linux/arm64"}
	if !reflect.DeepEqual(cli.request.Args, wantArgs) || cli.request.ProjectRoot != root {
		t.Fatalf("artifact was not resolved through exact typed CLI intent: %+v", cli.request)
	}
	manifest, err := os.ReadFile(filepath.Join(serviceRoot, "service.yaml")) //nolint:gosec // test project path.
	if err != nil || !strings.Contains(string(manifest), "digest: sha256:") || strings.Contains(string(manifest), root) {
		t.Fatalf("Project reference is missing or contains local path: %s (%v)", manifest, err)
	}

	cli.artifact = models.ArtifactReference{ID: "server", Version: "1.1.4", Platform: "linux/arm64", Digest: "sha256:" + strings.Repeat("c", 64), Trusted: false}
	if _, bindErr := app.BindRuntimeServiceArtifact(project.ID, "server", "1.1.4", "linux/arm64"); bindErr == nil {
		t.Fatal("untrusted CLI artifact was bound to the Project")
	}
	manifestAfter, err := os.ReadFile(filepath.Join(serviceRoot, "service.yaml")) //nolint:gosec // test project path.
	if err != nil || !reflect.DeepEqual(manifest, manifestAfter) {
		t.Fatalf("rejected untrusted artifact changed Project: before=%s after=%s err=%v", manifest, manifestAfter, err)
	}
}

func TestRemoveRuntimeArtifactRequiresExactDigestConfirmation(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "artifact-removal")
	project := models.Project{ID: "artifact-removal", Name: "Artifact removal", RootPath: root}
	store := selectedProjectStore{metadataProjectStore: metadataProjectStore{projects: []models.Project{project}}}
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: models.Workspace{Project: &project}}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)
	digest := "sha256:" + strings.Repeat("c", 64)
	if err := app.RemoveRuntimeArtifact("server", "1.1.4", "linux/arm64", digest, true); err != nil {
		t.Fatal(err)
	}
	wantInspect := []string{"service", "artifact", "inspect", "--id", "server", "--version", "1.1.4", "--platform", "linux/arm64"}
	wantRemove := []string{"service", "artifact", "remove", "--id", "server", "--version", "1.1.4", "--platform", "linux/arm64"}
	if len(cli.calls) != 2 || !reflect.DeepEqual(cli.calls[0].Args, wantInspect) || !reflect.DeepEqual(cli.calls[1].Args, wantRemove) {
		t.Fatalf("artifact removal did not verify then invoke typed CLI intents: %+v", cli.calls)
	}
	cli.calls = nil
	if err := app.RemoveRuntimeArtifact("server", "1.1.4", "linux/arm64", "sha256:"+strings.Repeat("d", 64), true); err == nil || len(cli.calls) != 1 {
		t.Fatalf("digest mismatch removal result err=%v calls=%+v; want refusal after one inspect", err, cli.calls)
	}
	cli.calls = nil
	if err := app.RemoveRuntimeArtifact("server", "1.1.4", "linux/arm64", digest, false); err == nil || len(cli.calls) != 0 {
		t.Fatalf("unconfirmed removal result err=%v calls=%+v; want refusal before CLI", err, cli.calls)
	}
}

func TestReadRuntimeServiceResourceUsesTypedCLIIntentAndExplicitProject(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "resource-project")
	project := models.Project{ID: "project-resource", Name: "Resource", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server"}}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, nil, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	body, err := app.ReadRuntimeServiceResource("project-resource", "server", "sites")
	var result struct {
		Items []struct {
			Value string `json:"value"`
			Label string `json:"label"`
		} `json:"items"`
	}
	if err != nil || json.Unmarshal([]byte(body), &result) != nil || len(result.Items) != 1 || result.Items[0].Value != "site-a" || result.Items[0].Label != "Site A" {
		t.Fatalf("resource result=%s err=%v", body, err)
	}
	wantArgs := []string{"service", "resource", "list", "server", "--resource", "sites", "--target", "local"}
	if !reflect.DeepEqual(cli.request.Args, wantArgs) || cli.request.ProjectRoot != root {
		t.Fatalf("CLI request=%+v; want project=%q args=%q", cli.request, root, wantArgs)
	}
	if len(cli.calls) != 2 || !reflect.DeepEqual(cli.calls[0].Args, []string{"service", "manifest", "server", "--target", "local"}) {
		t.Fatalf("resource catalog was not authorized by a Core-backed live manifest: %+v", cli.calls)
	}
}

func TestStageServiceArtifactSnapshotIsPrivateBoundedAndDigestAddressed(t *testing.T) {
	root := t.TempDir()
	files := projectfs.FileSystem{}
	contents := []byte("reviewed artifact bytes")
	if err := files.WriteFile(context.Background(), root, "resources/site.tar.gz", contents); err != nil {
		t.Fatal(err)
	}
	stagedPath, size, digest, cleanup, err := stageServiceArtifactSnapshot(root, "resources/site.tar.gz", int64(len(contents)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if cleanupErr := cleanup(); cleanupErr != nil {
			t.Errorf("clean up staged artifact: %v", cleanupErr)
		}
	})
	wantDigest := sha256.Sum256(contents)
	if size != int64(len(contents)) || digest != fmt.Sprintf("sha256:%x", wantDigest) || !strings.HasPrefix(stagedPath, ".studio/resource-publish-") {
		t.Fatalf("snapshot provenance = path %q size %d digest %q", stagedPath, size, digest)
	}
	stagedInfo, err := os.Stat(filepath.Join(root, filepath.FromSlash(stagedPath)))
	if err != nil {
		t.Fatal(err)
	}
	if stagedInfo.Mode().Perm()&0222 != 0 {
		t.Fatalf("snapshot must be read-only before it is reviewed: mode=%v", stagedInfo.Mode())
	}
	staged, err := fs.ReadFile(os.DirFS(root), stagedPath)
	if err != nil || !reflect.DeepEqual(staged, contents) {
		t.Fatalf("snapshot bytes = %q err=%v", staged, err)
	}
	if writeErr := files.WriteFile(context.Background(), root, "resources/site.tar.gz", []byte("changed source")); writeErr != nil {
		t.Fatal(writeErr)
	}
	staged, err = fs.ReadFile(os.DirFS(root), stagedPath)
	if err != nil || !reflect.DeepEqual(staged, contents) {
		t.Fatalf("snapshot changed with canonical Project source: %q err=%v", staged, err)
	}
	if _, _, _, _, err := stageServiceArtifactSnapshot(root, "resources/site.tar.gz", 4); err == nil {
		t.Fatal("oversized Project source was staged")
	}
	if _, _, _, _, err := stageServiceArtifactSnapshot(root, "../outside.tar.gz", 1024); err == nil {
		t.Fatal("path outside Project was staged")
	}
}

func TestPublishRuntimeServiceResourceJSONConfirmsScopesAndCleansStagedMetadata(t *testing.T) {
	root := t.TempDir()
	files := projectfs.FileSystem{}
	ctx := context.Background()
	archive := []byte("archive-data")
	if err := files.WriteFile(ctx, root, "resources/site.tar.gz", archive); err != nil {
		t.Fatal(err)
	}
	project := models.Project{ID: "publish-json-project", Name: "Publish JSON", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server"}}}, Files: []models.ProjectFile{{Path: "resources/site.tar.gz", Kind: "file", Bytes: int64(len(archive))}}}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &publicationCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, files, nil, cli, nil, nil, nil, nil, nil, nil, nil)
	confirmed := false
	archiveDigest := sha256.Sum256(archive)
	cli.inspect = func(request models.CLIRequest) error {
		var staged string
		for index, argument := range request.Args {
			if argument == "--artifact-file" && index+1 < len(request.Args) {
				staged = request.Args[index+1]
				break
			}
		}
		if !strings.HasPrefix(staged, ".studio/resource-publish-") {
			return fmt.Errorf("artifact was not staged privately: %q", staged)
		}
		actual, readErr := fs.ReadFile(os.DirFS(root), filepath.ToSlash(staged))
		if readErr != nil {
			return fmt.Errorf("read staged artifact at CLI boundary: %w", readErr)
		}
		if !reflect.DeepEqual(actual, archive) {
			return fmt.Errorf("CLI did not receive the reviewed immutable bytes: %q", actual)
		}
		return nil
	}
	confirm := func(ctx context.Context, title, message string) (bool, error) {
		confirmed = title == "Confirm service action" && strings.Contains(message, "Publish this archive?") &&
			strings.Contains(message, "Project file: site.tar.gz") && strings.Contains(message, fmt.Sprintf("Bytes: %d", len(archive))) &&
			strings.Contains(message, fmt.Sprintf("SHA-256: sha256:%x", archiveDigest))
		// Simulate an external editor replacing the source after confirmation. The
		// CLI must still publish the byte snapshot whose digest was approved.
		if writeErr := files.WriteFile(ctx, root, "resources/site.tar.gz", []byte("concurrent replacement")); writeErr != nil {
			return false, writeErr
		}
		return confirmed, nil
	}

	response, err := app.publishRuntimeServiceResourceJSON(project.ID, "server", "sites", "publish", "resources/site.tar.gz", "application/gzip", `{"siteId":"docs"}`, "revision-1", confirm)
	if err != nil || !strings.Contains(response, "publish-operation") || !confirmed || len(cli.calls) != 2 {
		t.Fatalf("publish response=%s confirmed=%t calls=%d err=%v", response, confirmed, len(cli.calls), err)
	}
	publish := cli.calls[1]
	if publish.Args[0] != "service" || publish.Args[1] != "resource" || publish.Args[2] != "publish" || publish.ProjectRoot != root {
		t.Fatalf("service publication did not use typed project-scoped CLI: %+v", publish)
	}
	metadataFlag := -1
	artifactFlag := -1
	for index, arg := range publish.Args {
		if arg == "--artifact-file" && index+1 < len(publish.Args) {
			artifactFlag = index + 1
		}
		if arg == "--metadata-file" && index+1 < len(publish.Args) {
			metadataFlag = index + 1
		}
		if strings.Contains(arg, "siteId") || strings.Contains(arg, "docs") {
			t.Fatalf("metadata leaked into CLI argv: %#v", publish.Args)
		}
	}
	if artifactFlag < 0 || !strings.HasPrefix(publish.Args[artifactFlag], ".studio/resource-publish-") {
		t.Fatalf("expected immutable staged artifact path, got %#v", publish.Args)
	}
	if metadataFlag < 0 || !strings.HasPrefix(publish.Args[metadataFlag], ".studio/resource-action-") {
		t.Fatalf("expected private staged metadata path, got %#v", publish.Args)
	}
	stagedArtifact := filepath.Join(root, filepath.FromSlash(publish.Args[artifactFlag]))
	if _, err := os.Stat(stagedArtifact); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staged artifact should be cleaned after the CLI operation: %v", err)
	}
	staged := filepath.Join(root, filepath.FromSlash(publish.Args[metadataFlag]))
	if _, err := os.Stat(staged); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staged metadata should be cleaned after the CLI operation: %v", err)
	}
}

func TestPublishRuntimeServiceResourceJSONStopsWhenNativeConfirmationIsDenied(t *testing.T) {
	root := t.TempDir()
	files := projectfs.FileSystem{}
	if err := files.WriteFile(context.Background(), root, "resources/site.tar.gz", []byte("archive")); err != nil {
		t.Fatal(err)
	}
	project := models.Project{ID: "publish-denied-project", Name: "Publish denied", RootPath: root}
	workspace := models.Workspace{Project: &project, Graph: models.ServiceGraph{Services: []models.RuntimeService{{ID: "server"}}}, Files: []models.ProjectFile{{Path: "resources/site.tar.gz", Kind: "file", Bytes: 7}}}
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceapp.New(metadataProjectStore{projects: []models.Project{project}}, metadataProjectSource{workspace: workspace}), nil, files, nil, cli, nil, nil, nil, nil, nil, nil, nil)
	confirm := func(context.Context, string, string) (bool, error) { return false, nil }
	if _, err := app.publishRuntimeServiceResourceJSON(project.ID, "server", "sites", "publish", "resources/site.tar.gz", "application/gzip", `{"siteId":"docs"}`, "", confirm); err == nil || !strings.Contains(err.Error(), "cancelled") || len(cli.calls) != 1 {
		t.Fatalf("denied action should stop before publish: calls=%d err=%v", len(cli.calls), err)
	}
}

func TestReadProjectResourceCatalogReturnsOnlySafeProjectReferences(t *testing.T) {
	root := t.TempDir()
	publicCertificate := testPublicCertificate(t)
	tooLongResourcePath := "docs/" + strings.Repeat("a", 180) + "/" + strings.Repeat("b", 180) + "/" + strings.Repeat("c", 180) + ".txt"
	files := map[string][]byte{
		"project.yaml":             []byte("id: project-resources\nname: Resources\n"),
		"docs/readme.md":           []byte("Safe project document"),
		"certs/public.pem":         publicCertificate,
		"certs/combined.pem":       append(append([]byte(nil), publicCertificate...), []byte("-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n")...),
		"certs/private-key.pem":    []byte("-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n"),
		"certs/tls.key":            []byte("private material"),
		"credentials/operator.txt": []byte("never list this"),
		".env":                     []byte("TOKEN=never-list-this"),
		"secrets/notes.txt":        []byte("never list this"),
		"docs/untrusted\npath.md":  []byte("never list this"),
		tooLongResourcePath:        []byte("never list this"),
	}
	projectFiles := make([]models.ProjectFile, 0, len(files))
	for relative, contents := range files {
		if err := (projectfs.FileSystem{}).WriteFile(context.Background(), root, relative, contents); err != nil {
			t.Fatalf("write project fixture %q: %v", relative, err)
		}
		projectFiles = append(projectFiles, models.ProjectFile{Path: relative, Kind: "file", Bytes: int64(len(contents))})
	}
	project := models.Project{ID: "project-resources", Name: "Resources", RootPath: root}
	workspace := models.Workspace{
		Project: &project,
		Files:   projectFiles,
		Graph:   models.ServiceGraph{Services: []models.RuntimeService{{ID: "server"}}},
	}
	store := metadataProjectStore{projects: []models.Project{project}}
	cli := &metadataCLIRunner{}
	app := NewApp(nil, workspaceapp.New(store, metadataProjectSource{workspace: workspace}), nil, projectfs.FileSystem{}, nil, cli, nil, nil, nil, nil, nil, nil, nil)

	fileCatalog, err := app.ReadRuntimeServiceResource(project.ID, "server", "project-files")
	if err != nil {
		t.Fatalf("read project file catalog: %v", err)
	}
	if strings.Contains(fileCatalog, "TOKEN") || strings.Contains(fileCatalog, "private-key") || strings.Contains(fileCatalog, "tls.key") || strings.Contains(fileCatalog, ".pem") || strings.Contains(fileCatalog, "credentials") || strings.Contains(fileCatalog, "secrets") || strings.Contains(fileCatalog, "untrusted") || strings.Contains(fileCatalog, tooLongResourcePath) {
		t.Fatalf("unsafe project entries leaked: %s", fileCatalog)
	}
	if !strings.Contains(fileCatalog, "docs/readme.md") || strings.Contains(fileCatalog, "certs/public.pem") {
		t.Fatalf("file catalog contains an unexpected entry: %s", fileCatalog)
	}
	if len(cli.calls) != 1 || !reflect.DeepEqual(cli.calls[0].Args, []string{"service", "manifest", "server", "--target", "local"}) {
		t.Fatalf("project catalog unexpectedly invoked a service admin resource command: %+v", cli.calls)
	}

	cli.calls = nil
	certificateCatalog, err := app.ReadRuntimeServiceResource(project.ID, "server", "public-certificates")
	if err != nil {
		t.Fatalf("read public certificate catalog: %v", err)
	}
	if !strings.Contains(certificateCatalog, "certs/public.pem") || strings.Contains(certificateCatalog, "private-key") || strings.Contains(certificateCatalog, "combined.pem") || strings.Contains(certificateCatalog, "BEGIN CERTIFICATE") {
		t.Fatalf("certificate catalog must contain only safe references: %s", certificateCatalog)
	}
	if len(cli.calls) != 1 || !reflect.DeepEqual(cli.calls[0].Args, []string{"service", "manifest", "server", "--target", "local"}) {
		t.Fatalf("certificate catalog unexpectedly invoked a service admin resource command: %+v", cli.calls)
	}
}

func testPublicCertificate(t *testing.T) []byte {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, publicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func TestPluginProcessFailureDiagnosticIsDeduplicatedUntilRestart(t *testing.T) {
	store := &diagnosticStoreStub{}
	app := &App{diagnostics: store}

	app.recordStudioPluginProcessFailure(t.TempDir(), "example.plugin", "1.0.0", "process.exit")
	app.recordStudioPluginProcessFailure(t.TempDir(), "example.plugin", "1.0.0", "process.exit")
	if len(store.items) != 1 {
		t.Fatalf("expected one diagnostic for repeated status polling, got %d", len(store.items))
	}

	app.clearStudioPluginProcessDiagnostic("example.plugin", "1.0.0")
	app.recordStudioPluginProcessFailure(t.TempDir(), "example.plugin", "1.0.0", "process.exit")
	if len(store.items) != 2 {
		t.Fatalf("expected a new diagnostic after restart, got %d", len(store.items))
	}
}

func TestTrafficViewsAreRedactedAndKeepProvenance(t *testing.T) {
	views, err := trafficViews([]models.Report{{
		OperationID: "operation-1",
		Target:      "local",
		CommitSHA:   "abc123",
		Traffic: []models.TrafficRecord{{
			Caller:          "runtime",
			Target:          "orders",
			Method:          "List",
			RequestPayload:  []byte(`{"token":"secret","query":"safe"}`),
			ResponsePayload: []byte(`{"authorization":"bearer secret","items":[]}`),
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(views) != 1 || views[0].ReportOperationID != "operation-1" || views[0].ReportTarget != "local" || views[0].ReportCommitSHA != "abc123" {
		t.Fatalf("unexpected provenance: %+v", views)
	}
	if strings.Contains(views[0].RequestPayload, "secret") || strings.Contains(views[0].ResponsePayload, "secret") {
		t.Fatalf("secret leaked into renderer view: %+v", views[0])
	}
	if !strings.Contains(views[0].RequestPayload, "[REDACTED]") {
		t.Fatalf("request was not redacted: %s", views[0].RequestPayload)
	}
}

func TestReadImportedReportAllowsOnlyProjectLocalReportFiles(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, ".studio", "reports")
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "operation.json")
	if err := os.WriteFile(path, []byte(`{"projectId":"p"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if data, err := readImportedReport(root, ".studio/reports/operation.json"); err != nil || string(data) != `{"projectId":"p"}` {
		t.Fatalf("read local report: %s %v", data, err)
	}
	if _, err := readImportedReport(root, ".studio/reports/../secrets.json"); err == nil {
		t.Fatal("accepted report outside reports directory")
	}
}

func TestEditorAssociationMatchesProjectFileBasename(t *testing.T) {
	matched, err := matchesEditorAssociation("*.yaml", "services/runtime/service.yaml")
	if err != nil || !matched {
		t.Fatalf("expected extension association to match basename: %v %v", matched, err)
	}
	matched, err = matchesEditorAssociation("services/*.yaml", "services/runtime/service.yaml")
	if err != nil || matched {
		t.Fatalf("unexpected directory association match: %v %v", matched, err)
	}
	if _, err = matchesEditorAssociation("[", "service.yaml"); err == nil {
		t.Fatal("accepted invalid association pattern")
	}
}

func TestEditorAssociationUsesMostSpecificMatchingPattern(t *testing.T) {
	associations := []models.EditorAssociation{
		{Pattern: "*", Application: "/Applications/Default.app"},
		{Pattern: "*.yaml", Application: "/Applications/YAML.app"},
	}
	application, err := associatedEditor(associations, "services/runtime/service.yaml")
	if err != nil || application != "/Applications/YAML.app" {
		t.Fatalf("expected extension-specific editor, got %q: %v", application, err)
	}
	application, err = associatedEditor(associations, "README.md")
	if err != nil || application != "/Applications/Default.app" {
		t.Fatalf("expected global editor fallback, got %q: %v", application, err)
	}
}
