// Package models defines Studio-owned values and validation.
package models

import "errors"

var ErrInvalidTheme = errors.New("invalid Studio theme")

// ClientState contains only local desktop preferences, never Core or plugin settings.
type ClientState struct {
	SelectedProjectID string
	Theme             string `json:"theme"`
}

func NormalizeTheme(theme string) (string, error) {
	if theme == "" {
		return "system", nil
	}
	if theme != "system" && theme != "light" && theme != "dark" {
		return "", ErrInvalidTheme
	}
	return theme, nil
}

type InstalledPluginState struct {
	ID      string
	Version string
	Digest  string
	Path    string
	Enabled bool
	Signed  bool
}

type TrustState struct {
	Digest             string
	Reason             string
	GrantedPermissions []string
	Approved           bool
}

type EditorAssociation struct {
	Pattern     string
	Application string
}

type WorkspaceState struct {
	ProjectID   string `json:"projectId"`
	LayoutJSON  string `json:"layoutJson"`
	TabsJSON    string `json:"tabsJson"`
	FiltersJSON string `json:"filtersJson"`
}
