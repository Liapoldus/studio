package project

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestOpenReadsCanonicalProjectTree(t *testing.T) {
	root := t.TempDir()
	write := func(path, content string) {
		t.Helper()
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("project.yaml", "id: demo\nname: Demo Project\n")
	write("services/runtime/service.yaml", "id: runtime\n")
	write("services/runtime/settings.json", "{}")
	write("services/runtime/links/orders.json", "{\"target\":\"orders\",\"methods\":[\"Run\"],\"transport\":\"local\",\"requestSchema\":\"schemas/orders/request.json\",\"responseSchema\":\"schemas/orders/response.json\",\"contractSchemaPath\":\"schemas/orders/contract.json\",\"securityProfile\":\"local\",\"timeoutMillis\":1200,\"retryLimit\":2,\"limits\":{\"requestBytes\":1024,\"responseBytes\":2048},\"compatibility\":\"orders/v1\",\"redactionPolicy\":\"orders-default\"}\n")
	write("modules/example/source/main.wasm", "wasm")
	write(".studio/index/cache.json", "generated")
	write(".git/config", "internal")

	value, err := (Source{}).Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if value.Project == nil || value.Project.ID != "demo" || value.Project.Name != "Demo Project" {
		t.Fatalf("project identity: %+v", value.Project)
	}
	if len(value.Files) != 5 {
		t.Fatalf("source files: %+v", value.Files)
	}
	if len(value.Graph.Plugins) != 1 || value.Graph.Plugins[0].ID != "runtime" || !value.Graph.Plugins[0].Configured {
		t.Fatalf("graph plugins: %+v", value.Graph.Plugins)
	}
	if len(value.Graph.Links) != 1 || value.Graph.Links[0].Target != "orders" || !value.Graph.Links[0].Valid {
		t.Fatalf("graph links: %+v", value.Graph.Links)
	}
	link := value.Graph.Links[0]
	if link.RequestSchemaPath != "schemas/orders/request.json" || link.ResponseSchemaPath != "schemas/orders/response.json" || link.ContractSchemaPath != "schemas/orders/contract.json" || link.TimeoutMillis != 1200 || link.RetryLimit != 2 || link.RequestLimitBytes != 1024 || link.ResponseLimitBytes != 2048 {
		t.Fatalf("full link contract: %+v", link)
	}
	for _, file := range value.Files {
		if file.Path == ".studio/index/cache.json" || file.Path == ".git/config" {
			t.Fatalf("generated/internal file leaked into source tree: %s", file.Path)
		}
	}
	if value.Files[0].Path != "modules/example/source/main.wasm" {
		t.Fatalf("tree is not lexical: %+v", value.Files)
	}
}

func TestOpenRequiresManifestAndHonorsCancellation(t *testing.T) {
	root := t.TempDir()
	if _, err := (Source{}).Open(context.Background(), root); !errors.Is(err, ErrProjectManifest) {
		t.Fatalf("accepted project without manifest: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Source{}).Open(ctx, root); !errors.Is(err, context.Canceled) {
		t.Fatalf("ignored cancellation: %v", err)
	}
}

func TestOpenRejectsInvalidRoot(t *testing.T) {
	if _, err := (Source{}).Open(context.Background(), "relative"); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("accepted relative root: %v", err)
	}
}
