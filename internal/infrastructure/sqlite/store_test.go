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

func TestDesktopPersistence(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "nested", "client.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	})
	state, err := store.ReadClientState(ctx)
	if err != nil || state.SelectedConnectionID != "" {
		t.Fatalf("initial state: %+v %v", state, err)
	}
	for _, id := range []string{"b", "a"} {
		connection, connectionErr := models.NewCoreConnection(id, "Core "+id, "https://core.test/"+id, models.CoreAccessDirect)
		if connectionErr != nil {
			t.Fatal(connectionErr)
		}
		if err = store.SaveConnection(ctx, connection); err != nil {
			t.Fatal(err)
		}
	}
	if err = store.SaveClientState(ctx, models.ClientState{SelectedConnectionID: "a"}); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	connections, err := store.ListConnections(ctx)
	if err != nil || len(connections) != 2 || connections[0].ID != "a" || connections[1].ID != "b" {
		t.Fatalf("durable ordered connections: %+v %v", connections, err)
	}
	state, err = store.ReadClientState(ctx)
	if err != nil || state.SelectedConnectionID != "a" {
		t.Fatalf("durable selection: %+v %v", state, err)
	}
	connections[0].Name = "Renamed"
	connections[0].AccessMode = models.CoreAccessSSHBridge
	if err = store.SaveConnection(ctx, connections[0]); err != nil {
		t.Fatal(err)
	}
	updated, err := store.ListConnections(ctx)
	if err != nil || len(updated) != 2 || updated[0].Name != "Renamed" || updated[0].AccessMode != models.CoreAccessSSHBridge {
		t.Fatalf("upsert: %+v %v", updated, err)
	}
	if err = store.SaveClientState(ctx, models.ClientState{SelectedConnectionID: "missing"}); !errors.Is(err, ErrStorage) {
		t.Fatalf("missing selected connection: %v", err)
	}
	state, err = store.ReadClientState(ctx)
	if err != nil || state.SelectedConnectionID != "a" {
		t.Fatal("failed selection changed state")
	}
	if err = store.DeleteConnection(ctx, "a"); err != nil {
		t.Fatal(err)
	}
	state, err = store.ReadClientState(ctx)
	if err != nil || state.SelectedConnectionID != "" {
		t.Fatalf("deleted selection not cleared: %+v %v", state, err)
	}
	connections, err = store.ListConnections(ctx)
	if err != nil || len(connections) != 1 || connections[0].ID != "b" {
		t.Fatalf("delete: %+v %v", connections, err)
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
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = Open(path); !errors.Is(err, ErrStorage) {
		t.Fatalf("accepted future schema: %v", err)
	}
	db, err = sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	var version int
	if err := db.QueryRowContext(context.Background(), "PRAGMA user_version").Scan(&version); err != nil || version != 2 {
		t.Fatalf("changed future schema: %d %v", version, err)
	}
}

func TestIndependentHandles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "client.sqlite")
	first, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := first.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	})
	second, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := second.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	})
	ctx := context.Background()
	connection, err := models.NewCoreConnection("quote'ID", "Core", "https://core.test", models.CoreAccessDirect)
	if err != nil {
		t.Fatal(err)
	}
	if err = first.SaveConnection(ctx, connection); err != nil {
		t.Fatal(err)
	}
	if err = second.SaveClientState(ctx, models.ClientState{SelectedConnectionID: connection.ID}); err != nil {
		t.Fatal(err)
	}
	if err = first.DeleteConnection(ctx, connection.ID); err != nil {
		t.Fatal(err)
	}
	state, err := second.ReadClientState(ctx)
	if err != nil || state.SelectedConnectionID != "" {
		t.Fatalf("foreign keys on second handle: %+v %v", state, err)
	}
}

func TestValidationAndCancellation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "client.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := store.Close(); closeErr != nil {
			t.Error(closeErr)
		}
	})
	connection := models.CoreConnection{ID: "a", Name: "Core", Endpoint: "https://user:secret@core.test", AccessMode: models.CoreAccessDirect}
	if err = store.SaveConnection(context.Background(), connection); !errors.Is(err, models.ErrInvalidCoreConnection) {
		t.Fatalf("invalid connection accepted: %v", err)
	}
	connections, err := store.ListConnections(context.Background())
	if err != nil || len(connections) != 0 {
		t.Fatal("invalid connection persisted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := store.ListConnections(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	for _, path := range []string{"", ":memory:", "relative.db", "file:/tmp/test.db"} {
		if _, err := Open(path); !errors.Is(err, ErrStorage) {
			t.Fatalf("accepted non-file path %q", path)
		}
	}
}
