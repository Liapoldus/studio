package cli

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestPlanInjectsProjectContext(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "liapoldus-project")
	tests := []struct {
		name   string
		intent models.CLIIntent
		want   []string
	}{
		{"validate", models.CLIIntent{Command: "validate"}, []string{"validate", "--project", root, "--revision", "HEAD"}},
		{"plan", models.CLIIntent{Command: "plan", Target: "local"}, []string{"plan", "--project", root, "--revision", "HEAD", "--target", "local"}},
		{"apply", models.CLIIntent{Command: "apply", Target: "local"}, []string{"apply", "--project", root, "--revision", "HEAD", "--target", "local", "--confirm"}},
		{"dev plan", models.CLIIntent{Command: "dev.plan", Target: "local"}, []string{"dev", "plan", "--project", root, "--target", "local"}},
		{"dev apply", models.CLIIntent{Command: "dev.apply", Target: "local"}, []string{"dev", "apply", "--project", root, "--target", "local", "--confirm", "--wait"}},
		{"explicit retry after failed dev apply", models.CLIIntent{Command: "dev.apply.retryFailed", Target: "local"}, []string{"dev", "apply", "--project", root, "--target", "local", "--confirm", "--wait", "--retry-failed"}},
		{"traffic", models.CLIIntent{Command: "observe.traffic", Target: "local"}, []string{"observe", "traffic", "--project", root, "--target", "local"}},
		{"credential status", models.CLIIntent{Command: "credential.status", Target: "local"}, []string{"credential", "status", "--target", "local"}},
		{"inspect target without exposing paths", models.CLIIntent{Command: "target.inspect", Target: "local"}, []string{"target", "inspect", "local"}},
		{"inspect Core binary", models.CLIIntent{Command: "core.binary.inspect", BinaryPath: filepath.Join(string(filepath.Separator), "tmp", "core")}, []string{"core", "binary", "inspect", "--path", filepath.Join(string(filepath.Separator), "tmp", "core")}},
		{"inspect Core settings through the selected local target", models.CLIIntent{Command: "core.settings.inspect", Target: "local"}, []string{"core", "settings", "inspect", "--target", "local"}},
		{"update Core settings through a typed request file", models.CLIIntent{Command: "core.settings.update", Target: "local", RequestFilePath: filepath.Join(string(filepath.Separator), "tmp", "core-settings-patch.json")}, []string{"core", "settings", "update", "--target", "local", "--request-file", filepath.Join(string(filepath.Separator), "tmp", "core-settings-patch.json"), "--confirm"}},
		{"update trusted Core binary atomically", models.CLIIntent{Command: "core.binary.update", Target: "local", BinaryPath: filepath.Join(string(filepath.Separator), "tmp", "core"), Digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}, []string{"core", "binary", "update", "--target", "local", "--path", filepath.Join(string(filepath.Separator), "tmp", "core"), "--digest", "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "--confirm"}},
		{"service status", models.CLIIntent{Command: "service.status", ServiceID: "echo", Target: "local"}, []string{"service", "status", "echo", "--target", "local"}},
		{"service manifest", models.CLIIntent{Command: "service.manifest", ServiceID: "echo", Target: "local"}, []string{"service", "manifest", "echo", "--target", "local"}},
		{"service schema", models.CLIIntent{Command: "service.schema", ServiceID: "echo", Target: "local"}, []string{"service", "schema", "echo", "--target", "local"}},
		{"service admin surface", models.CLIIntent{Command: "service.admin-surface.inspect", ServiceID: "server", Target: "local"}, []string{"service", "admin-surface", "inspect", "server", "--target", "local"}},
		{"service resource list", models.CLIIntent{Command: "service.resource.list", ServiceID: "server", ResourceID: "sites", Target: "local"}, []string{"service", "resource", "list", "server", "--resource", "sites", "--target", "local"}},
		{"service resource publish", models.CLIIntent{Command: "service.resource.publish", Target: "local", ServiceID: "server", PageID: "sites", ActionID: "publish", ArtifactPath: "resources/site.tar.gz", ContentType: "application/gzip", MetadataPath: "resources/publish.json", IfMatch: `"surface-1"`, IdempotencyKey: "publish-1"}, []string{"service", "resource", "publish", "server", "--project", root, "--page", "sites", "--action", "publish", "--artifact-file", "resources/site.tar.gz", "--content-type", "application/gzip", "--metadata-file", "resources/publish.json", "--if-match", `"surface-1"`, "--idempotency-key", "publish-1", "--target", "local"}},
		{"service resource publish without optional CAS", models.CLIIntent{Command: "service.resource.publish", Target: "local", ServiceID: "server", PageID: "sites", ActionID: "publish", ArtifactPath: "resources/site.tar.gz", ContentType: "application/gzip", MetadataPath: "resources/publish.json", IdempotencyKey: "publish-2"}, []string{"service", "resource", "publish", "server", "--project", root, "--page", "sites", "--action", "publish", "--artifact-file", "resources/site.tar.gz", "--content-type", "application/gzip", "--metadata-file", "resources/publish.json", "--idempotency-key", "publish-2", "--target", "local"}},
		{"service artifacts", models.CLIIntent{Command: "service.artifact.list"}, []string{"service", "artifact", "list"}},
		{"service artifact remove", models.CLIIntent{Command: "service.artifact.remove", ArtifactID: "server", Version: "1.1.4", Platform: "linux/arm64"}, []string{"service", "artifact", "remove", "--id", "server", "--version", "1.1.4", "--platform", "linux/arm64"}},
		{"runtime plan reads the open working tree", models.CLIIntent{Command: "runtime.plan", Target: "local"}, []string{"runtime", "plan", "--project", root, "--revision", "WORKING_TREE", "--target", "local"}},
		{"runtime start reads the open working tree", models.CLIIntent{Command: "runtime.start", Target: "local"}, []string{"runtime", "start", "--project", root, "--revision", "WORKING_TREE", "--target", "local"}},
		{"runtime service start", models.CLIIntent{Command: "runtime.start", Target: "local", ServiceID: "echo"}, []string{"runtime", "start", "--project", root, "--revision", "WORKING_TREE", "--target", "local", "--service", "echo"}},
		{"runtime service stop", models.CLIIntent{Command: "runtime.stop", Target: "local", ServiceID: "echo"}, []string{"runtime", "stop", "--project", root, "--revision", "WORKING_TREE", "--target", "local", "--service", "echo"}},
		{"runtime service restart", models.CLIIntent{Command: "runtime.restart", Target: "local", ServiceID: "echo"}, []string{"runtime", "restart", "--project", root, "--revision", "WORKING_TREE", "--target", "local", "--service", "echo"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Plan(test.intent, root)
			if err != nil {
				t.Fatalf("Plan() error = %v", err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("Plan() = %#v, want %#v", got, test.want)
			}
			if err := (models.CLIRequest{ProjectRoot: root, WorkingDir: root, Args: got}).Validate(); err != nil {
				t.Fatalf("planned request rejected: %v", err)
			}
		})
	}
}

func TestPlanRejectsRemovedPluginCommands(t *testing.T) {
	for _, command := range []string{"plugin.status", "plugin.manifest", "plugin.schema", "plugin.inspect", "plugin.artifact.list"} {
		if _, err := Plan(models.CLIIntent{Command: command, ArtifactID: "echo", Target: "local"}, t.TempDir()); err == nil {
			t.Fatalf("removed command accepted: %s", command)
		}
	}
}

func TestPlanRejectsRemoteMutation(t *testing.T) {
	if _, err := Plan(models.CLIIntent{Command: "apply", Target: "prod"}, filepath.Join(string(filepath.Separator), "tmp", "project")); err == nil {
		t.Fatal("Plan() accepted a remote target")
	}
	if _, err := Plan(models.CLIIntent{Command: "core.settings.inspect", Target: "production"}, filepath.Join(string(filepath.Separator), "tmp", "project")); err == nil {
		t.Fatal("Core settings inspect accepted a non-local target")
	}
	for _, intent := range []models.CLIIntent{
		{Command: "core.settings.update", Target: "production", RequestFilePath: "/tmp/patch.json"},
		{Command: "core.settings.update", Target: "local", RequestFilePath: "relative.json"},
		{Command: "core.settings.update", Target: "local", RequestFilePath: "/tmp/patch\n.json"},
	} {
		if _, err := Plan(intent, filepath.Join(string(filepath.Separator), "tmp", "project")); err == nil {
			t.Fatalf("unsafe Core settings update was accepted: %+v", intent)
		}
	}
}

func TestPlanRejectsUnsafeServiceResourcePublishIntent(t *testing.T) {
	base := models.CLIIntent{Command: "service.resource.publish", Target: "local", ServiceID: "server", PageID: "sites", ActionID: "publish", ArtifactPath: "resources/site.tar.gz", ContentType: "application/gzip", MetadataPath: "resources/publish.json", IfMatch: `"surface-1"`, IdempotencyKey: "publish-1"}
	for name, mutate := range map[string]func(*models.CLIIntent){
		"path traversal":   func(intent *models.CLIIntent) { intent.ArtifactPath = "../outside.tar.gz" },
		"absolute path":    func(intent *models.CLIIntent) { intent.MetadataPath = "/tmp/publish.json" },
		"non-local target": func(intent *models.CLIIntent) { intent.Target = "production" },
		"newline header":   func(intent *models.CLIIntent) { intent.IfMatch = "\"tag\"\nX-Evil: true" },
	} {
		t.Run(name, func(t *testing.T) {
			intent := base
			mutate(&intent)
			if _, err := Plan(intent, filepath.Join(string(filepath.Separator), "tmp", "project")); err == nil {
				t.Fatal("unsafe service resource publish intent was accepted")
			}
		})
	}
}
