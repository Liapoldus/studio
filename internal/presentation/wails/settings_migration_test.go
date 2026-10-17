package wails

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPreviewProjectSettingsVersionMigrationChangesOnlyTheDeclaredMarker(t *testing.T) {
	original := []byte(`{"schemaVersion":1,"config":{"unrecognized":{"keep":"opaque-ref"}},"legacyField":{"preserve":true}}`)
	schema := []byte(`{"type":"object","properties":{"schemaVersion":{"const":2},"config":{"type":"object"}}}`)
	migration, found, err := previewProjectSettingsVersionMigration(original, schema)
	if err != nil || !found {
		t.Fatalf("migration preview=%+v err=%v", migration, err)
	}
	if migration.FromVersion != 1 || migration.ToVersion != 2 || migration.CandidateDigest == "" {
		t.Fatalf("unexpected migration metadata: %+v", migration)
	}
	var before, after map[string]json.RawMessage
	if err := json.Unmarshal(original, &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(migration.Candidate, &after); err != nil {
		t.Fatal(err)
	}
	if string(after["schemaVersion"]) != "2" || string(after["config"]) != string(before["config"]) || string(after["legacyField"]) != string(before["legacyField"]) {
		t.Fatalf("migration changed values outside schemaVersion: %s", migration.Candidate)
	}
	if !strings.Contains(string(migration.Candidate), "opaque-ref") {
		t.Fatalf("migration discarded unknown nested values: %s", migration.Candidate)
	}
}

func TestPreviewProjectSettingsVersionMigrationDoesNotGuess(t *testing.T) {
	cases := []struct {
		name      string
		settings  string
		schema    string
		wantError bool
	}{
		{name: "unversioned", settings: `{"config":{}}`, schema: `{"properties":{"schemaVersion":{"const":2}}}`},
		{name: "non integer target", settings: `{"schemaVersion":1}`, schema: `{"properties":{"schemaVersion":{"const":"2"}}}`, wantError: true},
		{name: "malformed settings", settings: `{"schemaVersion":`, schema: `{"properties":{"schemaVersion":{"const":2}}}`, wantError: true},
		{name: "same version", settings: `{"schemaVersion":2}`, schema: `{"properties":{"schemaVersion":{"const":2}}}`},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			migration, found, err := previewProjectSettingsVersionMigration([]byte(test.settings), []byte(test.schema))
			if (err != nil) != test.wantError || found || migration.FromVersion != 0 {
				t.Fatalf("unexpected guessed migration=%+v err=%v", migration, err)
			}
		})
	}
}
