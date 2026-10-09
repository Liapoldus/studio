package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestDesktopProjectPersistence(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "client.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	state, err := store.ReadClientState(ctx)
	if err != nil || state.SelectedProjectID != "" {
		t.Fatalf("initial state: %+v %v", state, err)
	}
	for _, id := range []string{"b", "a"} {
		project, projectErr := models.NewProject(id, "Project "+id, filepath.Join(t.TempDir(), id))
		if projectErr != nil {
			t.Fatal(projectErr)
		}
		if err = store.SaveProject(ctx, project); err != nil {
			t.Fatal(err)
		}
	}
	if err = store.SaveClientState(ctx, models.ClientState{SelectedProjectID: "a"}); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	projects, err := store.ListProjects(ctx)
	if err != nil || len(projects) != 2 || projects[0].ID != "a" || projects[1].ID != "b" {
		t.Fatalf("durable ordered projects: %+v %v", projects, err)
	}
	state, err = store.ReadClientState(ctx)
	if err != nil || state.SelectedProjectID != "a" {
		t.Fatalf("durable selection: %+v %v", state, err)
	}
	projects[0].Name = "Renamed"
	if err = store.SaveProject(ctx, projects[0]); err != nil {
		t.Fatal(err)
	}
	updated, err := store.ListProjects(ctx)
	if err != nil || len(updated) != 2 || updated[0].Name != "Renamed" {
		t.Fatalf("upsert: %+v %v", updated, err)
	}
	if err = store.SaveClientState(ctx, models.ClientState{SelectedProjectID: "missing"}); !errors.Is(err, ErrStorage) {
		t.Fatalf("missing selected project: %v", err)
	}
	if err = store.DeleteProject(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	state, err = store.ReadClientState(ctx)
	if err != nil || state.SelectedProjectID != "" {
		t.Fatalf("deleted selection not cleared: %+v %v", state, err)
	}
}

func TestSchemaVersionAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "client.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("database permissions: %v %v", info, err)
	}
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.ExecContext(context.Background(), "PRAGMA user_version = 2"); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()
	if _, err = Open(path); !errors.Is(err, ErrStorage) {
		t.Fatalf("accepted future schema: %v", err)
	}
}

func TestValidationAndCancellation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = store.Close() }()
	if err = store.SaveProject(context.Background(), models.Project{ID: "a", Name: "Project", RootPath: "relative"}); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("invalid project accepted: %v", err)
	}
	projects, err := store.ListProjects(context.Background())
	if err != nil || len(projects) != 0 {
		t.Fatal("invalid project persisted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.ListProjects(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	for _, path := range []string{"", ":memory:", "relative.db", "file:/tmp/test.db"} {
		if _, err := Open(path); !errors.Is(err, ErrStorage) {
			t.Fatalf("accepted non-file path %q", path)
		}
	}
}
