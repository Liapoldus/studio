package desktop

import (
	"context"
	"errors"
	"testing"

	"github.com/Liapoldus/studio/internal/infrastructure/filesystem"
)

func TestEditorRejectsUnsafeApplicationAndPaths(t *testing.T) {
	root := t.TempDir()
	if err := (EditorLauncher{}).Open(context.Background(), root, "../secret", "editor"); !errors.Is(err, filesystem.ErrPathOutsideProject) {
		t.Fatalf("expected path rejection, got %v", err)
	}
	if err := (EditorLauncher{}).Open(context.Background(), root, "file.json", "editor --unsafe"); !errors.Is(err, ErrInvalidEditor) {
		t.Fatalf("expected application rejection, got %v", err)
	}
}
