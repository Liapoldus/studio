package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
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
	defer func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()
	state, err := store.ReadClientState(ctx)
	if err != nil || state.SelectedProjectID != "" || state.Theme != "system" {
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
	if err = store.SaveClientState(ctx, models.ClientState{Theme: "dark"}); err != nil {
		t.Fatal(err)
	}
	state, err = store.ReadClientState(ctx)
	if err != nil || state.SelectedProjectID != "a" || state.Theme != "dark" {
		t.Fatalf("durable theme: %+v %v", state, err)
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
	if err = store.SaveClientState(ctx, models.ClientState{Theme: "neon"}); !errors.Is(err, models.ErrInvalidTheme) {
		t.Fatalf("invalid theme accepted: %v", err)
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
	if _, err = db.ExecContext(context.Background(), "PRAGMA user_version = 6"); err != nil {
		t.Fatal(err)
	}
	if closeErr := db.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if _, err = Open(path); !errors.Is(err, ErrStorage) {
		t.Fatalf("accepted future schema: %v", err)
	}
}

func TestDesktopMetadataV2Persistence(t *testing.T) {
	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()
	project, err := models.NewProject("demo", "Demo", filepath.Join(t.TempDir(), "demo"))
	if err != nil {
		t.Fatal(err)
	}
	if saveErr := store.SaveProject(ctx, project); saveErr != nil {
		t.Fatal(saveErr)
	}
	plugin := models.InstalledPluginState{ID: "runtime.tools", Version: "1.2.0", Digest: "sha256:abc", Path: "/tmp/plugin", Enabled: true, Signed: true}
	if saveErr := store.SaveInstalledPlugin(ctx, plugin); saveErr != nil {
		t.Fatal(saveErr)
	}
	plugins, err := store.ListInstalledPlugins(ctx)
	if err != nil || len(plugins) != 1 || plugins[0] != plugin {
		t.Fatalf("plugins: %+v %v", plugins, err)
	}
	trust := models.TrustState{Digest: plugin.Digest, Approved: true, Reason: "local review", GrantedPermissions: []string{"project.read"}}
	if saveErr := store.SaveTrustState(ctx, trust); saveErr != nil {
		t.Fatal(saveErr)
	}
	if actual, readErr := store.ReadTrustState(ctx, plugin.Digest); readErr != nil || !reflect.DeepEqual(actual, trust) {
		t.Fatalf("trust: %+v %v", actual, readErr)
	}
	association := models.EditorAssociation{Pattern: "*.yaml", Application: "/Applications/Editor.app"}
	if saveErr := store.SaveEditorAssociation(ctx, association); saveErr != nil {
		t.Fatal(saveErr)
	}
	associations, err := store.ListEditorAssociations(ctx)
	if err != nil || len(associations) != 1 || associations[0] != association {
		t.Fatalf("associations: %+v %v", associations, err)
	}
	// Workspace navigation state is intentionally not stored in global SQLite;
	// it belongs to the project-local .studio/workspace.json store.
}

func TestValidationAndCancellation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	}()
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
