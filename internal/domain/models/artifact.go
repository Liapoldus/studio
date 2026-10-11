package models

type ArtifactReference struct {
	ID       string `json:"id"`
	Version  string `json:"version"`
	Platform string `json:"platform"`
	Digest   string `json:"digest"`
	Command  string `json:"command,omitempty"`
	Manifest string `json:"manifest,omitempty"`
	Schema   string `json:"schema,omitempty"`
	Trusted  bool   `json:"trusted"`
}
