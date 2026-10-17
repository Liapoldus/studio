package models

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
)

var ErrInvalidCLIRequest = errors.New("invalid CLI request")

// CLIIntent is the reviewed command vocabulary exposed to the Studio UI. The
// renderer never constructs arbitrary CLI argv; the host turns one intent into
// a project-scoped CLIRequest.
type CLIIntent struct {
	Command         string `json:"command"`
	Target          string `json:"target,omitempty"`
	OperationID     string `json:"operationId,omitempty"`
	ProfilePath     string `json:"profilePath,omitempty"`
	ArtifactID      string `json:"artifactId,omitempty"`
	Version         string `json:"version,omitempty"`
	Platform        string `json:"platform,omitempty"`
	BinaryPath      string `json:"binaryPath,omitempty"`
	Digest          string `json:"digest,omitempty"`
	ServiceID       string `json:"serviceId,omitempty"`
	Purpose         string `json:"purpose,omitempty"`
	Label           string `json:"label,omitempty"`
	Reference       string `json:"reference,omitempty"`
	ResourceID      string `json:"resourceId,omitempty"`
	PageID          string `json:"pageId,omitempty"`
	ActionID        string `json:"actionId,omitempty"`
	ArtifactPath    string `json:"artifactPath,omitempty"`
	ContentType     string `json:"contentType,omitempty"`
	MetadataPath    string `json:"metadataPath,omitempty"`
	RequestFilePath string `json:"requestFilePath,omitempty"`
	IfMatch         string `json:"ifMatch,omitempty"`
	IdempotencyKey  string `json:"idempotencyKey,omitempty"`
}

type CLIRequest struct {
	ProjectRoot string
	WorkingDir  string
	Args        []string
	SecretInput []byte
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
	if len(r.SecretInput) > 16<<10 || strings.ContainsRune(string(r.SecretInput), '\x00') {
		return ErrInvalidCLIRequest
	}
	secretCreate := len(r.Args) == 13 && r.Args[0] == "service" && r.Args[1] == "secret" && r.Args[2] == "create" && r.Args[9] == "--label" && r.Args[11] == "--secret-stdin" && r.Args[12] == "--confirm"
	secretRotate := len(r.Args) == 15 && r.Args[0] == "service" && r.Args[1] == "secret" && r.Args[2] == "rotate" && r.Args[11] == "--label" && r.Args[13] == "--secret-stdin" && r.Args[14] == "--confirm"
	if (secretCreate || secretRotate) != (len(r.SecretInput) > 0) {
		return ErrInvalidCLIRequest
	}
	return validateCLICommand(r.Args)
}

func (i CLIIntent) Validate() error {
	if strings.TrimSpace(i.Command) == "" || strings.ContainsAny(i.Command, "\x00\r\n") {
		return ErrInvalidCLIRequest
	}
	for _, value := range []string{i.Target, i.OperationID, i.ProfilePath, i.ArtifactID, i.Version, i.Platform, i.BinaryPath, i.Digest, i.ServiceID, i.Purpose, i.Label, i.Reference, i.ResourceID, i.PageID, i.ActionID, i.ArtifactPath, i.ContentType, i.MetadataPath, i.RequestFilePath, i.IfMatch, i.IdempotencyKey} {
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
	if len(args) == 5 && args[0] == "core" && args[1] == "settings" && args[2] == "inspect" && args[3] == "--target" {
		return requireLocalTarget(args[4])
	}
	if len(args) == 8 && args[0] == "core" && args[1] == "settings" && args[2] == "update" && args[3] == "--target" && args[4] == "local" && args[5] == "--request-file" && args[7] == "--confirm" {
		if err := requireLocalTarget(args[4]); err != nil {
			return err
		}
		return validCLIAbsoluteFilePath(args[6])
	}
	if len(args) == 5 && args[0] == "core" && args[1] == "binary" && args[2] == "inspect" && args[3] == "--path" {
		return validCLIAbsoluteFilePath(args[4])
	}
	if len(args) == 10 && args[0] == "core" && args[1] == "binary" && args[2] == "update" && args[3] == "--target" && args[4] == "local" && args[5] == "--path" && args[7] == "--digest" && args[9] == "--confirm" {
		if err := requireLocalTarget(args[4]); err != nil {
			return err
		}
		if err := validCLIAbsoluteFilePath(args[6]); err != nil {
			return err
		}
		if !validSHA256Digest(args[8]) {
			return ErrInvalidCLIRequest
		}
		return nil
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
	if len(args) == 6 && args[0] == "dev" && args[1] == "plan" && args[2] == "--project" && args[4] == "--target" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		return requireLocalTarget(args[5])
	}
	if len(args) == 8 && args[0] == "dev" && args[1] == "apply" && args[2] == "--project" && args[4] == "--target" && args[6] == "--confirm" && args[7] == "--wait" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		return requireLocalTarget(args[5])
	}
	if len(args) == 9 && args[0] == "dev" && args[1] == "apply" && args[2] == "--project" && args[4] == "--target" && args[6] == "--confirm" && args[7] == "--wait" && args[8] == "--retry-failed" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		return requireLocalTarget(args[5])
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
	if len(args) == 3 && args[0] == "service" && args[1] == "artifact" && args[2] == "list" {
		return nil
	}
	if len(args) == 9 && args[0] == "service" && args[1] == "artifact" && args[2] == "remove" && args[3] == "--id" && args[5] == "--version" && args[7] == "--platform" {
		if err := validCLIIdentifier(args[4]); err != nil {
			return err
		}
		if args[6] == "" || args[8] == "" || strings.ContainsAny(args[6]+args[8], "\x00\r\n") {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 9 && args[0] == "service" && args[1] == "artifact" && args[2] == "inspect" && args[3] == "--id" && args[5] == "--version" && args[7] == "--platform" {
		return validCLIIdentifier(args[4])
	}
	if len(args) == 11 && args[0] == "service" && args[1] == "artifact" && args[2] == "register" && args[3] == "--id" && args[5] == "--version" && args[7] == "--platform" && args[9] == "--path" {
		if err := validCLIIdentifier(args[4]); err != nil {
			return err
		}
		if args[6] == "" || args[8] == "" || !filepath.IsAbs(args[10]) {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 11 && args[0] == "service" && args[1] == "artifact" && args[2] == "trust" && args[3] == "--id" && args[5] == "--version" && args[7] == "--platform" && args[9] == "--digest" {
		if err := validCLIIdentifier(args[4]); err != nil {
			return err
		}
		if args[6] == "" || args[8] == "" || !strings.HasPrefix(args[10], "sha256:") {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 5 && args[0] == "service" && isOneOf(args[1], "inspect", "manifest", "schema", "status") && args[3] == "--target" {
		if err := validCLIIdentifier(args[2]); err != nil {
			return err
		}
		return requireLocalTarget(args[4])
	}
	if len(args) == 6 && args[0] == "service" && args[1] == "admin-surface" && args[2] == "inspect" && args[4] == "--target" {
		if err := validCLIIdentifier(args[3]); err != nil {
			return err
		}
		return requireLocalTarget(args[5])
	}
	if len(args) == 7 && args[0] == "service" && args[1] == "secret" && args[2] == "list" && args[3] == "--target" && args[5] == "--service" {
		if err := requireLocalTarget(args[4]); err != nil {
			return err
		}
		return validCLIIdentifier(args[6])
	}
	if len(args) == 9 && args[0] == "service" && args[1] == "secret" && args[2] == "list" && args[3] == "--target" && args[5] == "--service" && args[7] == "--purpose" {
		if err := requireLocalTarget(args[4]); err != nil {
			return err
		}
		if err := validCLIIdentifier(args[6]); err != nil {
			return err
		}
		if !validSecretPurpose(args[8]) {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 13 && args[0] == "service" && args[1] == "secret" && args[2] == "create" && args[3] == "--target" && args[4] == "local" && args[5] == "--service" && args[7] == "--purpose" && args[9] == "--label" && args[11] == "--secret-stdin" && args[12] == "--confirm" {
		if err := validCLIIdentifier(args[6]); err != nil {
			return err
		}
		if !validSecretPurpose(args[8]) || strings.TrimSpace(args[10]) == "" || strings.TrimSpace(args[10]) != args[10] || len([]rune(args[10])) > 128 || strings.ContainsAny(args[10], "\x00\r\n") {
			return ErrInvalidCLIRequest
		}
		return requireLocalTarget(args[4])
	}
	if len(args) == 15 && args[0] == "service" && args[1] == "secret" && args[2] == "rotate" && args[3] == "--target" && args[4] == "local" && args[5] == "--service" && args[7] == "--reference" && args[9] == "--purpose" && args[11] == "--label" && args[13] == "--secret-stdin" && args[14] == "--confirm" {
		if err := validCLIIdentifier(args[6]); err != nil {
			return err
		}
		if !validOpaqueServiceSecretReference(args[8]) || !validSecretPurpose(args[10]) || strings.TrimSpace(args[12]) == "" || strings.TrimSpace(args[12]) != args[12] || len([]rune(args[12])) > 128 || strings.ContainsAny(args[12], "\x00\r\n") {
			return ErrInvalidCLIRequest
		}
		return requireLocalTarget(args[4])
	}
	if len(args) == 10 && args[0] == "service" && args[1] == "secret" && args[2] == "revoke" && args[3] == "--target" && args[5] == "--service" && args[7] == "--reference" && args[9] == "--confirm" {
		if err := requireLocalTarget(args[4]); err != nil {
			return err
		}
		if err := validCLIIdentifier(args[6]); err != nil {
			return err
		}
		if !validOpaqueServiceSecretReference(args[8]) {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 10 && args[0] == "service" && args[1] == "secret" && args[2] == "register" && args[3] == "--target" && args[5] == "--service" && args[7] == "--reference" && args[9] == "--confirm" {
		if err := requireLocalTarget(args[4]); err != nil {
			return err
		}
		if err := validCLIIdentifier(args[6]); err != nil {
			return err
		}
		if !validOpaqueServiceSecretReference(args[8]) {
			return ErrInvalidCLIRequest
		}
		return nil
	}
	if len(args) == 8 && args[0] == "service" && args[1] == "resource" && args[2] == "list" && args[4] == "--resource" && args[6] == "--target" {
		if err := validCLIIdentifier(args[3]); err != nil {
			return err
		}
		if err := validCLIIdentifier(args[5]); err != nil {
			return err
		}
		return requireLocalTarget(args[7])
	}
	if (len(args) == 20 || len(args) == 22) && args[0] == "service" && args[1] == "resource" && args[2] == "publish" &&
		args[4] == "--project" && args[6] == "--page" && args[8] == "--action" && args[10] == "--artifact-file" &&
		args[12] == "--content-type" && args[14] == "--metadata-file" {
		if err := validCLIIdentifier(args[3]); err != nil {
			return err
		}
		for _, identifier := range []string{args[7], args[9]} {
			if err := validCLIIdentifier(identifier); err != nil {
				return err
			}
		}
		for _, projectPath := range []string{args[11], args[15]} {
			if err := validCLIProjectPath(projectPath); err != nil || strings.Contains(projectPath, `\`) {
				return ErrInvalidCLIRequest
			}
		}
		idempotencyKeyIndex, targetFlagIndex, targetIndex := 17, 18, 19
		if len(args) == 22 {
			if args[16] != "--if-match" || strings.TrimSpace(args[17]) == "" || strings.ContainsAny(args[17], "\x00\r\n") {
				return ErrInvalidCLIRequest
			}
			idempotencyKeyIndex, targetFlagIndex, targetIndex = 19, 20, 21
		}
		if args[targetFlagIndex] != "--target" {
			return ErrInvalidCLIRequest
		}
		for _, value := range []string{args[5], args[13], args[idempotencyKeyIndex]} {
			if strings.TrimSpace(value) == "" || strings.ContainsAny(value, "\x00\r\n") {
				return ErrInvalidCLIRequest
			}
		}
		return requireLocalTarget(args[targetIndex])
	}
	if len(args) == 8 && args[0] == "runtime" && isOneOf(args[1], "plan", "start", "stop", "restart", "status", "logs", "inspect") && args[2] == "--project" && args[4] == "--revision" && args[6] == "--target" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		if args[5] != "HEAD" && args[5] != "WORKING_TREE" {
			return ErrInvalidCLIRequest
		}
		return requireLocalTarget(args[7])
	}
	if len(args) == 10 && args[0] == "runtime" && isOneOf(args[1], "start", "stop", "restart", "logs", "inspect") && args[2] == "--project" && args[4] == "--revision" && args[6] == "--target" && args[8] == "--service" {
		if err := validCLIAbsoluteProjectPath(args[3]); err != nil {
			return err
		}
		if args[5] != "HEAD" && args[5] != "WORKING_TREE" {
			return ErrInvalidCLIRequest
		}
		if err := requireLocalTarget(args[7]); err != nil {
			return err
		}
		return validCLIIdentifier(args[9])
	}
	return ErrInvalidCLIRequest
}

func validCLIAbsoluteFilePath(value string) error {
	if !filepath.IsAbs(value) || filepath.Clean(value) == string(filepath.Separator) {
		return ErrInvalidCLIRequest
	}
	return nil
}

func validSHA256Digest(value string) bool {
	if len(value) != len("sha256:")+64 || !strings.HasPrefix(value, "sha256:") {
		return false
	}
	digest := value[len("sha256:"):]
	if strings.ToLower(digest) != digest {
		return false
	}
	_, err := hex.DecodeString(digest)
	return err == nil
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

func validSecretPurpose(value string) bool {
	if value == "" || len(value) > 192 || strings.TrimSpace(value) != value {
		return false
	}
	for _, part := range strings.Split(value, ".") {
		if part == "" || part[0] < 'a' || part[0] > 'z' {
			return false
		}
		for _, character := range part {
			if !strings.ContainsRune("abcdefghijklmnopqrstuvwxyz0123456789-", character) {
				return false
			}
		}
	}
	return true
}

func validOpaqueServiceSecretReference(value string) bool {
	const prefix = "ssr:v1:"
	if len(value) != len(prefix)+32 || !strings.HasPrefix(value, prefix) {
		return false
	}
	for _, character := range value[len(prefix):] {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return false
		}
	}
	return true
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
