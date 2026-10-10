package models

import (
	"encoding/json"
	"testing"
)

func TestCLIHandoffValidationPinsRevisionAndRejectsLocal(t *testing.T) {
	handoff := CLIHandoff{
		SchemaVersion: "studio-cli-handoff/v1",
		ProjectID:     "project-1",
		Repository:    "/workspace/project",
		CommitSHA:     "abc123",
		Target:        "production",
		Args:          []string{"apply", "--target", "production", "--revision", "abc123"},
	}
	if err := handoff.Validate(); err != nil {
		t.Fatal(err)
	}
	handoff.Target = "local"
	handoff.Args[2] = "local"
	if err := handoff.Validate(); err == nil {
		t.Fatal("accepted local deployment handoff")
	}
}

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
