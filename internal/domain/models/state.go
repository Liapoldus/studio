// Package models defines Studio-owned values and validation.
package models

// ClientState contains only local desktop preferences, never Core or plugin settings.
type ClientState struct {
	SelectedConnectionID string
}
