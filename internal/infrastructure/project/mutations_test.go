package project

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
	"gopkg.in/yaml.v3"
)

func TestMutationsWriteCanonicalRuntimeGraph(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	mutations := Mutations{}
	for _, service := range []models.RuntimeServiceInput{{ID: "orders", Name: "Orders", Version: "1.0.0", ManifestVersion: "v1"}, {ID: "billing", Name: "Billing", Version: "1.0.0", ManifestVersion: "v1"}} {
		if err := mutations.CreateRuntimeService(ctx, root, service); err != nil {
			t.Fatal(err)
		}
	}
	input := models.ServiceLinkInput{ID: "orders-to-billing", Caller: "orders", Target: "billing", ContractVersion: "v1", Methods: []string{"charge"}, Transport: "local", SecurityProfile: "default", TimeoutMillis: 1000, RedactionPolicy: "schema"}
	if err := mutations.CreateServiceLink(ctx, root, input); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "services", "orders", "links", "orders-to-billing.json")
	data, err := os.ReadFile(path) //nolint:gosec // path is assembled from fixed validated test identifiers.
	if err != nil {
		t.Fatal(err)
	}
	var contract map[string]any
	if unmarshalErr := json.Unmarshal(data, &contract); unmarshalErr != nil || contract["caller"] != "orders" || contract["target"] != "billing" {
		t.Fatalf("invalid canonical contract: %s", data)
	}
	updated := models.ServiceLinkInput{ID: input.ID, Caller: input.Caller, Target: input.Target, ContractVersion: "v2", Methods: []string{"charge", "refund"}, Transport: "local", RequestSchemaPath: "schemas/charge-request.json", ResponseSchemaPath: "schemas/charge-response.json", ContractSchemaPath: "schemas/contract.json", SecurityProfile: "mtls", TimeoutMillis: 2500, RetryLimit: 2, RequestLimitBytes: 4096, ResponseLimitBytes: 8192, DisabledMethods: []string{"refund"}, Compatibility: "strict", RedactionPolicy: "schema"}
	if updateErr := mutations.UpdateServiceLink(ctx, root, input.Caller, input.ID, updated); updateErr != nil {
		t.Fatal(updateErr)
	}
	data, err = os.ReadFile(path) //nolint:gosec // path is assembled from fixed validated test identifiers.
	if err != nil || json.Unmarshal(data, &contract) != nil || contract["contractVersion"] != "v2" || contract["transport"] != "local" || contract["timeoutMillis"] != float64(2500) {
		t.Fatalf("link update was not persisted atomically: %s (%v)", data, err)
	}
	unsafe := updated
	unsafe.RequestSchemaPath = "../outside.json"
	if err := mutations.UpdateServiceLink(ctx, root, input.Caller, input.ID, unsafe); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("link update accepted a traversal schema reference: %v", err)
	}
	if err := mutations.DeleteServiceLink(ctx, root, "orders", input.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := mutations.DeleteRuntimeService(ctx, root, "billing", true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "services", "billing")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("service directory remains: %v", err)
	}
}

func TestSetRuntimeServiceArtifactUpdatesOnlyArtifactReference(t *testing.T) {
	root := t.TempDir()
	serviceRoot := filepath.Join(root, "services", "server")
	if err := os.MkdirAll(serviceRoot, 0700); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(serviceRoot, "service.yaml")
	before := "# service-owned comment\nid: server\nversion: 1.0.0\nmanifestVersion: studio-runtime/v1\ncustom:\n  keep: true\n"
	if err := os.WriteFile(manifestPath, []byte(before), 0600); err != nil {
		t.Fatal(err)
	}
	input := models.ServiceArtifactInput{ID: "server", Version: "1.1.4", Platform: "linux/arm64", Digest: "sha256:" + strings.Repeat("a", 64)}
	if err := (Mutations{}).SetRuntimeServiceArtifact(context.Background(), root, "server", input); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(manifestPath) //nolint:gosec // path is assembled from fixed, validated test identifiers.
	if err != nil {
		t.Fatal(err)
	}
	var document yaml.Node
	if unmarshalErr := yaml.Unmarshal(data, &document); unmarshalErr != nil {
		t.Fatalf("updated manifest is invalid YAML: %v", unmarshalErr)
	}
	manifest := document.Content[0]
	if got := mappingValue(manifest, "id").Value; got != "server" {
		t.Fatalf("service id changed: %q", got)
	}
	if got := mappingValue(manifest, "version").Value; got != "1.1.4" {
		t.Fatalf("service version changed: %q", got)
	}
	if got := mappingValue(mappingValue(manifest, "custom"), "keep").Value; got != "true" {
		t.Fatalf("unrelated manifest data changed: %q", got)
	}
	artifact := mappingValue(manifest, "artifact")
	for key, expected := range map[string]string{"id": "server", "version": "1.1.4", "platform": "linux/arm64", "digest": input.Digest} {
		if got := mappingValue(artifact, key).Value; got != expected {
			t.Errorf("artifact.%s=%q, want %q", key, got, expected)
		}
	}
	graphValue, err := graph(root)
	if err != nil || len(graphValue.Services) != 1 || graphValue.Services[0].Artifact == nil || graphValue.Services[0].Artifact.Digest != input.Digest {
		t.Fatalf("graph did not project the artifact reference: %+v err=%v", graphValue, err)
	}
	if !strings.Contains(string(data), "# service-owned comment") {
		t.Fatalf("service comment was not preserved: %s", data)
	}
}

func TestSetRuntimeServiceArtifactRejectsMismatchInvalidDigestAndSymlink(t *testing.T) {
	root := t.TempDir()
	serviceRoot := filepath.Join(root, "services", "server")
	if err := os.MkdirAll(serviceRoot, 0700); err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(serviceRoot, "service.yaml")
	if err := os.WriteFile(manifestPath, []byte("id: server\nversion: 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	valid := models.ServiceArtifactInput{ID: "server", Version: "1.1.4", Platform: "linux/arm64", Digest: "sha256:" + strings.Repeat("b", 64)}
	if err := (Mutations{}).SetRuntimeServiceArtifact(context.Background(), root, "server", models.ServiceArtifactInput{ID: "echo", Version: valid.Version, Platform: valid.Platform, Digest: valid.Digest}); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("service/artifact mismatch accepted: %v", err)
	}
	invalidDigest := valid
	invalidDigest.Digest = "sha256:short"
	if err := (Mutations{}).SetRuntimeServiceArtifact(context.Background(), root, "server", invalidDigest); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("invalid digest accepted: %v", err)
	}
	if err := os.Remove(manifestPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(t.TempDir(), "outside.yaml"), manifestPath); err != nil {
		t.Fatal(err)
	}
	if err := (Mutations{}).SetRuntimeServiceArtifact(context.Background(), root, "server", valid); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("symlink manifest accepted: %v", err)
	}
}

func TestMutationsRejectUnsafeGraphIdentifiers(t *testing.T) {
	if err := (Mutations{}).CreateRuntimeService(context.Background(), t.TempDir(), models.RuntimeServiceInput{ID: "../escape", Name: "Bad", Version: "1", ManifestVersion: "v1"}); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("unsafe service identifier accepted: %v", err)
	}
}

func TestCreateServiceLinkCreatesLinksDirectoryForImportedService(t *testing.T) {
	root := t.TempDir()
	for _, id := range []string{"server", "echo"} {
		if err := os.MkdirAll(filepath.Join(root, "services", id), 0700); err != nil {
			t.Fatal(err)
		}
	}
	input := models.ServiceLinkInput{ID: "server-to-echo", Caller: "server", Target: "echo", ContractVersion: "v1", Methods: []string{"hello"}}
	if err := (Mutations{}).CreateServiceLink(context.Background(), root, input); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "services", "server", "links", "server-to-echo.json")); err != nil {
		t.Fatalf("link was not created for imported service: %v", err)
	}
}

func TestMutationsRejectLegacyRuntimePathsBeforeWriting(t *testing.T) {
	for _, legacy := range []string{"directory", "schema"} {
		t.Run(legacy, func(t *testing.T) {
			root := t.TempDir()
			input := models.RuntimeServiceInput{ID: "neutral-id", Name: "Neutral", Version: "1", ManifestVersion: "v1"}
			if legacy == "directory" {
				if err := os.Mkdir(filepath.Join(root, "plugins"), 0700); err != nil {
					t.Fatal(err)
				}
			} else {
				input.SettingsSchemaPath = "schemas/../plugins/neutral-id/schema.json"
			}
			if err := (Mutations{}).CreateRuntimeService(context.Background(), root, input); !errors.Is(err, ErrLegacyRuntimeProject) {
				t.Fatalf("legacy runtime input accepted: %v", err)
			}
			if _, err := os.Stat(filepath.Join(root, "services")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("rejected migration wrote services: %v", err)
			}
		})
	}
}
