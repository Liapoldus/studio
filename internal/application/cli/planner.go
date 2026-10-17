// Package cli owns the reviewed Studio-to-liapoldus command vocabulary.
package cli

import (
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/models"
)

var ErrInvalidIntent = errors.New("invalid Studio CLI intent")

// Plan converts a high-level Studio command into the exact argv accepted by
// the installed liapoldus executable.
func Plan(intent models.CLIIntent, projectRoot string) ([]string, error) {
	if err := intent.Validate(); err != nil {
		return nil, err
	}
	root := filepath.Clean(strings.TrimSpace(projectRoot))
	if root == "." || !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return nil, models.ErrInvalidCLIRequest
	}
	target := strings.TrimSpace(intent.Target)
	var args []string
	switch intent.Command {
	case "validate":
		args = []string{"validate", "--project", root, "--revision", "HEAD"}
	case "project.inspect":
		args = []string{"project", "inspect", "--project", root}
	case "target.list":
		args = []string{"target", "list"}
	case "target.inspect", "target.test":
		if !validTarget(target) {
			return nil, ErrInvalidIntent
		}
		args = []string{"target", strings.TrimPrefix(intent.Command, "target."), target}
	case "target.add":
		if !validTarget(target) || !validRelativeProfile(intent.ProfilePath) {
			return nil, ErrInvalidIntent
		}
		args = []string{"target", "add", target, "--profile", filepath.ToSlash(filepath.Clean(intent.ProfilePath))}
	case "core.start", "core.stop", "core.restart", "core.status", "core.logs":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"core", strings.TrimPrefix(intent.Command, "core."), "--target", target}
	case "core.settings.inspect":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"core", "settings", "inspect", "--target", target}
	case "core.settings.update":
		if target != "local" || !validAbsolutePath(intent.RequestFilePath) {
			return nil, ErrInvalidIntent
		}
		args = []string{"core", "settings", "update", "--target", target, "--request-file", filepath.Clean(intent.RequestFilePath), "--confirm"}
	case "core.binary.inspect":
		if !validAbsolutePath(intent.BinaryPath) {
			return nil, ErrInvalidIntent
		}
		args = []string{"core", "binary", "inspect", "--path", filepath.Clean(intent.BinaryPath)}
	case "core.binary.update":
		if target != "local" || !validAbsolutePath(intent.BinaryPath) || !validSHA256(intent.Digest) {
			return nil, ErrInvalidIntent
		}
		args = []string{"core", "binary", "update", "--target", target, "--path", filepath.Clean(intent.BinaryPath), "--digest", intent.Digest, "--confirm"}
	case "credential.status":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"credential", "status", "--target", target}
	case "plan":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"plan", "--project", root, "--revision", "HEAD", "--target", target}
	case "apply":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"apply", "--project", root, "--revision", "HEAD", "--target", target, "--confirm"}
	case "dev.plan":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"dev", "plan", "--project", root, "--target", target}
	case "dev.apply":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"dev", "apply", "--project", root, "--target", target, "--confirm", "--wait"}
	case "dev.apply.retryFailed":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"dev", "apply", "--project", root, "--target", target, "--confirm", "--wait", "--retry-failed"}
	case "operation.get", "operation.watch":
		if target != "local" || strings.TrimSpace(intent.OperationID) == "" || strings.ContainsAny(intent.OperationID, " /\\:@?#\x00\r\n") {
			return nil, ErrInvalidIntent
		}
		args = []string{"operation", strings.TrimPrefix(intent.Command, "operation."), intent.OperationID, "--target", target}
	case "observe.traffic":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"observe", "traffic", "--project", root, "--target", target}
	case "service.artifact.list":
		args = []string{"service", "artifact", "list"}
	case "service.artifact.inspect":
		if !validArtifactFields(intent) {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "artifact", "inspect", "--id", intent.ArtifactID, "--version", intent.Version, "--platform", intent.Platform}
	case "service.artifact.register":
		if !validArtifactFields(intent) || !validAbsolutePath(intent.BinaryPath) {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "artifact", "register", "--id", intent.ArtifactID, "--version", intent.Version, "--platform", intent.Platform, "--path", filepath.Clean(intent.BinaryPath)}
	case "service.artifact.trust":
		if !validArtifactFields(intent) || strings.TrimSpace(intent.Digest) == "" {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "artifact", "trust", "--id", intent.ArtifactID, "--version", intent.Version, "--platform", intent.Platform, "--digest", intent.Digest}
	case "service.artifact.remove":
		if !validArtifactFields(intent) {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "artifact", "remove", "--id", intent.ArtifactID, "--version", intent.Version, "--platform", intent.Platform}
	case "service.inspect", "service.manifest", "service.schema", "service.status":
		if target != "local" || !validTarget(intent.ServiceID) {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", strings.TrimPrefix(intent.Command, "service."), intent.ServiceID, "--target", target}
	case "service.admin-surface.inspect":
		if target != "local" || !validTarget(intent.ServiceID) {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "admin-surface", "inspect", intent.ServiceID, "--target", target}
	case "service.secret.list":
		if target != "local" || !validTarget(intent.ServiceID) || intent.Label != "" || intent.Reference != "" || intent.Purpose != "" && !validStudioSecretPurpose(intent.Purpose) {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "secret", "list", "--target", target, "--service", intent.ServiceID}
		if intent.Purpose != "" {
			args = append(args, "--purpose", intent.Purpose)
		}
	case "service.secret.create":
		if target != "local" || !validTarget(intent.ServiceID) || !validStudioSecretPurpose(intent.Purpose) ||
			strings.TrimSpace(intent.Label) == "" || strings.TrimSpace(intent.Label) != intent.Label || len([]rune(intent.Label)) > 128 ||
			strings.ContainsAny(intent.Label, "\x00\r\n") || intent.Reference != "" {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "secret", "create", "--target", target, "--service", intent.ServiceID, "--purpose", intent.Purpose, "--label", intent.Label, "--secret-stdin", "--confirm"}
	case "service.secret.rotate":
		if target != "local" || !validTarget(intent.ServiceID) || !validStudioSecretReference(intent.Reference) || !validStudioSecretPurpose(intent.Purpose) ||
			strings.TrimSpace(intent.Label) == "" || strings.TrimSpace(intent.Label) != intent.Label || len([]rune(intent.Label)) > 128 || strings.ContainsAny(intent.Label, "\x00\r\n") {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "secret", "rotate", "--target", target, "--service", intent.ServiceID, "--reference", intent.Reference, "--purpose", intent.Purpose, "--label", intent.Label, "--secret-stdin", "--confirm"}
	case "service.secret.register":
		if target != "local" || !validTarget(intent.ServiceID) || !validStudioSecretReference(intent.Reference) || intent.Purpose != "" || intent.Label != "" {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "secret", "register", "--target", target, "--service", intent.ServiceID, "--reference", intent.Reference, "--confirm"}
	case "service.secret.revoke":
		if target != "local" || !validTarget(intent.ServiceID) || !validStudioSecretReference(intent.Reference) || intent.Purpose != "" || intent.Label != "" {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "secret", "revoke", "--target", target, "--service", intent.ServiceID, "--reference", intent.Reference, "--confirm"}
	case "service.resource.list":
		if target != "local" || !validTarget(intent.ServiceID) || !validTarget(intent.ResourceID) {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "resource", "list", intent.ServiceID, "--resource", intent.ResourceID, "--target", target}
	case "service.resource.publish":
		if target != "local" || !validTarget(intent.ServiceID) || !validTarget(intent.PageID) || !validTarget(intent.ActionID) ||
			!validRelativeResourcePath(intent.ArtifactPath) || !validRelativeResourcePath(intent.MetadataPath) ||
			strings.TrimSpace(intent.ContentType) == "" || strings.TrimSpace(intent.IdempotencyKey) == "" ||
			strings.ContainsAny(intent.ContentType+intent.IfMatch+intent.IdempotencyKey, "\r\n") {
			return nil, ErrInvalidIntent
		}
		args = []string{"service", "resource", "publish", intent.ServiceID,
			"--project", root, "--page", intent.PageID, "--action", intent.ActionID,
			"--artifact-file", filepath.ToSlash(filepath.Clean(intent.ArtifactPath)), "--content-type", intent.ContentType,
			"--metadata-file", filepath.ToSlash(filepath.Clean(intent.MetadataPath))}
		if intent.IfMatch != "" {
			args = append(args, "--if-match", intent.IfMatch)
		}
		args = append(args, "--idempotency-key", intent.IdempotencyKey, "--target", target)
	case "runtime.plan", "runtime.start", "runtime.stop", "runtime.restart", "runtime.status", "runtime.logs", "runtime.inspect":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		// Local Docker runtime is a development workflow and must observe the
		// Project currently open in Studio, including uncommitted artifact pins.
		args = []string{"runtime", strings.TrimPrefix(intent.Command, "runtime."), "--project", root, "--revision", "WORKING_TREE", "--target", target}
		if strings.TrimSpace(intent.ServiceID) != "" {
			if !isOneOf(intent.Command, "runtime.start", "runtime.stop", "runtime.restart", "runtime.logs", "runtime.inspect") || !validTarget(intent.ServiceID) {
				return nil, ErrInvalidIntent
			}
			args = append(args, "--service", intent.ServiceID)
		} else if isOneOf(intent.Command, "runtime.logs", "runtime.inspect") {
			if !validTarget(intent.ServiceID) {
				return nil, ErrInvalidIntent
			}
			args = append(args, "--service", intent.ServiceID)
		}
	default:
		return nil, ErrInvalidIntent
	}
	return args, nil
}

func validStudioSecretPurpose(value string) bool {
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

func validStudioSecretReference(value string) bool {
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

func validTarget(value string) bool {
	return strings.TrimSpace(value) != "" && !strings.HasPrefix(value, "-") && !strings.ContainsAny(value, " /\\:@?#\x00\r\n")
}

func validSHA256(value string) bool {
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

func isOneOf(value string, values ...string) bool {
	for _, candidate := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func validRelativeProfile(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || filepath.IsAbs(value) || strings.ContainsAny(value, "\x00\r\n") {
		return false
	}
	clean := filepath.Clean(value)
	return clean != "." && clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}

func validRelativeResourcePath(value string) bool {
	return validRelativeProfile(value) && !strings.Contains(value, `\`)
}

func validArtifactFields(intent models.CLIIntent) bool {
	return validTarget(intent.ArtifactID) && strings.TrimSpace(intent.Version) != "" && strings.TrimSpace(intent.Platform) != "" && !strings.ContainsAny(intent.Version+intent.Platform, "\x00\r\n")
}

func validAbsolutePath(value string) bool {
	value = filepath.Clean(strings.TrimSpace(value))
	return filepath.IsAbs(value) && value != string(filepath.Separator) && !strings.ContainsAny(value, "\x00\r\n")
}
