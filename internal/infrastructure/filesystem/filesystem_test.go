package filesystem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

func TestCreateFileIsAtomicProjectScopedAndNeverOverwrites(t *testing.T) {
	root := t.TempDir()
	files := FileSystem{}
	if err := files.CreateFile(context.Background(), root, "schemas/server/settings.json", []byte(`{"type":"object"}`)); err != nil {
		t.Fatal(err)
	}
	if err := files.CreateFile(context.Background(), root, "schemas/server/settings.json", []byte(`{"type":"string"}`)); !errors.Is(err, os.ErrExist) {
		t.Fatalf("expected exclusive create to preserve the first file, got %v", err)
	}
	value, err := files.ReadFile(context.Background(), root, "schemas/server/settings.json")
	if err != nil || string(value) != `{"type":"object"}` {
		t.Fatalf("exclusive create changed or lost the first file: %s (%v)", value, err)
	}
	if err := files.CreateFile(context.Background(), root, "../outside.json", []byte(`{}`)); !errors.Is(err, ErrPathOutsideProject) {
		t.Fatalf("expected project boundary rejection, got %v", err)
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

func TestWriteFileIfDigestSerializesIndependentProcesses(t *testing.T) {
	root := t.TempDir()
	files := FileSystem{}
	settingsPath := "services/server/settings.json"
	initial := []byte(`{"value":"base"}`)
	if err := files.WriteFile(context.Background(), root, settingsPath, initial); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(initial)
	expected := "sha256:" + hex.EncodeToString(digest[:])
	gate := filepath.Join(t.TempDir(), "start")
	commands := make([]*exec.Cmd, 2)
	outputs := make([]strings.Builder, 2)
	for i := range commands {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		t.Cleanup(cancel)
		commands[i] = exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWriteFileIfDigestProcessHelper$") //nolint:gosec // os.Args[0] is the current Go test binary; arguments are fixed test selectors.
		commands[i].Env = append(os.Environ(),
			"STUDIO_CAS_HELPER=1",
			"STUDIO_CAS_ROOT="+root,
			"STUDIO_CAS_PATH="+settingsPath,
			"STUDIO_CAS_DIGEST="+expected,
			"STUDIO_CAS_GATE="+gate,
			fmt.Sprintf("STUDIO_CAS_VALUE=writer-%d", i),
		)
		commands[i].Stdout = &outputs[i]
		commands[i].Stderr = &outputs[i]
		if err := commands[i].Start(); err != nil {
			t.Fatalf("start compare-and-swap helper %d: %v", i, err)
		}
	}
	if err := os.WriteFile(gate, []byte("start"), 0600); err != nil {
		t.Fatal(err)
	}
	var won, conflicted int
	for i, command := range commands {
		err := command.Wait()
		switch {
		case err == nil:
			won++
		case exitCode(err) == 2:
			conflicted++
		default:
			t.Fatalf("helper %d failed (exit %d): %v\n%s", i, exitCode(err), err, outputs[i].String())
		}
	}
	if won != 1 || conflicted != 1 {
		t.Fatalf("expected exactly one CAS winner and one conflict, got winners=%d conflicts=%d", won, conflicted)
	}
	value, err := files.ReadFile(context.Background(), root, settingsPath)
	if err != nil || (string(value) != `{"value":"writer-0"}` && string(value) != `{"value":"writer-1"}`) {
		t.Fatalf("unexpected final value %q: %v", value, err)
	}
}

func TestWriteFileIfDigestProcessHelper(t *testing.T) {
	if os.Getenv("STUDIO_CAS_HELPER") != "1" {
		t.Skip("subprocess helper")
	}
	gate := os.Getenv("STUDIO_CAS_GATE")
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(gate); err == nil { //nolint:gosec // gate is created by this test inside t.TempDir.
			break
		}
		if time.Now().After(deadline) {
			os.Exit(1)
		}
		time.Sleep(time.Millisecond)
	}
	written, err := (FileSystem{}).WriteFileIfDigest(
		context.Background(), os.Getenv("STUDIO_CAS_ROOT"), os.Getenv("STUDIO_CAS_PATH"),
		os.Getenv("STUDIO_CAS_DIGEST"), []byte(fmt.Sprintf(`{"value":%q}`, os.Getenv("STUDIO_CAS_VALUE"))),
	)
	if err != nil {
		os.Exit(1)
	}
	if !written {
		os.Exit(2)
	}
	os.Exit(0)
}

func exitCode(err error) int {
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}
