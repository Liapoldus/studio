// Package models defines Studio-owned values and validation.
package models

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"regexp"
	"strings"
)

var ErrInvalidTheme = errors.New("invalid Studio theme")
var ErrInvalidLocale = errors.New("invalid Studio locale")
var ErrInvalidSettingsDraft = errors.New("invalid service settings draft")

// ClientState contains only local desktop preferences, never Core or plugin settings.
type ClientState struct {
	SelectedProjectID string
	Theme             string `json:"theme"`
	Locale            string `json:"locale"`
	CLIPath           string `json:"cliPath"`
}

func NormalizeLocale(locale string) (string, error) {
	if locale == "" {
		return "ru", nil
	}
	if locale != "ru" && locale != "en" {
		return "", ErrInvalidLocale
	}
	return locale, nil
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

type InstalledStudioPluginState struct {
	ID      string
	Version string
	Digest  string
	Path    string
	Enabled bool
	Signed  bool
}

// StudioPluginEditorBinding is a global user-selected mapping from a
// service-declared button ID to an installed plugin page.
type StudioPluginEditorBinding struct {
	ButtonID  string `json:"buttonId"`
	PluginID  string `json:"pluginId"`
	SurfaceID string `json:"surfaceId"`
}

func ValidStudioPluginBindingID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, ch := range value {
		switch {
		case ch >= 'a' && ch <= 'z', ch >= 'A' && ch <= 'Z', ch >= '0' && ch <= '9', ch == '.', ch == '_', ch == '-':
		default:
			return false
		}
	}
	return true
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

// ProjectSettingsSnapshot contains renderer-safe settings and a digest of the
// canonical on-disk file. The digest is used to reject stale writes; ValuesJSON
// is redacted by the host before crossing the Wails boundary.
type ProjectSettingsSnapshot struct {
	ValuesJSON          string `json:"valuesJson"`
	Digest              string `json:"digest"`
	ConfigurationDigest string `json:"configurationDigest"`
}

// ServiceSettingsSchemaPreview binds a read-only compatibility check to the
// exact schema, Project settings file, and safe draft reviewed by the user.
type ServiceSettingsSchemaPreview struct {
	SchemaJSON               string   `json:"schemaJson"`
	SchemaDigest             string   `json:"schemaDigest"`
	PreviousSchemaDigest     string   `json:"previousSchemaDigest"`
	SettingsDigest           string   `json:"settingsDigest"`
	DraftDigest              string   `json:"draftDigest"`
	MigrationCandidateDigest string   `json:"migrationCandidateDigest"`
	RecoveryCopyPath         string   `json:"recoveryCopyPath"`
	RecoverySchemaCopyPath   string   `json:"recoverySchemaCopyPath"`
	MigrationChangedPaths    []string `json:"migrationChangedPaths"`
	MigrationFromVersion     int      `json:"migrationFromVersion"`
	MigrationToVersion       int      `json:"migrationToVersion"`
	MigrationRequired        bool     `json:"migrationRequired"`
	ValuesCompatible         bool     `json:"valuesCompatible"`
}

// ServiceSettingsDraft persists only a schema-validated safe patch. It never
// stores secret values or a copy of the complete settings document.
type ServiceSettingsDraft struct {
	ServiceID    string `json:"serviceId"`
	SettingsPath string `json:"settingsPath"`
	SchemaPath   string `json:"schemaPath"`
	BaseDigest   string `json:"baseDigest"`
	PatchJSON    string `json:"patchJson"`
}

var settingsDigestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func ValidateServiceSettingsDraft(value ServiceSettingsDraft) error {
	if value.ServiceID == "" || len(value.ServiceID) > 128 || strings.ContainsAny(value.ServiceID, "/\\\x00\r\n\t ") ||
		!validSettingsPath(value.SettingsPath) || !validSettingsPath(value.SchemaPath) ||
		!settingsDigestPattern.MatchString(value.BaseDigest) || len(value.PatchJSON) == 0 || len(value.PatchJSON) > 1<<20 {
		return ErrInvalidSettingsDraft
	}
	var patch map[string]any
	if err := json.Unmarshal([]byte(value.PatchJSON), &patch); err != nil || patch == nil {
		return ErrInvalidSettingsDraft
	}
	return nil
}

func validSettingsPath(path string) bool {
	if strings.TrimSpace(path) != path || path == "" || strings.ContainsRune(path, '\x00') || filepath.IsAbs(path) {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(path)))
	return clean == filepath.ToSlash(path) && clean != "." && clean != ".." && !strings.HasPrefix(clean, "../") && !strings.HasPrefix(clean, ".studio/")
}
