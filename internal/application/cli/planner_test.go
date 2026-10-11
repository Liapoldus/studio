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
		{"traffic", models.CLIIntent{Command: "observe.traffic", Target: "local"}, []string{"observe", "traffic", "--project", root, "--target", "local"}},
		{"credential status", models.CLIIntent{Command: "credential.status", Target: "local"}, []string{"credential", "status", "--target", "local"}},
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

func TestPlanRejectsRemoteMutation(t *testing.T) {
	if _, err := Plan(models.CLIIntent{Command: "apply", Target: "prod"}, filepath.Join(string(filepath.Separator), "tmp", "project")); err == nil {
		t.Fatal("Plan() accepted a remote target")
	}
}
