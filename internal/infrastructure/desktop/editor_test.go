package desktop

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
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

func TestExternalEditorCommandUsesNativeLaunchersWithoutShell(t *testing.T) {
	lookup := func(name string) (string, error) {
		if name != "xdg-open" {
			t.Fatalf("unexpected lookup %q", name)
		}
		return "/usr/bin/xdg-open", nil
	}
	file := "/tmp/project with spaces/config;safe.yaml"

	mac, err := externalEditorCommand("darwin", "", "", file, lookup)
	if err != nil {
		t.Fatal(err)
	}
	if mac.Path != "/usr/bin/open" || len(mac.Args) != 2 || mac.Args[1] != file {
		t.Fatalf("macOS launcher must use an absolute native executable and one file argument: %#v", mac)
	}

	linux, err := externalEditorCommand("linux", "", "", file, lookup)
	if err != nil {
		t.Fatal(err)
	}
	if linux.Path != "/usr/bin/xdg-open" || len(linux.Args) != 2 || linux.Args[1] != file {
		t.Fatalf("Linux launcher must pass the path as one argv value: %#v", linux)
	}

	windows, err := externalEditorCommand("windows", `C:\Windows`, "", file, lookup)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(strings.ToLower(windows.Path), strings.ToLower(filepath.Join("System32", "rundll32.exe"))) || len(windows.Args) != 3 || windows.Args[1] != "url.dll,FileProtocolHandler" || windows.Args[2] != file {
		t.Fatalf("Windows launcher must use SystemRoot and preserve argv boundaries: %#v", windows)
	}

	custom, err := externalEditorCommand("linux", "", "/opt/Editor With Spaces/editor", file, lookup)
	if !errors.Is(err, ErrInvalidEditor) || custom != nil {
		t.Fatalf("unverified app paths containing spaces must be rejected, got command=%#v err=%v", custom, err)
	}
}
