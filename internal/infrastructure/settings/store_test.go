package settings

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	projectfiles "github.com/Liapoldus/studio/internal/infrastructure/filesystem"
)

func TestStoreRedactsAndPreservesSensitiveFields(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/runtime/settings.json", `{"type":"object","properties":{"endpoint":{"type":"string"},"apiToken":{"type":"string","x-sensitive":true,"default":"secret-default"}}}`)
	write("services/runtime/settings.json", `{"endpoint":"http://localhost","apiToken":"secret"}`)
	store := Store{Files: files}
	data, err := store.Read(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(data) == "" || string(data) == `{"endpoint":"http://localhost","apiToken":"secret"}` {
		t.Fatalf("settings were not redacted: %s", data)
	}
	schemaData, err := store.ReadSchema(context.Background(), root, "schemas/runtime/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(schemaData) == "" || strings.Contains(string(schemaData), "secret-default") {
		t.Fatalf("sensitive schema metadata was not redacted: %s", schemaData)
	}
	if updateErr := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"endpoint":"http://127.0.0.1"}`)); updateErr != nil {
		t.Fatal(updateErr)
	}
	updated, err := os.ReadFile(filepath.Join(root, "services/runtime/settings.json")) //nolint:gosec // root is a test-owned temporary directory.
	if err != nil {
		t.Fatal(err)
	}
	var object map[string]string
	if err := json.Unmarshal(updated, &object); err != nil {
		t.Fatal(err)
	}
	if object["endpoint"] != "http://127.0.0.1" || object["apiToken"] != "secret" {
		t.Fatalf("unexpected update: %s", updated)
	}
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"apiToken":"leak"}`)); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("expected sensitive update rejection, got %v", err)
	}
}

func TestStoreValidatesRenderedSchemaBeforeWriting(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/runtime/settings.json", `{"type":"object","required":["mode","port"],"additionalProperties":false,"properties":{"mode":{"type":"string","enum":["local","remote"]},"port":{"type":"integer","minimum":1,"maximum":65535},"labels":{"type":"array","items":{"type":"string","minLength":2}}}}`)
	write("services/runtime/settings.json", `{"mode":"local","port":8080,"labels":["api"]}`)
	store := Store{Files: files}

	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"mode":"remote","port":443}`)); err != nil {
		t.Fatalf("valid schema update failed: %v", err)
	}
	invalid := []struct {
		name  string
		patch string
	}{
		{name: "wrong type", patch: `{"port":"443"}`},
		{name: "enum", patch: `{"mode":"staging"}`},
		{name: "integer constraint", patch: `{"port":0}`},
		{name: "required", patch: `{"mode":null}`},
		{name: "array item", patch: `{"labels":["x"]}`},
		{name: "unknown property", patch: `{"extra":true}`},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(test.patch)); err == nil {
				t.Fatalf("expected invalid patch %s to fail", test.patch)
			}
		})
	}
}

func TestStoreResolvesProjectScopedSchemaReferencesAndComposition(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/shared.json", `{"$defs":{"port":{"type":"integer","minimum":1,"maximum":65535},"mode":{"enum":["local","remote"]}}}`)
	write("schemas/runtime/settings.json", `{"type":"object","required":["mode","port"],"properties":{"mode":{"$ref":"../shared.json#/$defs/mode"},"port":{"$ref":"../shared.json#/$defs/port"},"immutable":{"type":"string","readOnly":true},"endpoint":{"oneOf":[{"type":"string","pattern":"^https://"},{"type":"string","const":"local"}]}}}`)
	write("services/runtime/settings.json", `{"mode":"local","port":8080,"immutable":"generated","endpoint":"local"}`)
	store := Store{Files: files}

	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"mode":"remote","port":443,"endpoint":"https://api.example"}`)); err != nil {
		t.Fatalf("schema references should validate: %v", err)
	}
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"port":0}`)); err == nil {
		t.Fatal("expected referenced minimum constraint to reject the patch")
	}
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"immutable":"changed"}`)); err == nil {
		t.Fatal("expected read-only property to reject the patch")
	}
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"endpoint":"http://insecure"}`)); err == nil {
		t.Fatal("expected oneOf branch constraints to reject the patch")
	}
}

func TestStoreRejectsEscapingAndCyclicSchemaReferences(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/cyclic.json", `{"$ref":"./cyclic.json"}`)
	write("schemas/escape.json", `{"$ref":"../../outside.json"}`)
	write("services/runtime/settings.json", `{}`)
	store := Store{Files: files}
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/cyclic.json", []byte(`{}`)); err == nil {
		t.Fatal("expected cyclic schema reference to fail closed")
	}
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/escape.json", []byte(`{}`)); err == nil {
		t.Fatal("expected escaping schema reference to fail closed")
	}
}
