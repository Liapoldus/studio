package diagnostics

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestStoreRedactsAndRecoversDiagnostics(t *testing.T) {
	root := t.TempDir()
	store := Store{}
	if err := store.Append(context.Background(), root, models.Diagnostic{Owner: "cli", Code: "cli.exit", Severity: "error", Message: "token=secret"}); err != nil {
		t.Fatal(err)
	}
	values, err := store.List(context.Background(), root)
	if err != nil || len(values) != 1 {
		t.Fatalf("diagnostics=%+v err=%v", values, err)
	}
	if strings.Contains(values[0].Message, "secret") || !strings.Contains(values[0].Message, "[REDACTED]") {
		t.Fatalf("diagnostic leaked secret: %+v", values[0])
	}
	info, err := os.Stat(filepath.Join(root, ".studio", "diagnostics.jsonl"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("diagnostic permissions: %v %v", info, err)
	}
}
