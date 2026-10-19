package settings

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
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

func TestValidateSchemaDocumentUsesProjectConfinedReferencesWithoutWriting(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	if err := files.WriteFile(context.Background(), root, "schemas/server/shared.json", []byte(`{"$defs":{"port":{"type":"integer","minimum":1}}}`)); err != nil {
		t.Fatal(err)
	}
	store := Store{Files: files}
	valid := []byte(`{"type":"object","properties":{"port":{"$ref":"shared.json#/$defs/port"}}}`)
	if err := store.ValidateSchemaDocument(context.Background(), root, "schemas/server/settings.json", valid); err != nil {
		t.Fatalf("valid project-local reference rejected: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "schemas/server/settings.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("validation unexpectedly wrote the schema file: %v", err)
	}
	invalid := []byte(`{"type":"object","properties":{"port":{"$ref":"https://example.invalid/schema.json"}}}`)
	if err := store.ValidateSchemaDocument(context.Background(), root, "schemas/server/settings.json", invalid); !errors.Is(err, ErrInvalidSchema) {
		t.Fatalf("remote schema reference should fail closed, got %v", err)
	}
}

func TestValidateValuesAgainstCandidateSchemaIsReadOnlyAndAcceptsSafeDraftOverlay(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server/settings.json", `{"type":"object","properties":{"port":{"type":"integer","minimum":1,"maximum":65535},"apiToken":{"type":"string","x-sensitive":true}}}`)
	write("services/server/settings.json", `{"port":8080,"apiToken":"must-not-leak"}`)
	store := Store{Files: files}
	candidate := []byte(`{"type":"object","required":["port"],"properties":{"port":{"type":"integer","minimum":1,"maximum":8000},"apiToken":{"type":"string","x-sensitive":true}}}`)

	compatible, err := store.ValidateValuesAgainstSchemaDocument(context.Background(), root, "services/server/settings.json", "schemas/server/settings.json", candidate, []byte(`{"port":9000}`))
	if err != nil {
		t.Fatalf("candidate validation failed: %v", err)
	}
	if compatible {
		t.Fatal("candidate accepted a settings value above its maximum")
	}
	compatible, err = store.ValidateValuesAgainstSchemaDocument(context.Background(), root, "services/server/settings.json", "schemas/server/settings.json", candidate, []byte(`{"port":7000}`))
	if err != nil || !compatible {
		t.Fatalf("safe draft overlay should satisfy candidate schema: compatible=%v err=%v", compatible, err)
	}
	err = files.WriteFile(context.Background(), root, "schemas/server/settings.json", []byte(`{"type":"object"}`))
	if err != nil {
		t.Fatal(err)
	}
	settings, err := os.ReadFile(filepath.Join(root, "services/server/settings.json")) //nolint:gosec // root is a test-owned temporary directory.
	if err != nil {
		t.Fatal(err)
	}
	if string(settings) != `{"port":8080,"apiToken":"must-not-leak"}` {
		t.Fatalf("preview mutated Project settings: %s", settings)
	}
}

func TestValidateProjectSettingsDocumentAgainstCandidateSchemaIsReadOnly(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	if err := files.WriteFile(context.Background(), root, "schemas/server/settings.json", []byte(`{"type":"object"}`)); err != nil {
		t.Fatal(err)
	}
	if err := files.WriteFile(context.Background(), root, "services/server/settings.json", []byte(`{"schemaVersion":1,"config":{"unknown":"preserve"}}`)); err != nil {
		t.Fatal(err)
	}
	store := Store{Files: files}
	candidateSchema := []byte(`{"type":"object","required":["schemaVersion","config"],"additionalProperties":false,"properties":{"schemaVersion":{"const":2},"config":{"type":"object","additionalProperties":true}}}`)
	compatible, err := store.ValidateSettingsDocumentAgainstSchemaDocument(context.Background(), root, "schemas/server/settings.json", candidateSchema, []byte(`{"schemaVersion":2,"config":{"unknown":"preserve"}}`))
	if err != nil || !compatible {
		t.Fatalf("valid candidate document rejected: compatible=%v err=%v", compatible, err)
	}
	incompatible, err := store.ValidateSettingsDocumentAgainstSchemaDocument(context.Background(), root, "schemas/server/settings.json", candidateSchema, []byte(`{"schemaVersion":2,"config":{},"unrecognized":"preserve"}`))
	if err != nil || incompatible {
		t.Fatalf("unknown top-level candidate field was not rejected: compatible=%v err=%v", incompatible, err)
	}
	stored, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil || string(stored) != `{"schemaVersion":1,"config":{"unknown":"preserve"}}` {
		t.Fatalf("validation mutated Project bytes: %s err=%v", stored, err)
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
	write("services/runtime/settings.json", `{"mode":"local","rate":1,"labels":["api"],"metadata":{"x-port":8080}}`)
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"mode":"remote"}`)); err == nil {
		t.Fatal("expected dependentRequired to reject mode without profile")
	}
}

func TestStoreReplacesOnlyAnnotatedJSONSchemaDocuments(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server/settings.json", `{
		"type":"object","properties":{"config":{"type":"object","properties":{"routes":{"type":"array","items":{
			"type":"object","properties":{"api":{"type":"object","properties":{"responses":{"type":"array","items":{
				"type":"object","properties":{"schema":{"type":"object","additionalProperties":true,"x-studio-json-document":true},"example":{"x-studio-json-value":true}},"required":["schema","example"],"additionalProperties":false
			}}}}}}
		}}}}
	}`)
	write("services/server/settings.json", `{"config":{"routes":[{"api":{"responses":[{"schema":{"type":"object","additionalProperties":true},"example":{}}]}}]}}`)
	store := Store{Files: files}
	patch := []byte(`{"config":{"routes":{"0":{"api":{"responses":{"0":{"schema":{"$studioJSONDocument/v1":{"type":"string","minLength":1}},"example":{"$studioJSONDocument/v1":"text example"}}}}}}}}`)
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server/settings.json", patch); err != nil {
		t.Fatalf("annotated JSON Schema document update failed: %v", err)
	}
	updated, err := os.ReadFile(filepath.Join(root, "services/server/settings.json")) //nolint:gosec // root is a test-owned temporary directory.
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]any
	if err := json.Unmarshal(updated, &settings); err != nil {
		t.Fatal(err)
	}
	config, ok := settings["config"].(map[string]any)
	if !ok {
		t.Fatalf("config is not an object: %#v", settings["config"])
	}
	routes, ok := config["routes"].([]any)
	if !ok || len(routes) != 1 {
		t.Fatalf("routes is not a single-item array: %#v", config["routes"])
	}
	route, ok := routes[0].(map[string]any)
	if !ok {
		t.Fatalf("route is not an object: %#v", routes[0])
	}
	api, ok := route["api"].(map[string]any)
	if !ok {
		t.Fatalf("route api is not an object: %#v", route["api"])
	}
	responses, ok := api["responses"].([]any)
	if !ok || len(responses) != 1 {
		t.Fatalf("responses is not a single-item array: %#v", api["responses"])
	}
	response, ok := responses[0].(map[string]any)
	if !ok {
		t.Fatalf("response is not an object: %#v", responses[0])
	}
	responseSchema := response["schema"]
	if !reflect.DeepEqual(responseSchema, map[string]any{"type": "string", "minLength": float64(1)}) {
		t.Fatalf("JSON document was merged instead of replaced: %#v", responseSchema)
	}
	if response["example"] != "text example" {
		t.Fatalf("JSON value was not replaced: %#v", response["example"])
	}
	if strings.Contains(string(updated), configurationJSONDocumentKey) {
		t.Fatalf("internal JSON document operation leaked to Project: %s", updated)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server/settings.json", []byte(`{"config":{"routes":{"0":{"api":{"responses":{"0":{"schema":{"type":"integer"}}}}}}}}`)); !errors.Is(err, ErrUnsupportedPatch) {
		t.Fatalf("unmarked structured replacement should fail closed, got %v", err)
	}
}

func TestStoreNormalizesAnnotatedJSONDocumentsInProtectedArrayInsert(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server/settings.json", `{
		"type":"object","properties":{"routes":{"type":"array","items":{"type":"object","properties":{
			"id":{"type":"string"},"credentialRef":{"type":"string","x-sensitive":true},
			"api":{"type":"object","properties":{"responses":{"type":"array","items":{"type":"object","properties":{
				"contentType":{"type":"string"},"schema":{"type":"object","additionalProperties":true,"x-studio-json-document":true}
			}}}}}
		}}}}
	}`)
	write("services/server/settings.json", `{"routes":[{"id":"health","credentialRef":"managed","api":{"responses":[]}}]}`)
	store := Store{Files: files}
	patch := []byte(`{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":1,"value":{"id":"echo","api":{"responses":[{"contentType":"application/json","schema":{"$studioJSONDocument/v1":{"type":"object","properties":{"message":{"type":"string"}}}}}]}}}]}}`)
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server/settings.json", patch); err != nil {
		t.Fatalf("annotated document insertion failed: %v", err)
	}
	updated, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Routes []struct {
			ID            string `json:"id"`
			CredentialRef string `json:"credentialRef"`
			API           struct {
				Responses []struct {
					Schema map[string]any `json:"schema"`
				} `json:"responses"`
			} `json:"api"`
		} `json:"routes"`
	}
	if err := json.Unmarshal(updated, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Routes) != 2 || result.Routes[1].ID != "echo" || result.Routes[1].CredentialRef != "" {
		t.Fatalf("inserted route has unexpected protected fields: %s", updated)
	}
	if len(result.Routes[1].API.Responses) != 1 || result.Routes[1].API.Responses[0].Schema["type"] != "object" {
		t.Fatalf("JSON document envelope leaked into canonical settings: %s", updated)
	}
}

func TestSnapshotDigestRejectsStaleWritesAndDraftsRemainSchemaSafe(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server.json", `{"type":"object","required":["host","port"],"additionalProperties":false,"properties":{"host":{"type":"string"},"port":{"type":"integer","minimum":1,"maximum":65535},"token":{"type":"string","x-sensitive":true}}}`)
	write("services/server/settings.json", `{"host":"127.0.0.1","port":19080,"token":"private"}`)
	store := Store{Files: files}
	snapshot, err := store.Snapshot(context.Background(), root, "services/server/settings.json", "schemas/server.json")
	if err != nil || strings.Contains(snapshot.ValuesJSON, "private") || !strings.HasPrefix(snapshot.Digest, "sha256:") {
		t.Fatalf("unsafe or invalid snapshot: %+v err=%v", snapshot, err)
	}
	if validateErr := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/server.json", []byte(`{"port":0}`)); validateErr != nil {
		t.Fatalf("incomplete schema-safe draft should be persistable: %v", validateErr)
	}
	if validateErr := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/server.json", []byte(`{"token":"leak"}`)); !errors.Is(validateErr, ErrSensitiveField) {
		t.Fatalf("secret draft was accepted: %v", validateErr)
	}
	write("services/server/settings.json", `{"host":"0.0.0.0","port":19080,"token":"private"}`)
	if updateErr := store.UpdateIfDigest(context.Background(), root, "services/server/settings.json", "schemas/server.json", snapshot.Digest, []byte(`{"port":19100}`)); !errors.Is(updateErr, ErrSettingsConflict) {
		t.Fatalf("stale update was not rejected: %v", updateErr)
	}
	current, err := store.Snapshot(context.Background(), root, "services/server/settings.json", "schemas/server.json")
	if err != nil || !strings.Contains(current.ValuesJSON, "0.0.0.0") || strings.Contains(current.ValuesJSON, "private") {
		t.Fatalf("stale write changed the project or exposed a secret: %+v err=%v", current, err)
	}
	if updateErr := store.UpdateIfDigest(context.Background(), root, "services/server/settings.json", "schemas/server.json", current.Digest, []byte(`{"port":19100}`)); updateErr != nil {
		t.Fatalf("current digest should permit the write: %v", updateErr)
	}
}

func TestOpaqueSecretReferenceIsVisibleAndWritableButPlaintextIsRejected(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schema.json", `{"type":"object","additionalProperties":false,"properties":{"secretRef":{"type":"string","pattern":"^ssr:v1:[a-f0-9]{32}$","x-liapoldus-secret-reference":true,"x-studio-secret-purpose":"server.http.auth.credential"}}}`)
	const reference = "ssr:v1:00112233445566778899aabbccddeeff"
	write("settings.json", `{"secretRef":"`+reference+`"}`)
	store := Store{Files: files}
	snapshot, err := store.Snapshot(context.Background(), root, "settings.json", "schema.json")
	if err != nil || !strings.Contains(snapshot.ValuesJSON, reference) {
		t.Fatalf("opaque reference should remain available as safe metadata: %s err=%v", snapshot.ValuesJSON, err)
	}
	if err := store.ValidatePatch(context.Background(), root, "settings.json", "schema.json", []byte(`{"secretRef":"`+reference+`"}`)); err != nil {
		t.Fatalf("declared opaque reference was rejected: %v", err)
	}
	if err := store.Update(context.Background(), root, "settings.json", "schema.json", []byte(`{"secretRef":"`+reference+`"}`)); err != nil {
		t.Fatalf("declared opaque reference could not be persisted: %v", err)
	}
	if err := store.ValidatePatch(context.Background(), root, "settings.json", "schema.json", []byte(`{"secretRef":"plaintext-must-not-be-stored"}`)); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("plaintext secret value was not rejected: %v", err)
	}
	if err := store.ValidatePatch(context.Background(), root, "settings.json", "schema.json", []byte(`{"secretRef":"ssr:v1:00112233445566778899aabbccddeefg"}`)); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("malformed reference was not rejected: %v", err)
	}
}

func TestOpaqueSecretReferenceCanBePatchedThroughConditionalProtectedArray(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("settings.json", `{"config":{"routes":[]}}`)
	write("schema.json", `{
	  "$defs": {
	    "auth": {
	      "type": "object",
	      "properties": {
	        "mode": {"type": "string"},
	        "scheme": {"type": "string"},
	        "secretRef": {
	          "type": "string",
	          "pattern": "^ssr:v1:[a-f0-9]{32}$",
	          "x-liapoldus-secret-reference": true,
	          "x-studio-secret-purpose": "server.http.auth.credential"
	        }
	      },
	      "allOf": [{
	        "if": {"properties": {"mode": {"const": "enabled"}}},
	        "then": {"required": ["scheme", "secretRef"]}
	      }]
	    },
	    "route": {
	      "type": "object",
	      "properties": {
	        "id": {"type": "string"},
	        "features": {"type": "object", "properties": {"auth": {"$ref": "#/$defs/auth"}}}
	      }
	    }
	  },
	  "type": "object",
	  "properties": {
	    "config": {
	      "type": "object",
	      "properties": {"routes": {"type": "array", "items": {"$ref": "#/$defs/route"}}}
	    }
	  }
	}`)
	store := Store{Files: files}
	const reference = "ssr:v1:00112233445566778899aabbccddeeff"
	patch := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[` +
		`{"op":"insert","index":0,"value":{"id":"test-route","features":{"auth":{"mode":"enabled"}}}},` +
		`{"op":"set","index":0,"patch":{"features":{"auth":{"secretRef":"` + reference + `"}}}}]}}}`)
	if err := store.ValidatePatch(context.Background(), root, "settings.json", "schema.json", patch); err != nil {
		t.Fatalf("declared opaque reference should survive conditional validation in a protected array: %v", err)
	}
	if err := store.ValidatePatch(context.Background(), root, "settings.json", "schema.json", []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":0,"value":{"id":"test-route","features":{"auth":{"mode":"enabled","secretRef":"plaintext"}}}}]}}}`)); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("plaintext secret in a protected-array insert should be rejected, got %v", err)
	}
}

func TestOpaqueSecretReferenceSurvivesRefsInProtectedRouteArrayUnion(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("settings.json", `{"config":{"routes":[]}}`)
	write("schema.json", `{
	  "$defs": {
	    "secretReference": {
	      "type": "string",
	      "pattern": "^ssr:v1:[a-f0-9]{32}$",
	      "x-liapoldus-secret-reference": true,
	      "x-studio-secret-purpose": "server.http.auth.credential"
	    },
	    "authEnabled": {
	      "type": "object",
	      "additionalProperties": false,
	      "properties": {
	        "mode": {"const": "enabled", "type": "string"},
	        "scheme": {"const": "bearer", "type": "string"},
	        "secretRef": {"oneOf": [{"$ref": "#/$defs/secretReference"}]}
	      },
	      "required": ["mode", "scheme", "secretRef"]
	    },
	    "authDisabled": {
	      "type": "object",
	      "additionalProperties": false,
	      "properties": {"mode": {"const": "disabled", "type": "string"}},
	      "required": ["mode"]
	    },
	    "auth": {"oneOf": [{"$ref": "#/$defs/authDisabled"}, {"$ref": "#/$defs/authEnabled"}]},
	    "routeFeatures": {
	      "type": "object",
	      "additionalProperties": false,
	      "properties": {"auth": {"$ref": "#/$defs/auth"}}
	    },
	    "route": {
	      "type": "object",
	      "additionalProperties": false,
	      "properties": {
	        "id": {"type": "string"},
	        "features": {"$ref": "#/$defs/routeFeatures"},
	        "handler": {"oneOf": [
	          {"type": "object", "additionalProperties": false, "properties": {"type": {"const": "service"}, "instanceId": {"type": "string"}}},
	          {"type": "object", "additionalProperties": false, "properties": {"type": {"const": "static"}, "siteId": {"type": "string"}}}
	        ]}
	      }
	    }
	  },
	  "type": "object",
	  "properties": {"config": {"type": "object", "properties": {"routes": {"type": "array", "items": {"$ref": "#/$defs/route"}}}}}
	}`)
	store := Store{Files: files}
	const reference = "ssr:v1:00112233445566778899aabbccddeeff"
	patch := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[` +
		`{"op":"insert","index":0,"value":{"id":"test-route","handler":{"type":"service","instanceId":"echo"},"features":{"auth":{"mode":"enabled","scheme":"bearer"}}}},` +
		`{"op":"set","index":0,"patch":{"features":{"auth":{"mode":"enabled","scheme":"bearer","secretRef":"` + reference + `"}}}}]}}}`)
	if err := store.ValidatePatch(context.Background(), root, "settings.json", "schema.json", patch); err != nil {
		t.Fatalf("declared opaque reference should survive $ref/oneOf validation in a protected route array: %v", err)
	}
	snapshot, err := store.Snapshot(context.Background(), root, "settings.json", "schema.json")
	if err != nil {
		t.Fatal(err)
	}
	err = store.UpdateProjectCandidateIfDigest(context.Background(), root, "settings.json", "schema.json", snapshot.Digest, patch)
	if err != nil {
		t.Fatalf("declared opaque reference should survive mergeSafe in a protected route array: %v", err)
	}
	saved, err := files.ReadFile(context.Background(), root, "settings.json")
	if err != nil || !strings.Contains(string(saved), reference) {
		t.Fatalf("schema-approved opaque reference was not persisted in the candidate: %s err=%v", saved, err)
	}
	unsafe := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"set","index":0,"patch":{"features":{"auth":{"mode":"enabled","scheme":"bearer","secretRef":"plaintext"}}}}]}}}`)
	if err := store.ValidatePatch(context.Background(), root, "settings.json", "schema.json", unsafe); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("plaintext secret in a protected-array union should be rejected, got %v", err)
	}
}

func TestSecretReferenceCompositionRequiresTrustedAlternativeSchemas(t *testing.T) {
	var secure map[string]any
	if err := json.Unmarshal([]byte(`{"type":"string","pattern":"^ssr:v1:[a-f0-9]{32}$","x-liapoldus-secret-reference":true,"x-studio-secret-purpose":"server.http.auth"}`), &secure); err != nil {
		t.Fatal(err)
	}
	if !validSecretReferenceSchema(map[string]any{"oneOf": []any{secure}}, "secretRef") {
		t.Fatal("a oneOf wrapper around an explicitly declared opaque reference should remain trusted")
	}
	if !validSecretReferenceSchema(map[string]any{"allOf": []any{secure, map[string]any{"minLength": float64(39)}}}, "secretRef") {
		t.Fatal("allOf constraints should preserve an explicitly declared opaque reference")
	}
	if validSecretReferenceSchema(map[string]any{"oneOf": []any{secure, map[string]any{"type": "string"}}}, "secretRef") {
		t.Fatal("an unmarked alternative must not inherit the opaque-reference trust annotation")
	}
}

func TestSnapshotConfigurationDigestMatchesCLIEncodingWithoutExposingSecrets(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	raw := []byte("{\n  \"token\": \"private<&>\", \"port\": 8080\n}\n")
	if err := files.WriteFile(context.Background(), root, "settings.json", raw); err != nil {
		t.Fatal(err)
	}
	if err := files.WriteFile(context.Background(), root, "schema.json", []byte(`{"type":"object","properties":{"token":{"type":"string","x-sensitive":true},"port":{"type":"integer"}}}`)); err != nil {
		t.Fatal(err)
	}
	snapshot, err := (Store{Files: files}).Snapshot(context.Background(), root, "settings.json", "schema.json")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(json.RawMessage(raw))
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("sha256:%x", sha256.Sum256(encoded))
	if snapshot.ConfigurationDigest != want || snapshot.Digest == want || strings.Contains(snapshot.ValuesJSON, "private") {
		t.Fatalf("invalid configuration digest or secret disclosure: %+v", snapshot)
	}
}

func TestConcurrentDigestUpdatesAllowOnlyOneStudioWriter(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/settings.json", `{"type":"object","required":["value"],"properties":{"value":{"type":"integer"}}}`)
	write("services/demo/settings.json", `{"value":0}`)
	store := Store{Files: files}
	snapshot, err := store.Snapshot(context.Background(), root, "services/demo/settings.json", "schemas/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, value := range []int{1, 2} {
		go func(value int) {
			<-start
			results <- store.UpdateIfDigest(context.Background(), root, "services/demo/settings.json", "schemas/settings.json", snapshot.Digest, []byte(fmt.Sprintf(`{"value":%d}`, value)))
		}(value)
	}
	close(start)
	var succeeded, conflicted int
	for range 2 {
		switch result := <-results; {
		case result == nil:
			succeeded++
		case errors.Is(result, ErrSettingsConflict):
			conflicted++
		default:
			t.Fatalf("unexpected concurrent save result: %v", result)
		}
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("expected one successful update and one conflict, got success=%d conflict=%d", succeeded, conflicted)
	}
	updated, err := store.Snapshot(context.Background(), root, "services/demo/settings.json", "schemas/settings.json")
	if err != nil || (updated.ValuesJSON != "{\n  \"value\": 1\n}" && updated.ValuesJSON != "{\n  \"value\": 2\n}") {
		t.Fatalf("unexpected final settings snapshot: %+v err=%v", updated, err)
	}
}

func TestDraftSafetyChecksSensitiveAndReadOnlyFieldsInsideArrays(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/items.json", `{"type":"object","properties":{"routes":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"token":{"type":"string","x-sensitive":true},"generated":{"type":"string","readOnly":true}}}}}}`)
	write("services/server/settings.json", `{"routes":[{"path":"/old","token":"stored-secret","generated":"managed-value"}]}`)
	store := Store{Files: files}
	for _, patch := range []string{
		`{"routes":{"0":{"token":"must-not-persist"}}}`,
		`{"routes":{"0":{"generated":"host-owned"}}}`,
		`{"routes":[{"path":"/echo"}]}`,
	} {
		if validateErr := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/items.json", []byte(patch)); validateErr == nil {
			t.Fatalf("unsafe array patch was accepted: %s", patch)
		}
	}
	sparsePatch := []byte(`{"routes":{"0":{"path":"/echo"}}}`)
	if validateErr := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/items.json", sparsePatch); validateErr != nil {
		t.Fatalf("safe sparse array patch was rejected: %v", validateErr)
	}
	if updateErr := store.Update(context.Background(), root, "services/server/settings.json", "schemas/items.json", sparsePatch); updateErr != nil {
		t.Fatalf("safe sparse array update failed: %v", updateErr)
	}
	updated, err := os.ReadFile(filepath.Join(root, "services/server/settings.json")) //nolint:gosec // root is a test-owned temporary directory.
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string][]map[string]string
	if err := json.Unmarshal(updated, &settings); err != nil {
		t.Fatal(err)
	}
	if len(settings["routes"]) != 1 || settings["routes"][0]["path"] != "/echo" || settings["routes"][0]["token"] != "stored-secret" || settings["routes"][0]["generated"] != "managed-value" {
		t.Fatalf("sparse edit did not preserve protected fields: %s", updated)
	}
	for _, invalid := range []string{
		`{"routes":{"00":{"path":"/bad"}}}`,
		`{"routes":{"-1":{"path":"/bad"}}}`,
		`{"routes":{"1":{"path":"/out-of-range"}}}`,
	} {
		if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/items.json", []byte(invalid)); err == nil {
			t.Fatalf("invalid sparse array index was accepted: %s", invalid)
		}
	}
}

func TestDraftSafetyChecksSensitiveFieldsInsideArrayUnionBranches(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/listeners.json", `{"type":"object","properties":{"listeners":{"type":"array","items":{"oneOf":[{"type":"object","additionalProperties":false,"required":["mode","address"],"properties":{"mode":{"const":"http"},"address":{"type":"string"}}},{"type":"object","additionalProperties":false,"required":["mode","credentialMaterial"],"properties":{"mode":{"const":"tls"},"credentialMaterial":{"type":"string","x-sensitive":true}}}]}}}}`)
	write("services/server/settings.json", `{"listeners":[{"mode":"http","address":":8080"}]}`)
	store := Store{Files: files}

	safePatch := []byte(`{"listeners":{"0":{"address":":9090"}}}`)
	if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/listeners.json", safePatch); err != nil {
		t.Fatalf("safe union branch patch was rejected: %v", err)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/listeners.json", safePatch); err != nil {
		t.Fatalf("safe union branch update failed: %v", err)
	}
	secretPatch := []byte(`{"listeners":{"0":{"mode":"tls","credentialMaterial":"must-not-persist"}}}`)
	if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/listeners.json", secretPatch); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("expected secret in union branch to be rejected, got %v", err)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/listeners.json", secretPatch); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("expected persisted secret in union branch to be rejected, got %v", err)
	}
	settings, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil || !strings.Contains(string(settings), `"address": ":9090"`) || strings.Contains(string(settings), "must-not-persist") {
		t.Fatalf("rejected union-branch secret changed project settings: %s err=%v", settings, err)
	}
}

func TestSnapshotRedactsSensitiveSettingsFromUnionBranches(t *testing.T) {
	for _, keyword := range []string{"allOf", "anyOf", "oneOf"} {
		root := t.TempDir()
		files := projectfiles.FileSystem{}
		write := func(path, content string) {
			t.Helper()
			if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
				t.Fatal(err)
			}
		}
		schema := `{"type":"object","properties":{"listeners":{"type":"array","items":{"oneOf":[{"type":"object","properties":{"mode":{"const":"http"},"address":{"type":"string"}}},{"type":"object","properties":{"mode":{"const":"tls"},"address":{"type":"string"},"credentialMaterial":{"type":"string","x-sensitive":true}}}]}}}}`
		schema = strings.Replace(schema, `"oneOf"`, `"`+keyword+`"`, 1)
		write("schemas/listeners.json", schema)
		write("services/server/settings.json", `{"listeners":[{"mode":"tls","address":":8443","credentialMaterial":"must-never-reach-renderer"}]}`)

		snapshot, err := (Store{Files: files}).Snapshot(context.Background(), root, "services/server/settings.json", "schemas/listeners.json")
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(snapshot.ValuesJSON, "must-never-reach-renderer") {
			t.Fatalf("sensitive field declared in a %s branch escaped redaction: %s", keyword, snapshot.ValuesJSON)
		}
		var decoded map[string]any
		if err := json.Unmarshal([]byte(snapshot.ValuesJSON), &decoded); err != nil {
			t.Fatal(err)
		}
		listeners, ok := decoded["listeners"].([]any)
		if !ok || len(listeners) != 1 {
			t.Fatalf("unexpected listener snapshot shape: %s", snapshot.ValuesJSON)
		}
		listener, ok := listeners[0].(map[string]any)
		if !ok {
			t.Fatalf("unexpected listener item shape: %s", snapshot.ValuesJSON)
		}
		if value, exists := listener["credentialMaterial"]; exists && value != nil {
			t.Fatalf("redacted union-branch field must not have a value in the renderer snapshot: %s", snapshot.ValuesJSON)
		}
		if listener["address"] != ":8443" {
			t.Fatalf("redaction removed a safe sibling field: %s", snapshot.ValuesJSON)
		}
	}
}

func TestWriteOnlyAndPasswordFormatFieldsAreRedactedAndNotWritable(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/settings.json", `{"type":"object","properties":{"credentialValue":{"type":"string","format":"password"},"writeOnlyValue":{"type":"string","writeOnly":true}}}`)
	write("services/server/settings.json", `{"credentialValue":"password-value-must-not-escape","writeOnlyValue":"private-value-must-not-escape"}`)
	store := Store{Files: files}

	snapshot, err := store.Snapshot(context.Background(), root, "services/server/settings.json", "schemas/settings.json")
	if err != nil || strings.Contains(snapshot.ValuesJSON, "password-value-must-not-escape") || strings.Contains(snapshot.ValuesJSON, "private-value-must-not-escape") {
		t.Fatalf("snapshot exposed write-only data: %s err=%v", snapshot.ValuesJSON, err)
	}
	for _, patch := range []string{`{"credentialValue":"new-secret"}`, `{"writeOnlyValue":"new-secret"}`} {
		if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/settings.json", []byte(patch)); !errors.Is(err, ErrSensitiveField) {
			t.Fatalf("protected schema field accepted patch %s: %v", patch, err)
		}
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

func TestStoreIndexesVersionedSchemaIDsWithoutNetworkResolution(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/shared.json", `{"$id":"https://liapoldus.example/schemas/shared/v1.json","$schema":"https://json-schema.org/draft/2020-12/schema","$defs":{"port":{"type":"integer","minimum":1,"maximum":65535}}}`)
	write("schemas/runtime/settings.json", `{"$id":"https://liapoldus.example/schemas/runtime/v1/settings.json","$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"a":{"$ref":"../shared.json#/$defs/port"},"b":{"$ref":"https://liapoldus.example/schemas/shared/v1.json#/$defs/port"}}}`)
	write("services/runtime/settings.json", `{"a":8080,"b":8081}`)
	store := Store{Files: files}
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"a":443,"b":8443}`)); err != nil {
		t.Fatalf("versioned local schema IDs should resolve without network: %v", err)
	}
	write("schemas/runtime/unregistered.json", `{"type":"object","properties":{"port":{"$ref":"https://untrusted.example/schema.json#/port"}}}`)
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/unregistered.json", []byte(`{"port":443}`)); err == nil {
		t.Fatal("expected unregistered external $ref to fail closed")
	}
}

func TestStoreSupportsAdvancedObjectArrayAndNumericConstraints(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/runtime/settings.json", `{"type":"object","additionalProperties":{"type":"string"},"propertyNames":{"type":"string","pattern":"^[a-z][a-z-]*$"},"dependentRequired":{"mode":["profile"]},"properties":{"mode":{"type":"string"},"profile":{"type":"string"},"rate":{"type":"number","exclusiveMinimum":0.5,"multipleOf":0.5},"labels":{"type":"array","minItems":1,"maxItems":2,"uniqueItems":true,"items":{"type":"string"}},"metadata":{"type":"object","additionalProperties":false,"patternProperties":{"^x-":{"type":"integer"}}},"secret-bag":{"type":"object","additionalProperties":{"type":"string","x-sensitive":true}}}}`)
	write("services/runtime/settings.json", `{"mode":"local","profile":"dev","rate":1,"labels":["api"],"metadata":{"x-port":8080},"secret-bag":{"api-key":"hidden"},"extra":"allowed"}`)
	store := Store{Files: files}
	redacted, err := store.Read(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json")
	if err != nil || strings.Contains(string(redacted), "hidden") {
		t.Fatalf("schema-driven additional property was not redacted: %s (%v)", redacted, err)
	}

	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"rate":1.5,"labels":["api","worker"],"metadata":{"x-timeout":30}}`)); err != nil {
		t.Fatalf("advanced constraints should allow valid updates: %v", err)
	}
	invalid := []struct {
		name  string
		patch string
	}{
		{name: "duplicate array items", patch: `{"labels":["api","api"]}`},
		{name: "exclusive minimum", patch: `{"rate":0.5}`},
		{name: "multiple of", patch: `{"rate":1.25}`},
		{name: "pattern property type", patch: `{"metadata":{"x-port":"8080"}}`},
		{name: "property name", patch: `{"BadName":"value"}`},
		{name: "dependent required", patch: `{"mode":"local","profile":null}`},
	}
	for _, test := range invalid {
		t.Run(test.name, func(t *testing.T) {
			if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(test.patch)); err == nil {
				t.Fatalf("expected advanced constraint to reject %s", test.patch)
			}
		})
	}
	write("services/runtime/settings.json", `{"mode":"local","rate":1,"labels":["api"],"metadata":{"x-port":8080}}`)
	if err := store.Update(context.Background(), root, "services/runtime/settings.json", "schemas/runtime/settings.json", []byte(`{"mode":"remote"}`)); err == nil {
		t.Fatal("expected dependentRequired to reject mode without profile")
	}
}

func TestTypedMapOperationsRemoveDynamicKeysWithoutReplacingTheMap(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/settings.json", `{"type":"object","properties":{"labels":{"type":"object","minProperties":2,"maxProperties":4,"properties":{"fixed":{"type":"string"}},"additionalProperties":{"type":"string"}}}}`)
	write("services/server/settings.json", `{"labels":{"fixed":"built-in","east":"one","west":"two"}}`)
	store := Store{Files: files}
	patch := []byte(`{"labels":{"$studioMapOps/v1":[{"op":"remove","key":"east"}],"west":"updated"}}`)
	if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/settings.json", patch); err != nil {
		t.Fatalf("safe typed-map draft was rejected: %v", err)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/settings.json", patch); err != nil {
		t.Fatalf("safe typed-map update failed: %v", err)
	}
	updated, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]map[string]string
	if err := json.Unmarshal(updated, &settings); err != nil {
		t.Fatal(err)
	}
	if len(settings["labels"]) != 2 || settings["labels"]["fixed"] != "built-in" || settings["labels"]["west"] != "updated" {
		t.Fatalf("map remove/update did not preserve the canonical map: %s", updated)
	}
}

func TestTypedMapOperationsFailClosedForInvalidOrUnsafeRequests(t *testing.T) {
	tests := []struct {
		name   string
		schema string
		data   string
		patch  string
	}{
		{name: "missing key", schema: `{"type":"object","additionalProperties":{"type":"string"}}`, data: `{}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"missing"}]}`},
		{name: "secret key", schema: `{"type":"object","additionalProperties":{"type":"string"}}`, data: `{"apiToken":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"apiToken"}]}`},
		{name: "prototype key", schema: `{"type":"object","additionalProperties":{"type":"string"}}`, data: `{"__proto__":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"__proto__"}]}`},
		{name: "reserved operation key", schema: `{"type":"object","additionalProperties":{"type":"string"}}`, data: `{"$studioMapOps/v1":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"$studioMapOps/v1"}]}`},
		{name: "declared key", schema: `{"type":"object","properties":{"fixed":{"type":"string"}},"additionalProperties":{"type":"string"}}`, data: `{"fixed":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"fixed"}]}`},
		{name: "duplicate operations", schema: `{"type":"object","additionalProperties":{"type":"string"}}`, data: `{"a":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"a"},{"op":"remove","key":"a"}]}`},
		{name: "malformed operation", schema: `{"type":"object","additionalProperties":{"type":"string"}}`, data: `{"a":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"a","extra":true}]}`},
		{name: "remove and edit same key", schema: `{"type":"object","additionalProperties":{"type":"string"}}`, data: `{"a":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"a"}],"a":"y"}`},
		{name: "untyped map", schema: `{"type":"object","additionalProperties":true}`, data: `{"a":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"a"}]}`},
		{name: "pattern map", schema: `{"type":"object","patternProperties":{"^x-":{"type":"string"}},"additionalProperties":{"type":"string"}}`, data: `{"x-a":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"x-a"}]}`},
		{name: "name-constrained map", schema: `{"type":"object","propertyNames":{"pattern":"^[a-z]+$"},"additionalProperties":{"type":"string"}}`, data: `{"a":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"a"}]}`},
		{name: "protected values", schema: `{"type":"object","additionalProperties":{"type":"string","writeOnly":true}}`, data: `{"a":"x"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"a"}]}`},
		{name: "minimum property count", schema: `{"type":"object","minProperties":2,"additionalProperties":{"type":"string"}}`, data: `{"a":"x","b":"y"}`, patch: `{"$studioMapOps/v1":[{"op":"remove","key":"a"}]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			files := projectfiles.FileSystem{}
			for path, content := range map[string]string{"schemas/settings.json": test.schema, "services/server/settings.json": test.data} {
				if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
					t.Fatal(err)
				}
			}
			store := Store{Files: files}
			if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/settings.json", []byte(test.patch)); err == nil {
				t.Fatalf("unsafe map operation was accepted: %s", test.patch)
			}
			actual, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
			if err != nil || string(actual) != test.data {
				t.Fatalf("rejected map operation changed the file: %s err=%v", actual, err)
			}
		})
	}
}

func TestTypedMapOperationDecoderBoundsBatchSize(t *testing.T) {
	operations := make([]any, 1025)
	for index := range operations {
		operations[index] = map[string]any{"op": "remove", "key": fmt.Sprintf("key-%d", index)}
	}
	_, err := decodeConfigurationMapOperations(
		map[string]any{configurationMapOperationsKey: operations},
		map[string]any{"type": "object", "additionalProperties": map[string]any{"type": "string"}},
	)
	if err == nil {
		t.Fatal("oversized map operation batch was accepted")
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

func TestProtectedArrayOperationsPreserveHiddenValues(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server.json", `{"type":"object","properties":{"listeners":{"type":"array","minItems":1,"maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["id","address","credentialRef","managedId"],"properties":{"id":{"type":"string"},"address":{"type":"string"},"credentialRef":{"type":"string","x-sensitive":true},"managedId":{"type":"string","readOnly":true}}}}}}`)
	write("services/server/settings.json", `{"listeners":[{"id":"plain","address":":8080","credentialRef":"secret-a","managedId":"core-a"},{"id":"tls","address":":8443","credentialRef":"secret-b","managedId":"core-b"}]}`)
	store := Store{Files: files}
	patch := []byte(`{"listeners":{"$studioArrayOps/v1":[{"op":"move","from":0,"to":1},{"op":"set","index":0,"patch":{"address":":9443"}},{"op":"duplicate","index":0,"to":1},{"op":"remove","index":2}]}}`)
	if strings.Contains(string(patch), "secret-a") || strings.Contains(string(patch), "secret-b") || strings.Contains(string(patch), "core-a") || strings.Contains(string(patch), "core-b") {
		t.Fatalf("array operations contain hidden source data: %s", patch)
	}
	if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/server.json", patch); err != nil {
		t.Fatalf("safe protected array operations were rejected: %v", err)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server.json", patch); err != nil {
		t.Fatalf("safe protected array operations failed: %v", err)
	}
	updated, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Listeners []map[string]string `json:"listeners"`
	}
	if err := json.Unmarshal(updated, &settings); err != nil {
		t.Fatal(err)
	}
	if len(settings.Listeners) != 2 {
		t.Fatalf("unexpected operation result: %s", updated)
	}
	for _, listener := range settings.Listeners {
		if listener["id"] != "tls" || listener["credentialRef"] != "secret-b" || listener["managedId"] != "core-b" || listener["address"] != ":9443" {
			t.Fatalf("duplicate/reorder did not preserve hidden canonical values: %s", updated)
		}
	}

	tooManyOperations := strings.TrimSuffix(strings.Repeat(`{"op":"move","from":0,"to":0},`, 1025), ",")
	for _, invalid := range []string{
		`{"listeners":{"$studioArrayOps/v1":[{"op":"remove","index":0},{"op":"remove","index":0}]}}`,
		`{"listeners":{"$studioArrayOps/v1":[{"op":"set","index":0,"patch":{"credentialRef":"injected"}}]}}`,
		`{"listeners":{"$studioArrayOps/v1":[{"op":"add","index":0,"value":{"credentialRef":"injected"}}]}}`,
		`{"listeners":{"$studioArrayOps/v1":[{"op":"move","from":0,"to":99}]}}`,
		`{"listeners":{"$studioArrayOps/v1":[{"op":"move","from":0,"to":1,"unexpected":true}]}}`,
		`{"listeners":{"$studioArrayOps/v1":[{"op":"duplicate","index":0,"to":1},{"op":"duplicate","index":0,"to":1}]}}`,
		`{"listeners":{"$studioArrayOps/v1":[{"op":"remove","index":0}],"0":{"address":":9999"}}}`,
		`{"listeners":{"$studioArrayOps/v1":[` + tooManyOperations + `]}}`,
	} {
		before, readErr := files.ReadFile(context.Background(), root, "services/server/settings.json")
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server.json", []byte(invalid)); err == nil {
			t.Fatalf("invalid protected array operation was accepted: %s", invalid)
		}
		after, readErr := files.ReadFile(context.Background(), root, "services/server/settings.json")
		if readErr != nil || string(after) != string(before) {
			t.Fatalf("rejected array operation changed canonical settings: before=%s after=%s err=%v", before, after, readErr)
		}
	}
}

func TestProtectedArrayInsertAddsSchemaValidatedServiceRoute(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server.json", `{"type":"object","properties":{"config":{"type":"object","additionalProperties":false,"properties":{"routes":{"type":"array","maxItems":2,"items":{"type":"object","additionalProperties":false,"required":["id","path","queryParameters"],"properties":{"id":{"type":"string","minLength":1},"path":{"type":"string","minLength":1},"queryParameters":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["name","required"],"properties":{"name":{"type":"string"},"required":{"type":"boolean"}}}}}}}}}}}`)
	write("services/server/settings.json", `{"config":{"routes":[]}}`)
	store := Store{Files: files}
	partial := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":0,"value":{"id":"","path":"","queryParameters":[]}}]}}}`)
	if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/server.json", partial); err != nil {
		t.Fatalf("safe incomplete row should remain in the editable draft: %v", err)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server.json", partial); err == nil {
		t.Fatal("incomplete row must not be written to canonical Project settings")
	}
	unchanged, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil || string(unchanged) != `{"config":{"routes":[]}}` {
		t.Fatalf("rejected incomplete row changed Project settings: %s, err=%v", unchanged, err)
	}
	patch := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":0,"value":{"id":"echo-route","path":"/echo","queryParameters":[{"name":"text","required":true}]}}]}}}`)
	if err = store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/server.json", patch); err != nil {
		t.Fatalf("safe schema-valid insert was rejected: %v", err)
	}
	if err = store.Update(context.Background(), root, "services/server/settings.json", "schemas/server.json", patch); err != nil {
		t.Fatalf("safe schema-valid insert failed: %v", err)
	}
	updated, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Config struct {
			Routes []struct {
				ID              string `json:"id"`
				Path            string `json:"path"`
				QueryParameters []struct {
					Name     string `json:"name"`
					Required bool   `json:"required"`
				} `json:"queryParameters"`
			} `json:"routes"`
		} `json:"config"`
	}
	if err := json.Unmarshal(updated, &settings); err != nil {
		t.Fatal(err)
	}
	if len(settings.Config.Routes) != 1 || settings.Config.Routes[0].ID != "echo-route" || settings.Config.Routes[0].Path != "/echo" ||
		len(settings.Config.Routes[0].QueryParameters) != 1 || settings.Config.Routes[0].QueryParameters[0].Name != "text" || !settings.Config.Routes[0].QueryParameters[0].Required {
		t.Fatalf("inserted service route was not preserved: %s", updated)
	}
	for _, invalid := range []string{
		`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":0,"value":{"id":"invalid","path":"/echo"}}]}}}`,
		`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":2,"value":{"id":"invalid","path":"/echo","queryParameters":[]}}]}}}`,
		`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":0,"value":{"id":"invalid","path":"/echo","queryParameters":[],"secret":"nope"}}]}}}`,
	} {
		before, readErr := files.ReadFile(context.Background(), root, "services/server/settings.json")
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server.json", []byte(invalid)); err == nil {
			t.Fatalf("invalid insert was accepted: %s", invalid)
		}
		after, readErr := files.ReadFile(context.Background(), root, "services/server/settings.json")
		if readErr != nil || string(after) != string(before) {
			t.Fatalf("rejected insert changed canonical settings: before=%s after=%s err=%v", before, after, readErr)
		}
	}
}

func TestUpdateProjectCandidateIfDigestPersistsSafeIncompleteRoute(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server.json", `{"type":"object","properties":{"config":{"type":"object","additionalProperties":false,"properties":{"routes":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["id","listenerId","handler"],"properties":{"id":{"type":"string","minLength":1},"listenerId":{"type":"string","minLength":1},"handler":{"type":"object","additionalProperties":false,"required":["type","instanceId","capability"],"properties":{"type":{"const":"service"},"instanceId":{"type":"string","minLength":1},"capability":{"type":"string","minLength":1}}}}}}}}}}`)
	write("services/server/settings.json", `{"config":{"routes":[]}}`)
	store := Store{Files: files}
	snapshot, err := store.Snapshot(context.Background(), root, "services/server/settings.json", "schemas/server.json")
	if err != nil {
		t.Fatal(err)
	}
	patch := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":0,"value":{"id":"route-home","listenerId":"web","handler":{"type":"service","instanceId":"","capability":""}}}]}}}`)
	strictErr := store.UpdateIfDigest(context.Background(), root, "services/server/settings.json", "schemas/server.json", snapshot.Digest, patch)
	if strictErr == nil {
		t.Fatal("strict project settings write unexpectedly accepted an incomplete route")
	}
	candidateErr := store.UpdateProjectCandidateIfDigest(context.Background(), root, "services/server/settings.json", "schemas/server.json", snapshot.Digest, patch)
	if candidateErr != nil {
		t.Fatalf("safe incomplete candidate could not be saved to Project: %v", candidateErr)
	}
	saved, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil || !json.Valid(saved) || !strings.Contains(string(saved), `"instanceId": ""`) {
		t.Fatalf("incomplete candidate was not retained as valid JSON: %s, err=%v", saved, err)
	}
	snapshot, err = store.Snapshot(context.Background(), root, "services/server/settings.json", "schemas/server.json")
	if err != nil {
		t.Fatal(err)
	}
	invalidPatch := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":1,"value":{"id":"secret-route","listenerId":"web","handler":{"type":"service","instanceId":"","capability":""},"privateKey":"secret"}}]}}}`)
	if err := store.UpdateProjectCandidateIfDigest(context.Background(), root, "services/server/settings.json", "schemas/server.json", snapshot.Digest, invalidPatch); err == nil {
		t.Fatalf("undeclared candidate field was accepted: %v", err)
	}
}

func TestProtectedArrayInsertAcceptsTaggedServiceRouteVariant(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/server.json", `{
		"type":"object",
		"properties":{"config":{"type":"object","properties":{"routes":{"type":"array","items":{
			"type":"object","additionalProperties":false,"required":["id","handler","api"],
			"properties":{
				"id":{"type":"string"},
				"handler":{"oneOf":[
					{"type":"object","additionalProperties":false,"required":["type","siteId"],"properties":{"type":{"const":"static"},"siteId":{"type":"string"}}},
					{"type":"object","additionalProperties":false,"required":["type","upstreams"],"properties":{"type":{"const":"reverseProxy"},"upstreams":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["origin"],"properties":{"origin":{"type":"string"},"caRef":{"type":"string","x-sensitive":true}}}}}},
					{"type":"object","additionalProperties":false,"required":["type","instanceId","capability"],"properties":{"type":{"const":"service"},"instanceId":{"type":"string"},"capability":{"type":"string"}}}
				]},
				"api":{"type":"object","additionalProperties":false,"required":["responses"],"properties":{"responses":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["schema","example"],"properties":{"schema":{"type":"object","additionalProperties":true,"x-studio-json-document":true},"example":{"x-studio-json-value":true}}}}}}
			}
		}}}}}}`)
	write("services/server/settings.json", `{"config":{"routes":[]}}`)
	store := Store{Files: files}
	patch := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"insert","index":0,"value":{"id":"echo-route","handler":{"type":"service","instanceId":"echo","capability":"echo.handle"},"api":{"responses":[{"schema":{"$studioJSONDocument/v1":{"type":"object","properties":{"message":{"type":"string"}}}},"example":{"$studioJSONDocument/v1":{"message":"ok"}}}]}}}]}}}`)
	if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/server.json", patch); err != nil {
		t.Fatalf("valid service variant was rejected by sibling union branches: %v", err)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/server.json", patch); err != nil {
		t.Fatalf("valid service variant could not be saved: %v", err)
	}
	saved, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(saved), "$studioJSONDocument/v1") || !strings.Contains(string(saved), `"message": "ok"`) {
		t.Fatalf("host JSON-document markers were not unwrapped into canonical settings: %s", saved)
	}
	unsafe := []byte(`{"config":{"routes":{"$studioArrayOps/v1":[{"op":"set","index":0,"patch":{"handler":{"upstreams":[{"origin":"https://upstream.invalid","caRef":"must-not-write"}]}}}]}}}`)
	if err := store.ValidatePatch(context.Background(), root, "services/server/settings.json", "schemas/server.json", unsafe); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("sensitive field in an inactive union branch was not rejected: %v", err)
	}
}

func TestNestedProtectedArrayOperationsPreserveAllHiddenValues(t *testing.T) {
	root := t.TempDir()
	files := projectfiles.FileSystem{}
	write := func(path, content string) {
		t.Helper()
		if err := files.WriteFile(context.Background(), root, path, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	write("schemas/groups.json", `{"type":"object","properties":{"groups":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"keyRef":{"type":"string","x-sensitive":true},"routes":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"credentialRef":{"type":"string","writeOnly":true}}}}}}}}}`)
	write("services/server/settings.json", `{"groups":[{"id":"group-a","keyRef":"outer-secret","routes":[{"path":"/a","credentialRef":"route-secret-a"},{"path":"/b","credentialRef":"route-secret-b"}]}]}`)
	store := Store{Files: files}
	patch := []byte(`{"groups":{"$studioArrayOps/v1":[{"op":"set","index":0,"patch":{"routes":{"$studioArrayOps/v1":[{"op":"move","from":0,"to":1},{"op":"set","index":0,"patch":{"path":"/ready"}}]}}}]}}`)
	if strings.Contains(string(patch), "outer-secret") || strings.Contains(string(patch), "route-secret") || strings.Contains(string(patch), "credentialRef") {
		t.Fatalf("nested operation patch contains hidden values: %s", patch)
	}
	if err := store.Update(context.Background(), root, "services/server/settings.json", "schemas/groups.json", patch); err != nil {
		t.Fatalf("nested protected operation failed: %v", err)
	}
	updated, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var settings struct {
		Groups []struct {
			ID     string `json:"id"`
			KeyRef string `json:"keyRef"`
			Routes []struct {
				Path          string `json:"path"`
				CredentialRef string `json:"credentialRef"`
			} `json:"routes"`
		} `json:"groups"`
	}
	if err = json.Unmarshal(updated, &settings); err != nil {
		t.Fatal(err)
	}
	if len(settings.Groups) != 1 || settings.Groups[0].ID != "group-a" || settings.Groups[0].KeyRef != "outer-secret" || len(settings.Groups[0].Routes) != 2 {
		t.Fatalf("outer protected values were not preserved: %s", updated)
	}
	if settings.Groups[0].Routes[0].Path != "/ready" || settings.Groups[0].Routes[0].CredentialRef != "route-secret-b" || settings.Groups[0].Routes[1].Path != "/a" || settings.Groups[0].Routes[1].CredentialRef != "route-secret-a" {
		t.Fatalf("nested protected operations did not preserve canonical values: %s", updated)
	}

	before := string(updated)
	unsafe := []byte(`{"groups":{"$studioArrayOps/v1":[{"op":"set","index":0,"patch":{"routes":{"$studioArrayOps/v1":[{"op":"set","index":0,"patch":{"credentialRef":"injected"}}]}}}]}}`)
	if err = store.Update(context.Background(), root, "services/server/settings.json", "schemas/groups.json", unsafe); !errors.Is(err, ErrSensitiveField) {
		t.Fatalf("nested sensitive field patch was accepted: %v", err)
	}
	after, err := files.ReadFile(context.Background(), root, "services/server/settings.json")
	if err != nil || string(after) != before {
		t.Fatalf("rejected nested operation mutated settings: %s err=%v", after, err)
	}
}
