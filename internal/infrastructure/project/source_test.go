package project

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
	gitrepo "github.com/Liapoldus/studio/internal/infrastructure/git"
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
	if value.Git.Changes == nil {
		t.Fatal("git changes must be an empty array when Git is unavailable")
	}
	if len(value.Files) != 5 {
		t.Fatalf("source files: %+v", value.Files)
	}
	if len(value.Graph.Services) != 1 || value.Graph.Services[0].ID != "runtime" || !value.Graph.Services[0].Configured {
		t.Fatalf("graph services: %+v", value.Graph.Services)
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

func TestOpenOmitsSymlinksFromProjectFileIndex(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "project.yaml"), []byte("id: demo\nname: Demo\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "private.txt"), []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked-directory")); err != nil {
		t.Skipf("symlinks are unavailable on this platform: %v", err)
	}
	if err := os.Symlink(filepath.Join(outside, "private.txt"), filepath.Join(root, "linked-file.txt")); err != nil {
		t.Skipf("file symlinks are unavailable on this platform: %v", err)
	}
	workspace, err := (Source{}).Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range workspace.Files {
		if file.Path == "linked-file.txt" || strings.HasPrefix(file.Path, "linked-directory/") {
			t.Fatalf("project index exposes a symlink: %q", file.Path)
		}
	}
	if len(workspace.Files) != 1 || workspace.Files[0].Path != "project.yaml" {
		t.Fatalf("unexpected project file index: %+v", workspace.Files)
	}
}

func TestLegacyRuntimePathsFailClosedWithoutChangingProjectBytes(t *testing.T) {
	for _, legacy := range []string{"directory", "settings-schema", "link-schema"} {
		t.Run(legacy, func(t *testing.T) {
			root := t.TempDir()
			if err := os.MkdirAll(filepath.Join(root, "services", "neutral-id", "links"), 0700); err != nil {
				t.Fatal(err)
			}
			fixture := map[string]string{
				"project.yaml":                      "id: demo\nname: Demo\n",
				"services/neutral-id/service.yaml":  "id: neutral-id\nname: Neutral\nversion: 1\nsettingsSchema: schemas/neutral-id.json\n",
				"services/neutral-id/settings.json": "{ \"immutable\": true }\n",
			}
			switch legacy {
			case "directory":
				if err := os.Mkdir(filepath.Join(root, "plugins"), 0700); err != nil {
					t.Fatal(err)
				}
				fixture["plugins/source.json"] = "{ \"generation\": \"unchanged\" }\n"
			case "settings-schema":
				fixture["services/neutral-id/service.yaml"] = "id: neutral-id\nsettingsSchema: plugins/neutral-id/schema.json\n"
			case "link-schema":
				fixture["services/neutral-id/links/neutral.json"] = `{"target":"other-id","methods":["plugin.Invoke"],"requestSchemaPath":"plugins/neutral-id/schema.json"}`
			}
			for path, content := range fixture {
				if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := (Source{}).Open(context.Background(), root); !errors.Is(err, ErrLegacyRuntimeProject) {
				t.Fatalf("legacy runtime path accepted: %v", err)
			}
			for path, expected := range fixture {
				got, err := fs.ReadFile(os.DirFS(root), path)
				if err != nil || string(got) != expected {
					t.Fatalf("project source bytes changed: %s %v", path, err)
				}
			}
		})
	}
}

func TestStudioPluginPackagesAndNeutralMethodsAreNotRuntimeAliases(t *testing.T) {
	root := t.TempDir()
	for _, directory := range []string{"services/plugins/links", ".studio/plugins"} {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(directory)), 0700); err != nil {
			t.Fatal(err)
		}
	}
	fixture := map[string]string{
		"project.yaml":                         "id: demo\nname: Demo\n",
		"services/plugins/service.yaml":        "id: plugins\nname: Neutral service\n",
		"services/plugins/links/neutral.json":  `{"target":"other-id","methods":["plugin.Invoke"]}`,
		".studio/plugins/editor.studio-plugin": "package bytes remain untouched",
	}
	for path, content := range fixture {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	workspace, err := (Source{}).Open(context.Background(), root)
	if err != nil || len(workspace.Graph.Services) != 1 || len(workspace.Graph.Links) != 1 || workspace.Graph.Services[0].ID != "plugins" || workspace.Graph.Links[0].Methods[0] != "plugin.Invoke" {
		t.Fatalf("editor package or neutral IDs/methods were renamed: %+v %v", workspace.Graph, err)
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

func TestCreateCreatesCanonicalProjectDirectoryUnderSelectedParent(t *testing.T) {
	parent := t.TempDir()
	if err := os.WriteFile(filepath.Join(parent, ".DS_Store"), []byte("metadata"), 0600); err != nil {
		t.Fatal(err)
	}
	workspace, err := (Source{}).Create(context.Background(), parent, "demo", "Demo Project")
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(parent, "demo")
	if workspace.Project == nil || workspace.Project.ID != "demo" || workspace.Project.Name != "Demo Project" {
		t.Fatalf("created project: %+v", workspace.Project)
	}
	data, err := os.ReadFile(filepath.Join(root, "project.yaml")) //nolint:gosec // root is created under t.TempDir().
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "id: \"demo\"\nname: \"Demo Project\"\nversion: 1\n" {
		t.Fatalf("unexpected manifest: %s", data)
	}
}

func TestCreateInitializesGitForNewProject(t *testing.T) {
	parent := t.TempDir()
	workspace, err := (Source{Git: gitrepo.Repository{}}).Create(context.Background(), parent, "demo", "Demo")
	if err != nil {
		t.Fatal(err)
	}
	if !workspace.Git.Available {
		t.Fatalf("new project Git is unavailable: %+v", workspace.Git)
	}
	if info, statErr := os.Stat(filepath.Join(parent, "demo", ".git")); statErr != nil || !info.IsDir() {
		t.Fatalf("new project has no .git directory: %v", statErr)
	}
}

func TestCreateRejectsExistingTargetAndUnsafeIdentity(t *testing.T) {
	parent := t.TempDir()
	if err := os.Mkdir(filepath.Join(parent, "demo"), 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := (Source{}).Create(context.Background(), parent, "demo", "Demo"); !errors.Is(err, ErrProjectDirectoryExists) {
		t.Fatalf("accepted existing project directory: %v", err)
	}
	if _, err := (Source{}).Create(context.Background(), parent, "demo/name", "Demo"); !errors.Is(err, ErrInvalidProjectIdentity) {
		t.Fatalf("accepted unsafe identity: %v", err)
	}
}

func TestCreateRejectsMissingParent(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "missing")
	if _, err := (Source{}).Create(context.Background(), parent, "demo", "Demo"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("accepted missing parent: %v", err)
	}
}
