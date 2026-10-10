package models

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
)

var ErrInvalidCLIRequest = errors.New("invalid CLI request")
var ErrInvalidCLIHandoff = errors.New("invalid CLI handoff")

type CLIRequest struct {
	ProjectRoot string
	WorkingDir  string
	Args        []string
}

type CLIHandoff struct {
	SchemaVersion string   `json:"schemaVersion"`
	ProjectID     string   `json:"projectId"`
	Repository    string   `json:"repository"`
	CommitSHA     string   `json:"commitSha"`
	Target        string   `json:"target"`
	Args          []string `json:"args"`
}

func (h CLIHandoff) Validate() error {
	if h.SchemaVersion != "studio-cli-handoff/v1" || strings.TrimSpace(h.ProjectID) == "" || strings.TrimSpace(h.Repository) == "" || strings.TrimSpace(h.CommitSHA) == "" || strings.TrimSpace(h.Target) == "" || strings.EqualFold(h.Target, "local") || len(h.Args) < 3 {
		return ErrInvalidCLIHandoff
	}
	for _, value := range append([]string{h.ProjectID, h.Repository, h.CommitSHA, h.Target}, h.Args...) {
		if strings.ContainsRune(value, '\x00') || strings.ContainsAny(value, "\r\n") {
			return ErrInvalidCLIHandoff
		}
	}
	if h.Args[0] != "apply" || h.Args[1] != "--target" || h.Args[2] != h.Target {
		return ErrInvalidCLIHandoff
	}
	return nil
}

func (r CLIRequest) Validate() error {
	root := filepath.Clean(strings.TrimSpace(r.ProjectRoot))
	if !filepath.IsAbs(root) || strings.ContainsRune(r.ProjectRoot, '\x00') || len(r.Args) == 0 {
		return ErrInvalidCLIRequest
	}
	if r.WorkingDir != "" {
		workingDir := filepath.Clean(r.WorkingDir)
		if !filepath.IsAbs(workingDir) || strings.ContainsRune(r.WorkingDir, '\x00') {
			return ErrInvalidCLIRequest
		}
		relative, err := filepath.Rel(root, workingDir)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return ErrInvalidCLIRequest
		}
	}
	for _, argument := range r.Args {
		if strings.TrimSpace(argument) == "" || strings.ContainsRune(argument, '\x00') || strings.ContainsAny(argument, "\r\n") {
			return ErrInvalidCLIRequest
		}
		lower := strings.ToLower(argument)
		for _, forbidden := range []string{"--token", "--password", "--secret", "--private-key"} {
			if lower == forbidden || strings.HasPrefix(lower, forbidden+"=") {
				return ErrInvalidCLIRequest
			}
		}
	}
	return validateCLICommand(r.Args)
}

// validateCLICommand is deliberately strict. Studio is a presentation host,
// not a general-purpose CLI terminal: every command shape must be reviewed
// here before it crosses the process boundary. New CLI commands need an
// explicit Studio contract update and corresponding UI/tests.
func validateCLICommand(args []string) error {
	if len(args) == 1 && args[0] == "validate" {
		return nil
	}
	if len(args) == 2 && args[0] == "project" && args[1] == "inspect" {
		return nil
	}
	if len(args) == 2 && args[0] == "bundle" && args[1] == "inspect" {
		return nil
	}
	if len(args) == 3 && args[0] == "target" && (args[1] == "inspect" || args[1] == "test") {
		return validCLIIdentifier(args[2])
	}
	if len(args) == 2 && args[0] == "target" && args[1] == "list" {
		return nil
	}
	if len(args) == 5 && args[0] == "target" && args[1] == "add" && args[3] == "--profile" {
		if err := validCLIIdentifier(args[2]); err != nil {
			return err
		}
		return validCLIProjectPath(args[4])
	}
	if len(args) == 4 && args[0] == "core" && isOneOf(args[1], "start", "stop", "restart", "status", "logs") && args[2] == "--target" {
		return requireLocalTarget(args[3])
	}
	if len(args) == 5 && args[0] == "operation" && isOneOf(args[1], "get", "watch") && args[3] == "--target" {
		if err := validCLIIdentifier(args[2]); err != nil {
			return err
		}
		return requireLocalTarget(args[4])
	}
	if len(args) == 3 && args[0] == "operation" && args[1] == "get" {
		return validCLIIdentifier(args[2])
	}
	if len(args) == 3 && args[0] == "plan" && args[1] == "--target" {
		return requireLocalTarget(args[2])
	}
	if len(args) == 4 && args[0] == "apply" && args[1] == "--target" && args[3] == "--confirm" {
		return requireLocalTarget(args[2])
	}
	if len(args) == 4 && args[0] == "observe" && args[1] == "traffic" && args[2] == "--target" {
		return requireLocalTarget(args[3])
	}
	return ErrInvalidCLIRequest
}

func requireLocalTarget(target string) error {
	if target != "local" {
		return ErrInvalidCLIRequest
	}
	return nil
}

func validCLIIdentifier(value string) error {
	if strings.TrimSpace(value) == "" || strings.HasPrefix(value, "-") || strings.ContainsAny(value, " /\\:@?#") {
		return ErrInvalidCLIRequest
	}
	return nil
}

func validCLIProjectPath(value string) error {
	if strings.TrimSpace(value) == "" || filepath.IsAbs(value) || strings.HasPrefix(value, "-") || strings.ContainsRune(value, '\x00') {
		return ErrInvalidCLIRequest
	}
	clean := filepath.Clean(value)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return ErrInvalidCLIRequest
	}
	return nil
}

func isOneOf(value string, values ...string) bool {
	for _, candidate := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

type CLIEvent struct {
	Severity      string          `json:"severity,omitempty"`
	SchemaVersion string          `json:"schemaVersion"`
	Type          string          `json:"type"`
	RunID         string          `json:"runId,omitempty"`
	Target        string          `json:"target,omitempty"`
	State         string          `json:"state,omitempty"`
	Kind          string          `json:"kind,omitempty"`
	Timestamp     string          `json:"timestamp,omitempty"`
	Phase         string          `json:"phase,omitempty"`
	Code          string          `json:"code,omitempty"`
	Message       string          `json:"message,omitempty"`
	OperationID   string          `json:"operationId,omitempty"`
	ReportPath    string          `json:"reportPath,omitempty"`
	Digest        string          `json:"digest,omitempty"`
	Payload       json.RawMessage `json:"payload,omitempty"`
	Percent       int             `json:"percent,omitempty"`
	ExitCode      int             `json:"exitCode,omitempty"`
}

func (e CLIEvent) Valid() bool {
	return strings.HasPrefix(e.SchemaVersion, "cli-events/") && strings.TrimSpace(e.Type) != ""
}
