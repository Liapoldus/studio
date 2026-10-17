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
	if version > 8 {
		return ErrStorage
	}
	// Versions 1 from the pre-project Studio used `connections` and a
	// connection-oriented `client_state`. They are not compatible with the
	// project workbench schema, but keeping the old tables under legacy names
	// makes the migration recoverable and lets the desktop start without asking
	// the operator to delete application data.
	if version > 0 {
		var projectsTable string
		err := tx.QueryRowContext(ctx, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").Scan(&projectsTable)
		if err != nil || projectsTable != "projects" {
			if _, err := tx.ExecContext(ctx, `
ALTER TABLE connections RENAME TO legacy_connections;
ALTER TABLE client_state RENAME TO legacy_client_state;
PRAGMA user_version = 0;`); err != nil {
				return err
			}
			version = 0
		}
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
	if version < 6 {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE client_state ADD COLUMN locale TEXT NOT NULL DEFAULT 'ru'; PRAGMA user_version = 6;`); err != nil {
			return err
		}
	}
	if version < 7 {
		if _, err := tx.ExecContext(ctx, `
CREATE TABLE service_settings_drafts (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 service_id TEXT NOT NULL CHECK(length(service_id) BETWEEN 1 AND 128),
 settings_path TEXT NOT NULL CHECK(length(settings_path) > 0),
 schema_path TEXT NOT NULL CHECK(length(schema_path) > 0),
 base_digest TEXT NOT NULL CHECK(length(base_digest) = 71),
 patch_json TEXT NOT NULL CHECK(length(patch_json) BETWEEN 2 AND 1048576),
 PRIMARY KEY(project_id, service_id)
);
PRAGMA user_version = 7;`); err != nil {
			return err
		}
	}
	if version < 8 {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE client_state ADD COLUMN cli_path TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 8;`); err != nil {
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

func (s *Store) SaveServiceSettingsDraft(ctx context.Context, projectID string, value models.ServiceSettingsDraft) error {
	if strings.TrimSpace(projectID) == "" || models.ValidateServiceSettingsDraft(value) != nil {
		return models.ErrInvalidSettingsDraft
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO service_settings_drafts(project_id, service_id, settings_path, schema_path, base_digest, patch_json)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(project_id, service_id) DO UPDATE SET settings_path=excluded.settings_path, schema_path=excluded.schema_path, base_digest=excluded.base_digest, patch_json=excluded.patch_json`,
		projectID, value.ServiceID, value.SettingsPath, value.SchemaPath, value.BaseDigest, value.PatchJSON)
	return storageError(ctx, err)
}

func (s *Store) ReadServiceSettingsDraft(ctx context.Context, projectID, serviceID string) (models.ServiceSettingsDraft, bool, error) {
	var value models.ServiceSettingsDraft
	err := s.db.QueryRowContext(ctx, `SELECT service_id, settings_path, schema_path, base_digest, patch_json
FROM service_settings_drafts WHERE project_id = ? AND service_id = ?`, projectID, serviceID).Scan(
		&value.ServiceID, &value.SettingsPath, &value.SchemaPath, &value.BaseDigest, &value.PatchJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return models.ServiceSettingsDraft{}, false, nil
	}
	if err != nil {
		return models.ServiceSettingsDraft{}, false, storageError(ctx, err)
	}
	if models.ValidateServiceSettingsDraft(value) != nil {
		return models.ServiceSettingsDraft{}, false, ErrStorage
	}
	return value, true, nil
}

func (s *Store) DeleteServiceSettingsDraft(ctx context.Context, projectID, serviceID string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM service_settings_drafts WHERE project_id = ? AND service_id = ?", projectID, serviceID)
	return storageError(ctx, err)
}

func (s *Store) SaveClientState(ctx context.Context, state models.ClientState) error {
	theme, locale := "", ""
	var err error
	if state.Theme != "" {
		theme, err = models.NormalizeTheme(state.Theme)
		if err != nil {
			return err
		}
	}
	if state.Locale != "" {
		locale, err = models.NormalizeLocale(state.Locale)
		if err != nil {
			return err
		}
	}
	selected, hasSelected := state.SelectedProjectID, state.SelectedProjectID != ""
	hasTheme, hasLocale := theme != "", locale != ""
	if !hasSelected && !hasTheme && !hasLocale {
		return nil
	}
	var query string
	var args []any
	switch {
	case hasSelected && hasTheme && hasLocale:
		query, args = "UPDATE client_state SET selected_project_id = ?, theme = ?, locale = ? WHERE singleton = ?", []any{selected, theme, locale, 1}
	case hasSelected && hasTheme:
		query, args = "UPDATE client_state SET selected_project_id = ?, theme = ? WHERE singleton = ?", []any{selected, theme, 1}
	case hasSelected && hasLocale:
		query, args = "UPDATE client_state SET selected_project_id = ?, locale = ? WHERE singleton = ?", []any{selected, locale, 1}
	case hasTheme && hasLocale:
		query, args = "UPDATE client_state SET theme = ?, locale = ? WHERE singleton = ?", []any{theme, locale, 1}
	case hasSelected:
		query, args = "UPDATE client_state SET selected_project_id = ? WHERE singleton = ?", []any{selected, 1}
	case hasTheme:
		query, args = "UPDATE client_state SET theme = ? WHERE singleton = ?", []any{theme, 1}
	default:
		query, args = "UPDATE client_state SET locale = ? WHERE singleton = ?", []any{locale, 1}
	}
	_, err = s.db.ExecContext(ctx, query, args...)
	return storageError(ctx, err)
}

func (s *Store) ReadClientState(ctx context.Context) (models.ClientState, error) {
	var selected sql.NullString
	var theme, locale string
	var cliPath string
	err := s.db.QueryRowContext(ctx, "SELECT selected_project_id, theme, locale, cli_path FROM client_state WHERE singleton = 1").Scan(&selected, &theme, &locale, &cliPath)
	if err != nil {
		return models.ClientState{}, storageError(ctx, err)
	}
	if theme == "" {
		theme = "system"
	}
	if locale == "" {
		locale = "ru"
	}
	return models.ClientState{SelectedProjectID: selected.String, Theme: theme, Locale: locale, CLIPath: cliPath}, nil
}

func (s *Store) SaveCLIPath(ctx context.Context, path string) error {
	if strings.ContainsRune(path, '\x00') || (path != "" && !filepath.IsAbs(path)) {
		return ErrStorage
	}
	if path != "" {
		path = filepath.Clean(path)
	}
	_, err := s.db.ExecContext(ctx, "UPDATE client_state SET cli_path = ? WHERE singleton = 1", path)
	return storageError(ctx, err)
}

func (s *Store) SaveInstalledStudioPlugin(ctx context.Context, value models.InstalledStudioPluginState) error {
	if strings.TrimSpace(value.ID) == "" || strings.TrimSpace(value.Version) == "" || strings.TrimSpace(value.Digest) == "" || strings.TrimSpace(value.Path) == "" {
		return ErrStorage
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO installed_plugins(id, version, digest, path, enabled, signed) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id, version) DO UPDATE SET digest=excluded.digest, path=excluded.path, enabled=excluded.enabled, signed=excluded.signed`, value.ID, value.Version, value.Digest, value.Path, boolInt(value.Enabled), boolInt(value.Signed))
	return storageError(ctx, err)
}

func (s *Store) ListInstalledStudioPlugins(ctx context.Context) (values []models.InstalledStudioPluginState, readErr error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, version, digest, path, enabled, signed FROM installed_plugins ORDER BY id, version")
	if err != nil {
		return nil, storageError(ctx, err)
	}
	defer func() { readErr = errors.Join(readErr, storageError(ctx, rows.Close())) }()
	values = make([]models.InstalledStudioPluginState, 0)
	for rows.Next() {
		var value models.InstalledStudioPluginState
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

func (s *Store) DeleteInstalledStudioPlugin(ctx context.Context, id, version string) error {
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

func (s *Store) DeleteEditorAssociation(ctx context.Context, pattern string) error {
	if strings.TrimSpace(pattern) == "" {
		return ErrStorage
	}
	_, err := s.db.ExecContext(ctx, "DELETE FROM editor_associations WHERE pattern = ?", pattern)
	return storageError(ctx, err)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
