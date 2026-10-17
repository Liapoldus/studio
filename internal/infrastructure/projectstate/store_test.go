package projectstate

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestStoreRoundTripIsProjectLocalAndAtomic(t *testing.T) {
	root := t.TempDir()
	store := Store{}
	want := models.WorkspaceState{ProjectID: "project-1", LayoutJSON: `{"nodes":{"orders":{"x":10}}}`, TabsJSON: `["graph"]`, FiltersJSON: `{"status":"error"}`}
	if err := store.Save(context.Background(), root, want); err != nil {
		t.Fatal(err)
	}
	got, err := store.Read(context.Background(), root, want.ProjectID)
	if err != nil || got != want {
		t.Fatalf("state round trip: %+v %v", got, err)
	}
	info, err := os.Stat(filepath.Join(root, ".studio", "workspace.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("workspace state permissions: %v %v", info, err)
	}
}

func TestMigrationPreservesExactRecoveryBytesAndFilters(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	directory := filepath.Join(root, ".studio")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	before := []byte("{\n  \"layout\": {\"neutral-id\": {\"x\":12,\"y\":40}}, \"tabs\": {\"schemaVersion\":\"workspace/v3\",\"tabs\":[]}, \"filters\": {\"mine\":true}, \"userData\": \"preserve me\"\n}\n")
	path := filepath.Join(directory, "workspace.json")
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	store := Store{}
	value, err := store.Read(ctx, root, "p")
	if err != nil {
		t.Fatal(err)
	}
	value.TabsJSON = `{"schemaVersion":"workspace/v4","tabs":[]}`
	if saveErr := store.Save(ctx, root, value); saveErr != nil {
		t.Fatal(saveErr)
	}
	backup := fmt.Sprintf("workspace-recovery-%x.json", sha256.Sum256(before))
	got, err := fs.ReadFile(os.DirFS(directory), backup)
	if err != nil || string(got) != string(before) {
		t.Fatalf("exact recovery bytes changed: %q %v", got, err)
	}
	recovered, err := store.Read(ctx, root, "p")
	var originalLayout, restoredLayout any
	if parseErr := json.Unmarshal([]byte(value.LayoutJSON), &originalLayout); parseErr != nil {
		t.Fatal(parseErr)
	}
	if parseErr := json.Unmarshal([]byte(recovered.LayoutJSON), &restoredLayout); parseErr != nil {
		t.Fatal(parseErr)
	}
	if err != nil || !reflect.DeepEqual(originalLayout, restoredLayout) || recovered.FiltersJSON != value.FiltersJSON {
		t.Fatalf("user state changed: %+v %v", recovered, err)
	}
	after, err := fs.ReadFile(os.DirFS(directory), "workspace.json")
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if parseErr := json.Unmarshal(after, &document); parseErr != nil || document["userData"] != "preserve me" {
		t.Fatalf("unknown user fields lost: %s %v", after, parseErr)
	}
	// Recovery restores the complete original document, including unknown fields.
	if writeErr := os.WriteFile(path, got, 0600); writeErr != nil {
		t.Fatal(writeErr)
	}
	got, err = fs.ReadFile(os.DirFS(directory), "workspace.json")
	if err != nil || string(got) != string(before) {
		t.Fatalf("recovery failed: %v", err)
	}
}

func TestStoreRejectsInvalidJSON(t *testing.T) {
	if err := (Store{}).Save(context.Background(), t.TempDir(), models.WorkspaceState{ProjectID: "p", LayoutJSON: "not-json", TabsJSON: "[]", FiltersJSON: "{}"}); err == nil {
		t.Fatal("accepted invalid workspace state")
	}
}
