package filesystem

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFileSystemReadWriteIsProjectScoped(t *testing.T) {
	root := t.TempDir()
	fs := FileSystem{}
	if err := fs.WriteFile(context.Background(), root, "services/demo/settings.json", []byte(`{"enabled":true}`)); err != nil {
		t.Fatal(err)
	}
	value, err := fs.ReadFile(context.Background(), root, "services/demo/settings.json")
	if err != nil || string(value) != `{"enabled":true}` {
		t.Fatalf("read value=%s err=%v", value, err)
	}
	if _, err := fs.ReadFile(context.Background(), root, "../outside"); !errors.Is(err, ErrPathOutsideProject) {
		t.Fatalf("expected path boundary error, got %v", err)
	}
}

func TestFileSystemRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(target, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "link.json")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := (FileSystem{}).ReadFile(context.Background(), root, "link.json"); !errors.Is(err, ErrSymlinkNotAllowed) {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
}
