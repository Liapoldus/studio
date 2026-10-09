// Package sqlite persists Studio-owned desktop metadata.
package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
	_ "github.com/mattn/go-sqlite3"
)

var ErrStorage = errors.New("studio desktop storage unavailable")

type Store struct{ db *sql.DB }

var _ interfaces.DesktopStore = (*Store)(nil)

// Open owns only Studio project metadata and client selection. It never stores credentials.
func Open(path string) (*Store, error) {
	if !filepath.IsAbs(path) || strings.ContainsRune(path, '\x00') {
		return nil, ErrStorage
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, ErrStorage
	}
	file, err := os.OpenFile(filepath.Clean(path), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, ErrStorage
	}
	if err = file.Close(); err != nil {
		return nil, ErrStorage
	}
	if err = os.Chmod(path, 0600); err != nil {
		return nil, ErrStorage
	}
	dsn := (&url.URL{Scheme: "file", Path: path, RawQuery: "_foreign_keys=on&_busy_timeout=5000&_journal_mode=DELETE"}).String()
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, ErrStorage
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err = store.initialize(); err != nil {
		if closeErr := db.Close(); closeErr != nil {
			return nil, ErrStorage
		}
		return nil, ErrStorage
	}
	return store, nil
}

func (s *Store) initialize() (initErr error) {
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			initErr = errors.Join(initErr, rollbackErr)
		}
	}()
	var version int
	if err := tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version > 1 {
		return ErrStorage
	}
	if version == 0 {
		_, err := tx.ExecContext(ctx, `
CREATE TABLE projects (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
 name TEXT NOT NULL CHECK(length(name) > 0),
 root_path TEXT NOT NULL CHECK(length(root_path) > 0)
);
CREATE TABLE client_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
 selected_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
);
INSERT INTO client_state(singleton) VALUES (1);
PRAGMA user_version = 1;`)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) Close() error { return storageError(context.Background(), s.db.Close()) }

func storageError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return ErrStorage
}

func (s *Store) SaveProject(ctx context.Context, project models.Project) error {
	value, err := models.NewProject(project.ID, project.Name, project.RootPath)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO projects(id, name, root_path) VALUES (?, ?, ?)
ON CONFLICT(id) DO UPDATE SET name=excluded.name, root_path=excluded.root_path`, value.ID, value.Name, value.RootPath)
	return storageError(ctx, err)
}

func (s *Store) ListProjects(ctx context.Context) (values []models.Project, readErr error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, name, root_path FROM projects ORDER BY id")
	if err != nil {
		return nil, storageError(ctx, err)
	}
	defer func() { readErr = errors.Join(readErr, storageError(ctx, rows.Close())) }()
	values = make([]models.Project, 0)
	for rows.Next() {
		var value models.Project
		if err = rows.Scan(&value.ID, &value.Name, &value.RootPath); err != nil {
			return nil, storageError(ctx, err)
		}
		value, err = models.NewProject(value.ID, value.Name, value.RootPath)
		if err != nil {
			return nil, ErrStorage
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, storageError(ctx, err)
	}
	return values, nil
}

func (s *Store) DeleteProject(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", id)
	return storageError(ctx, err)
}

func (s *Store) SaveClientState(ctx context.Context, state models.ClientState) error {
	var selected any
	if state.SelectedProjectID != "" {
		selected = state.SelectedProjectID
	}
	_, err := s.db.ExecContext(ctx, "UPDATE client_state SET selected_project_id = ? WHERE singleton = 1", selected)
	return storageError(ctx, err)
}

func (s *Store) ReadClientState(ctx context.Context) (models.ClientState, error) {
	var selected sql.NullString
	err := s.db.QueryRowContext(ctx, "SELECT selected_project_id FROM client_state WHERE singleton = 1").Scan(&selected)
	if err != nil {
		return models.ClientState{}, storageError(ctx, err)
	}
	return models.ClientState{SelectedProjectID: selected.String}, nil
}
