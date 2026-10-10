package projectstate

import (
	"context"
	"os"
	"path/filepath"
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

func TestStoreRejectsInvalidJSON(t *testing.T) {
	if err := (Store{}).Save(context.Background(), t.TempDir(), models.WorkspaceState{ProjectID: "p", LayoutJSON: "not-json", TabsJSON: "[]", FiltersJSON: "{}"}); err == nil {
		t.Fatal("accepted invalid workspace state")
	}
}
