// Package cli owns the reviewed Studio-to-liapoldus command vocabulary.
package cli

import (
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
	case "plugin.artifact.list":
		args = []string{"plugin", "artifact", "list"}
	case "plugin.artifact.inspect":
		if !validArtifactFields(intent) {
			return nil, ErrInvalidIntent
		}
		args = []string{"plugin", "artifact", "inspect", "--id", intent.ArtifactID, "--version", intent.Version, "--platform", intent.Platform}
	case "plugin.artifact.register":
		if !validArtifactFields(intent) || !validAbsolutePath(intent.BinaryPath) {
			return nil, ErrInvalidIntent
		}
		args = []string{"plugin", "artifact", "register", "--id", intent.ArtifactID, "--version", intent.Version, "--platform", intent.Platform, "--path", filepath.Clean(intent.BinaryPath)}
	case "plugin.artifact.trust":
		if !validArtifactFields(intent) || strings.TrimSpace(intent.Digest) == "" {
			return nil, ErrInvalidIntent
		}
		args = []string{"plugin", "artifact", "trust", "--id", intent.ArtifactID, "--version", intent.Version, "--platform", intent.Platform, "--digest", intent.Digest}
	case "plugin.inspect", "plugin.manifest", "plugin.schema", "plugin.status":
		if target != "local" || !validTarget(intent.ArtifactID) {
			return nil, ErrInvalidIntent
		}
		args = []string{"plugin", strings.TrimPrefix(intent.Command, "plugin."), intent.ArtifactID, "--target", target}
	case "runtime.plan", "runtime.start", "runtime.stop", "runtime.restart", "runtime.status", "runtime.logs", "runtime.inspect":
		if target != "local" {
			return nil, ErrInvalidIntent
		}
		args = []string{"runtime", strings.TrimPrefix(intent.Command, "runtime."), "--project", root, "--revision", "HEAD", "--target", target}
		if isOneOf(intent.Command, "runtime.restart", "runtime.logs", "runtime.inspect") {
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

func validTarget(value string) bool {
	return strings.TrimSpace(value) != "" && !strings.HasPrefix(value, "-") && !strings.ContainsAny(value, " /\\:@?#\x00\r\n")
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

func validArtifactFields(intent models.CLIIntent) bool {
	return validTarget(intent.ArtifactID) && strings.TrimSpace(intent.Version) != "" && strings.TrimSpace(intent.Platform) != "" && !strings.ContainsAny(intent.Version+intent.Platform, "\x00\r\n")
}

func validAbsolutePath(value string) bool {
	value = filepath.Clean(strings.TrimSpace(value))
	return filepath.IsAbs(value) && value != string(filepath.Separator) && !strings.ContainsAny(value, "\x00\r\n")
}
