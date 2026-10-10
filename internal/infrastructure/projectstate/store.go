// Package projectstate persists non-canonical Studio workspace state in .studio.
package projectstate

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var ErrInvalidState = errors.New("invalid Studio project state")

type Store struct{}

var _ interfaces.ProjectStateStore = Store{}

type document struct {
	Layout  json.RawMessage `json:"layout"`
	Tabs    json.RawMessage `json:"tabs"`
	Filters json.RawMessage `json:"filters"`
}

func (Store) Read(ctx context.Context, root, projectID string) (models.WorkspaceState, error) {
	if err := validateRoot(root, projectID); err != nil {
		return models.WorkspaceState{}, err
	}
	path, err := statePath(root)
	if err != nil {
		return models.WorkspaceState{}, err
	}
	data, err := os.ReadFile(path) //nolint:gosec // path is constrained to the selected project root.
	if errors.Is(err, os.ErrNotExist) {
		return defaultState(projectID), nil
	}
	if err != nil {
		return models.WorkspaceState{}, err
	}
	var value document
	if err := json.Unmarshal(data, &value); err != nil || !validJSON(value.Layout) || !validJSON(value.Tabs) || !validJSON(value.Filters) {
		return models.WorkspaceState{}, ErrInvalidState
	}
	return models.WorkspaceState{ProjectID: projectID, LayoutJSON: string(value.Layout), TabsJSON: string(value.Tabs), FiltersJSON: string(value.Filters)}, nil
}

func (Store) Save(ctx context.Context, root string, value models.WorkspaceState) error {
	if err := validateRoot(root, value.ProjectID); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	layout, tabs, filters := []byte(value.LayoutJSON), []byte(value.TabsJSON), []byte(value.FiltersJSON)
	if !validJSON(layout) || !validJSON(tabs) || !validJSON(filters) {
		return ErrInvalidState
	}
	data, err := json.Marshal(document{Layout: layout, Tabs: tabs, Filters: filters})
	if err != nil {
		return ErrInvalidState
	}
	directory := filepath.Join(filepath.Clean(root), ".studio")
	directoryInfo, statErr := os.Lstat(directory)
	if statErr == nil && directoryInfo.Mode()&os.ModeSymlink != 0 {
		return ErrInvalidState
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}
	if mkdirErr := os.MkdirAll(directory, 0700); mkdirErr != nil {
		return mkdirErr
	}
	path := filepath.Join(directory, "workspace.json")
	fileInfo, fileStatErr := os.Lstat(path)
	if fileStatErr == nil && fileInfo.Mode()&os.ModeSymlink != 0 {
		return ErrInvalidState
	} else if fileStatErr != nil && !errors.Is(fileStatErr, os.ErrNotExist) {
		return fileStatErr
	}
	temporary, err := os.CreateTemp(directory, ".workspace-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() { discardError(os.Remove(temporaryPath)) }()
	if err := temporary.Chmod(0600); err != nil {
		discardError(temporary.Close())
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		discardError(temporary.Close())
		return err
	}
	if err := temporary.Sync(); err != nil {
		discardError(temporary.Close())
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func discardError(err error) { _ = err }

func validateRoot(root, projectID string) error {
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') || strings.TrimSpace(projectID) == "" {
		return ErrInvalidState
	}
	info, err := os.Stat(filepath.Clean(root))
	if err != nil || !info.IsDir() {
		return ErrInvalidState
	}
	return nil
}

func defaultState(projectID string) models.WorkspaceState {
	return models.WorkspaceState{ProjectID: projectID, LayoutJSON: "{}", TabsJSON: "[]", FiltersJSON: "{}"}
}

func statePath(root string) (string, error) {
	directory := filepath.Join(filepath.Clean(root), ".studio")
	info, err := os.Lstat(directory)
	if errors.Is(err, os.ErrNotExist) {
		return filepath.Join(directory, "workspace.json"), nil
	}
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return "", ErrInvalidState
	}
	path := filepath.Join(directory, "workspace.json")
	info, err = os.Lstat(path)
	if err == nil && info.Mode()&os.ModeSymlink != 0 {
		return "", ErrInvalidState
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return path, nil
}

func validJSON(data []byte) bool {
	return len(data) > 0 && json.Valid(data)
}
