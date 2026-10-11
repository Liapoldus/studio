package models

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
)

var ErrInvalidCLIRequest = errors.New("invalid CLI request")
var ErrInvalidCLIHandoff = errors.New("invalid CLI handoff")

// CLIIntent is the reviewed command vocabulary exposed to the Studio UI. The
// renderer never constructs arbitrary CLI argv; the host turns one intent into
// a project-scoped CLIRequest.
type CLIIntent struct {
	Command     string `json:"command"`
	Target      string `json:"target,omitempty"`
	OperationID string `json:"operationId,omitempty"`
	ProfilePath string `json:"profilePath,omitempty"`
	ArtifactID  string `json:"artifactId,omitempty"`
	Version     string `json:"version,omitempty"`
	Platform    string `json:"platform,omitempty"`
	BinaryPath  string `json:"binaryPath,omitempty"`
	Digest      string `json:"digest,omitempty"`
	ServiceID   string `json:"serviceId,omitempty"`
}

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

func (i CLIIntent) Validate() error {
	if strings.TrimSpace(i.Command) == "" || strings.ContainsAny(i.Command, "\x00\r\n") {
		return ErrInvalidCLIRequest
	}
	for _, value := range []string{i.Target, i.OperationID, i.ProfilePath, i.ArtifactID, i.Version, i.Platform, i.BinaryPath, i.Digest, i.ServiceID} {
		if strings.ContainsAny(value, "\x00\r\n") {
			return ErrInvalidCLIRequest
		}
	}
	return nil
}

// validateCLICommand is deliberately strict. Studio is a presentation host,
// not a general-purpose CLI terminal: every command shape must be reviewed
// here before it crosses the process boundary. New CLI commands need an
// explicit Studio contract update and corresponding UI/tests.
func validateCLICommand(args []string) error {
	if len(args) == 1 && args[0] == "validate" {
		return nil
	}
	if len(args) == 5 && args[0] == "validate" && args[1] == "--project" && args[3] == "--revision" && args[4] == "HEAD" {
		return validCLIAbsoluteProjectPath(args[2])
	}
	if len(args) == 2 && args[0] == "project" && args[1] == "inspect" {
		return nil
	}
	if len(args) == 4 && args[0] == "project" && args[1] == "inspect" && args[2] == "--project" {
		return validCLIAbsoluteProjectPath(args[3])
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
	if len(args) == 4 && args[0] == "credential" && args[1] == "status" && args[2] == "--target" {
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
	if len(args) == 7 && args[0] == "plan" && args[1] == "--project" && args[3] == "--revision" && args[4] == "HEAD" && args[5] == "--target" {
		if err := validCLIAbsoluteProjectPath(args[2]); err != nil {
			return err
		}
		return requireLocalTarget(args[6])
	}
	if len(args) == 4 && args[0] == "apply" && args[1] == "--target" && args[3] == "--confirm" {
		return requireLocalTarget(args[2])
	}
	if len(args) == 8 && args[0] == "apply" && args[1] == "--project" && args[3] == "--revision" && args[4] == "HEAD" && args[5] == "--target" && args[7] == "--confirm" {
		if err := validCLIAbsoluteProjectPath(args[2]); err != nil {
			return err
		}
		return requireLocalTarget(args[6])
	}
	if len(args) == 4 && args[0] == "observe" && args[1] == "traffic" && args[2] == "--target" {
		return requireLocalTarget(args[3])
	}
	if len(args) == 6 && args[0] == "observe" && args[1] == "traffic" && args[2] == "--project" && args[4] == "--target" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		return requireLocalTarget(args[5])
	}
	if len(args) == 3 && args[0] == "plugin" && args[1] == "artifact" && args[2] == "list" {
		return nil
	}
	if len(args) == 9 && args[0] == "plugin" && args[1] == "artifact" && args[2] == "inspect" && args[3] == "--id" && args[5] == "--version" && args[7] == "--platform" {
		return validCLIIdentifier(args[4])
	}
	if len(args) == 11 && args[0] == "plugin" && args[1] == "artifact" && args[2] == "register" && args[3] == "--id" && args[5] == "--version" && args[7] == "--platform" && args[9] == "--path" {
		if err := validCLIIdentifier(args[4]); err != nil {
			return err
		}
		if args[6] == "" || args[8] == "" || !filepath.IsAbs(args[10]) {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 11 && args[0] == "plugin" && args[1] == "artifact" && args[2] == "trust" && args[3] == "--id" && args[5] == "--version" && args[7] == "--platform" && args[9] == "--digest" {
		if err := validCLIIdentifier(args[4]); err != nil {
			return err
		}
		if args[6] == "" || args[8] == "" || !strings.HasPrefix(args[10], "sha256:") {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 5 && args[0] == "plugin" && isOneOf(args[1], "inspect", "manifest", "schema", "status") && args[3] == "--target" {
		if err := validCLIIdentifier(args[2]); err != nil {
			return err
		}
		return requireLocalTarget(args[4])
	}
	if len(args) == 8 && args[0] == "runtime" && isOneOf(args[1], "plan", "start", "stop", "restart", "status", "logs", "inspect") && args[2] == "--project" && args[4] == "--revision" && args[6] == "--target" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		if args[5] != "HEAD" {
			return ErrInvalidCLIRequest
		}
		return requireLocalTarget(args[7])
	}
	if len(args) == 10 && args[0] == "runtime" && isOneOf(args[1], "restart", "logs", "inspect") && args[2] == "--project" && args[4] == "--revision" && args[6] == "--target" && args[8] == "--service" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		if args[5] != "HEAD" {
			return ErrInvalidCLIRequest
		}
		if err := requireLocalTarget(args[7]); err != nil {
			return err
		}
		return validCLIIdentifier(args[9])
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

func validCLIAbsoluteProjectPath(value string) error {
	value = strings.TrimSpace(value)
	if value == "" || !filepath.IsAbs(value) || strings.ContainsAny(value, "\x00\r\n") {
		return ErrInvalidCLIRequest
	}
	clean := filepath.Clean(value)
	if clean == "." || clean == string(filepath.Separator) {
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
