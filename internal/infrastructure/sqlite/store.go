// Package sqlite persists Studio-owned desktop metadata.
package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
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
	if version > 5 {
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
	} else {
		var table string
		if err := tx.QueryRowContext(ctx, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").Scan(&table); err != nil || table != "projects" {
			// The former connection schema used the same user_version. Reject it
			// instead of carrying Core metadata into the project-only store.
			return ErrStorage
		}
	}
	if version < 2 {
		if _, err := tx.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS installed_plugins (
 id TEXT NOT NULL CHECK(length(id) > 0),
 version TEXT NOT NULL CHECK(length(version) > 0),
 digest TEXT NOT NULL CHECK(length(digest) > 0),
 path TEXT NOT NULL CHECK(length(path) > 0),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
 signed INTEGER NOT NULL DEFAULT 0 CHECK(signed IN (0, 1)),
 PRIMARY KEY(id, version)
);
CREATE TABLE IF NOT EXISTS trust_decisions (
 digest TEXT PRIMARY KEY NOT NULL CHECK(length(digest) > 0),
 approved INTEGER NOT NULL CHECK(approved IN (0, 1)),
 reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS editor_associations (
 pattern TEXT PRIMARY KEY NOT NULL CHECK(length(pattern) > 0),
 application TEXT NOT NULL CHECK(length(application) > 0)
);
PRAGMA user_version = 2;`); err != nil {
			return err
		}
	}
	if version < 3 {
		// Workspace navigation state is project-local in .studio/workspace.json.
		// Remove the pre-production duplicate table from older desktop databases.
		if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS workspace_state; PRAGMA user_version = 3;`); err != nil {
			return err
		}
	}
	if version < 4 {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE client_state ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'; PRAGMA user_version = 4;`); err != nil {
			return err
		}
	}
	if version < 5 {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE trust_decisions ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]'; PRAGMA user_version = 5;`); err != nil {
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
	theme, err := models.NormalizeTheme(state.Theme)
	if err != nil {
		return err
	}
	switch {
	case state.SelectedProjectID == "" && state.Theme == "":
		return nil
	case state.SelectedProjectID == "":
		_, err = s.db.ExecContext(ctx, "UPDATE client_state SET theme = ? WHERE singleton = 1", theme)
	case state.Theme == "":
		_, err = s.db.ExecContext(ctx, "UPDATE client_state SET selected_project_id = ? WHERE singleton = 1", state.SelectedProjectID)
	default:
		_, err = s.db.ExecContext(ctx, "UPDATE client_state SET selected_project_id = ?, theme = ? WHERE singleton = 1", state.SelectedProjectID, theme)
	}
	return storageError(ctx, err)
}

func (s *Store) ReadClientState(ctx context.Context) (models.ClientState, error) {
	var selected sql.NullString
	var theme string
	err := s.db.QueryRowContext(ctx, "SELECT selected_project_id, theme FROM client_state WHERE singleton = 1").Scan(&selected, &theme)
	if err != nil {
		return models.ClientState{}, storageError(ctx, err)
	}
	if theme == "" {
		theme = "system"
	}
	return models.ClientState{SelectedProjectID: selected.String, Theme: theme}, nil
}

func (s *Store) SaveInstalledPlugin(ctx context.Context, value models.InstalledPluginState) error {
	if strings.TrimSpace(value.ID) == "" || strings.TrimSpace(value.Version) == "" || strings.TrimSpace(value.Digest) == "" || strings.TrimSpace(value.Path) == "" {
		return ErrStorage
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO installed_plugins(id, version, digest, path, enabled, signed) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id, version) DO UPDATE SET digest=excluded.digest, path=excluded.path, enabled=excluded.enabled, signed=excluded.signed`, value.ID, value.Version, value.Digest, value.Path, boolInt(value.Enabled), boolInt(value.Signed))
	return storageError(ctx, err)
}

func (s *Store) ListInstalledPlugins(ctx context.Context) (values []models.InstalledPluginState, readErr error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, version, digest, path, enabled, signed FROM installed_plugins ORDER BY id, version")
	if err != nil {
		return nil, storageError(ctx, err)
	}
	defer func() { readErr = errors.Join(readErr, storageError(ctx, rows.Close())) }()
	values = make([]models.InstalledPluginState, 0)
	for rows.Next() {
		var value models.InstalledPluginState
		var enabled, signed int
		if err := rows.Scan(&value.ID, &value.Version, &value.Digest, &value.Path, &enabled, &signed); err != nil {
			return nil, storageError(ctx, err)
		}
		value.Enabled, value.Signed = enabled != 0, signed != 0
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, storageError(ctx, err)
	}
	return values, nil
}

func (s *Store) DeleteInstalledPlugin(ctx context.Context, id, version string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM installed_plugins WHERE id = ? AND version = ?", id, version)
	return storageError(ctx, err)
}

func (s *Store) SaveTrustState(ctx context.Context, value models.TrustState) error {
	if strings.TrimSpace(value.Digest) == "" {
		return ErrStorage
	}
	permissions, err := json.Marshal(value.GrantedPermissions)
	if err != nil {
		return ErrStorage
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO trust_decisions(digest, approved, reason, permissions_json) VALUES (?, ?, ?, ?)
ON CONFLICT(digest) DO UPDATE SET approved=excluded.approved, reason=excluded.reason, permissions_json=excluded.permissions_json`, value.Digest, boolInt(value.Approved), value.Reason, string(permissions))
	return storageError(ctx, err)
}

func (s *Store) ReadTrustState(ctx context.Context, digest string) (models.TrustState, error) {
	var value models.TrustState
	var approved int
	var permissions string
	err := s.db.QueryRowContext(ctx, "SELECT digest, approved, reason, permissions_json FROM trust_decisions WHERE digest = ?", digest).Scan(&value.Digest, &approved, &value.Reason, &permissions)
	if errors.Is(err, sql.ErrNoRows) {
		return models.TrustState{}, nil
	}
	if err != nil {
		return models.TrustState{}, storageError(ctx, err)
	}
	value.Approved = approved != 0
	if err := json.Unmarshal([]byte(permissions), &value.GrantedPermissions); err != nil {
		return models.TrustState{}, ErrStorage
	}
	return value, nil
}

func (s *Store) SaveEditorAssociation(ctx context.Context, value models.EditorAssociation) error {
	if strings.TrimSpace(value.Pattern) == "" || strings.TrimSpace(value.Application) == "" {
		return ErrStorage
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO editor_associations(pattern, application) VALUES (?, ?)
ON CONFLICT(pattern) DO UPDATE SET application=excluded.application`, value.Pattern, value.Application)
	return storageError(ctx, err)
}

func (s *Store) ListEditorAssociations(ctx context.Context) (values []models.EditorAssociation, readErr error) {
	rows, err := s.db.QueryContext(ctx, "SELECT pattern, application FROM editor_associations ORDER BY pattern")
	if err != nil {
		return nil, storageError(ctx, err)
	}
	defer func() { readErr = errors.Join(readErr, storageError(ctx, rows.Close())) }()
	values = make([]models.EditorAssociation, 0)
	for rows.Next() {
		var value models.EditorAssociation
		if err := rows.Scan(&value.Pattern, &value.Application); err != nil {
			return nil, storageError(ctx, err)
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, storageError(ctx, err)
	}
	return values, nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
