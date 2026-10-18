package models

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestCLIEventPreservesOperationAndTargetMetadata(t *testing.T) {
	var event CLIEvent
	if err := json.Unmarshal([]byte(`{"schemaVersion":"cli-events/v1","type":"operation.updated","operationId":"op-1","target":"local","state":"running","kind":"apply","timestamp":"2026-10-10T00:00:00Z"}`), &event); err != nil {
		t.Fatal(err)
	}
	if !event.Valid() || event.OperationID != "op-1" || event.Target != "local" || event.State != "running" || event.Kind != "apply" {
		t.Fatalf("metadata was not preserved: %+v", event)
	}
}

func TestCLIRequestAllowsOnlyReviewedStudioCommandShapes(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name string
		args []string
		want bool
	}{
		{name: "validate", args: []string{"validate"}, want: true},
		{name: "local plan", args: []string{"plan", "--target", "local"}, want: true},
		{name: "local observe", args: []string{"observe", "traffic", "--target", "local"}, want: true},
		{name: "target inspect", args: []string{"target", "inspect", "local"}, want: true},
		{name: "remote apply rejected", args: []string{"apply", "--target", "production"}},
		{name: "unknown core command", args: []string{"core", "shell"}},
		{name: "extra apply flag rejected", args: []string{"apply", "--target", "local", "--revision", "abc123"}},
		{name: "arbitrary target subcommand rejected", args: []string{"target", "remove", "production"}},
		{name: "empty argument rejected", args: []string{"target", "inspect", ""}},
		{name: "service status", args: []string{"service", "status", "echo", "--target", "local"}, want: true},
		{name: "service admin surface from Core", args: []string{"service", "admin-surface", "inspect", "server", "--target", "local"}, want: true},
		{name: "service admin surface remote target rejected", args: []string{"service", "admin-surface", "inspect", "server", "--target", "production"}},
		{name: "service admin query binds the inspected surface", args: []string{"service", "admin", "query", "server", "--page", "sites", "--section", "sites", "--surface-digest", "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "--target", "local"}, want: true},
		{name: "service admin invoke binds the inspected surface", args: []string{"service", "admin", "invoke", "server", "--page", "sites", "--section", "sites", "--action", "rollback", "--project", root, "--surface-digest", "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "--request-file", filepath.Join(root, ".studio", "action.json"), "--if-match", "revision-1", "--idempotency-key", "action-1", "--target", "local", "--confirm"}, want: true},
		{name: "service admin invoke rejects invalid surface digest", args: []string{"service", "admin", "invoke", "server", "--page", "sites", "--section", "sites", "--action", "rollback", "--project", root, "--surface-digest", "invalid", "--request-file", filepath.Join(root, ".studio", "action.json"), "--if-match", "revision-1", "--idempotency-key", "action-1", "--target", "local", "--confirm"}},
		{name: "service secret list", args: []string{"service", "secret", "list", "--target", "local", "--service", "server"}, want: true},
		{name: "service secret create requires trusted stdin", args: []string{"service", "secret", "create", "--target", "local", "--service", "server", "--purpose", "http.auth.bearer", "--label", "edge token", "--secret-stdin", "--confirm"}},
		{name: "service secret rotate requires trusted stdin", args: []string{"service", "secret", "rotate", "--target", "local", "--service", "server", "--reference", "ssr:v1:00112233445566778899aabbccddeeff", "--purpose", "http.auth.bearer", "--label", "edge token v2", "--secret-stdin", "--confirm"}},
		{name: "service secret register uses only staged reference", args: []string{"service", "secret", "register", "--target", "local", "--service", "server", "--reference", "ssr:v1:00112233445566778899aabbccddeeff", "--confirm"}, want: true},
		{name: "service secret revoke is Project-scoped", args: []string{"service", "secret", "revoke", "--target", "local", "--project", root, "--service", "server", "--reference", "ssr:v1:00112233445566778899aabbccddeeff", "--confirm"}, want: true},
		{name: "development apply waits for Core", args: []string{"dev", "apply", "--project", root, "--target", "local", "--confirm", "--wait"}, want: true},
		{name: "development apply without observation rejected", args: []string{"dev", "apply", "--project", root, "--target", "local", "--confirm"}},
		{name: "old plugin status rejected", args: []string{"plugin", "status", "echo", "--target", "local"}},
		{name: "old plugin artifact rejected", args: []string{"plugin", "artifact", "list"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := (CLIRequest{ProjectRoot: root, Args: test.args}).Validate()
			if test.want && err != nil {
				t.Fatalf("expected command to be allowed, got %v", err)
			}
			if !test.want && err == nil {
				t.Fatal("expected command to be rejected")
			}
		})
	}
}

func TestSecretRevokeMustUseTheSameProjectRootAsItsRequest(t *testing.T) {
	root := t.TempDir()
	otherProject := t.TempDir()
	request := CLIRequest{
		ProjectRoot: root,
		WorkingDir:  root,
		Args:        []string{"service", "secret", "revoke", "--target", "local", "--project", otherProject, "--service", "server", "--reference", "ssr:v1:00112233445566778899aabbccddeeff", "--confirm"},
	}
	if err := request.Validate(); err == nil {
		t.Fatal("secret revocation accepted a Project path different from the host request scope")
	}
}

func TestCLISecretInputIsAllowedOnlyForServiceSecretCreateOrRotate(t *testing.T) {
	root := t.TempDir()
	args := []string{"service", "secret", "create", "--target", "local", "--service", "server", "--purpose", "http.auth.bearer", "--label", "edge token", "--secret-stdin", "--confirm"}
	if err := (CLIRequest{ProjectRoot: root, Args: args, SecretInput: []byte("host-owned-value")}).Validate(); err != nil {
		t.Fatalf("typed secure secret input was rejected: %v", err)
	}
	rotateArgs := []string{"service", "secret", "rotate", "--target", "local", "--service", "server", "--reference", "ssr:v1:00112233445566778899aabbccddeeff", "--purpose", "http.auth.bearer", "--label", "edge token v2", "--secret-stdin", "--confirm"}
	if err := (CLIRequest{ProjectRoot: root, Args: rotateArgs, SecretInput: []byte("host-owned-value")}).Validate(); err != nil {
		t.Fatalf("typed secure rotation input was rejected: %v", err)
	}
	for _, request := range []CLIRequest{
		{ProjectRoot: root, Args: []string{"validate"}, SecretInput: []byte("secret")},
		{ProjectRoot: root, Args: args},
		{ProjectRoot: root, Args: args, SecretInput: []byte("\x00")},
		{ProjectRoot: root, Args: args, SecretInput: make([]byte, (16<<10)+1)},
	} {
		if err := request.Validate(); err == nil {
			t.Fatalf("unsafe secret input request was accepted: %+v", request.Args)
		}
	}
}
