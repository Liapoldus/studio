package wails

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestSafeCLIJSONRedactsCredentialsAndLocalRuntimePaths(t *testing.T) {
	input := []byte(`{"name":"local","credentialRef":"os-keyring:private-ref","caFile":"/tmp/tls/ca.pem","clientKeyFile":"/tmp/tls/client.key","coreBinary":"/tmp/core","endpoint":"https://127.0.0.1:18180","runtimeImage":"alpine:latest","nested":{"accessToken":"do-not-render"}}`)
	output, err := safeCLIJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(output, &value); err != nil {
		t.Fatal(err)
	}
	encoded := string(output)
	for _, hidden := range []string{"os-keyring:private-ref", "/tmp/tls/ca.pem", "/tmp/tls/client.key", "/tmp/core", "do-not-render"} {
		if strings.Contains(encoded, hidden) {
			t.Errorf("CLI renderer payload leaked %q: %s", hidden, encoded)
		}
	}
	if value["endpoint"] != "https://127.0.0.1:18180" || value["runtimeImage"] != "alpine:latest" {
		t.Fatalf("safe runtime metadata was unexpectedly removed: %s", encoded)
	}
}

func TestSafeCLIJSONPreservesOnlyValidDeclaredSecretPurposeMetadata(t *testing.T) {
	output, err := safeCLIJSON([]byte(`{"id":"server","secretPurposes":["http.auth.bearer"],"secretValue":"never-render"}`))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), `"secretPurposes":["http.auth.bearer"]`) || strings.Contains(string(output), "never-render") {
		t.Fatalf("public purpose metadata was hidden or secret material leaked: %s", output)
	}
	output, err = safeCLIJSON([]byte(`{"secretPurposes":["invalid purpose"]}`))
	if err != nil || !strings.Contains(string(output), `"secretPurposes":"[redacted]"`) {
		t.Fatalf("malformed purpose metadata was preserved: %s err=%v", output, err)
	}
}

func TestSafeCLIJSONPreservesNamespacedEditorButtonKeyOnly(t *testing.T) {
	input := []byte(`{"id":"server","key":"private-value","editorButtons":{"version":"service-editor-buttons/v1","buttons":[{"id":"server.endpoints","key":"endpoints","label":{"ru":"Редактор","en":"Editor"}}]},"nested":{"key":"private-value"}}`)
	for range 2 {
		output, err := safeCLIJSON(input)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(output), `"key":"endpoints"`) || strings.Contains(string(output), "private-value") {
			t.Fatalf("public button key lost or private key exposed: %s", output)
		}
		input = output
	}
}

func TestSafeCLIJSONDoesNotExemptMalformedEditorButtonKeys(t *testing.T) {
	for _, input := range []string{
		`{"id":"server","editorButtons":{"version":"unknown","buttons":[{"id":"server.endpoints","key":"endpoints"}]}}`,
		`{"id":"server","editorButtons":{"version":"service-editor-buttons/v1","buttons":[{"id":"other.endpoints","key":"endpoints"}]}}`,
	} {
		output, err := safeCLIJSON([]byte(input))
		if err != nil || strings.Contains(string(output), `"key":"endpoints"`) {
			t.Fatalf("invalid public key exemption: %s err=%v", output, err)
		}
	}
}

func TestSafeCLIJSONPreservesSchemaStructureAndRedactsSecretExamples(t *testing.T) {
	input := []byte(`{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","description":"URLs end with /ready and paths ending in /foo/bar remain literal","properties":{"privateKeyRef":{"$ref":"#/$defs/secretReference","default":"file:///private/key.pem","examples":["sensitive"]},"name":{"type":"string"}},"$defs":{"secretReference":{"type":"object","properties":{"ref":{"type":"string"}}}}}`)
	output, err := safeCLIJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(output, &value); err != nil {
		t.Fatal(err)
	}
	properties, ok := value["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema properties were not preserved as an object: %s", output)
	}
	privateKeyRef, ok := properties["privateKeyRef"].(map[string]any)
	if !ok {
		t.Fatalf("secret reference schema was not preserved as an object: %s", output)
	}
	if privateKeyRef["$ref"] != "#/$defs/secretReference" {
		t.Fatalf("secret schema structure was destroyed: %s", output)
	}
	if _, exists := privateKeyRef["default"]; exists {
		t.Fatalf("secret default was retained: %s", output)
	}
	if _, exists := privateKeyRef["examples"]; exists {
		t.Fatalf("secret examples were retained: %s", output)
	}
	if _, exists := value["$defs"]; !exists {
		t.Fatalf("schema definitions were removed: %s", output)
	}
	if value["description"] != "URLs end with /ready and paths ending in /foo/bar remain literal" {
		t.Fatalf("schema text was modified as though it were a runtime path: %s", output)
	}
}

func TestSafeCLIJSONRecognizesObjectSchemaWithoutDraftMarker(t *testing.T) {
	input := []byte(`{"type":"object","properties":{"apiToken":{"type":"string","writeOnly":true,"default":"never-render"}}}`)
	output, err := safeCLIJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	var schema map[string]any
	if json.Unmarshal(output, &schema) != nil {
		t.Fatalf("redacted schema is invalid JSON: %s", output)
	}
	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema structure was lost: %s", output)
	}
	token, ok := properties["apiToken"].(map[string]any)
	if !ok || token["type"] != "string" {
		t.Fatalf("sensitive schema was not safely preserved: %s", output)
	}
	if _, exists := token["default"]; exists {
		t.Fatalf("secret-bearing default was not removed: %s", output)
	}
	if strings.Contains(string(output), "never-render") {
		t.Fatalf("secret-bearing schema example reached the renderer: %s", output)
	}
}

func TestSafeCLIJSONPreservesCanonicalAdminSurfaceDigest(t *testing.T) {
	digest := "sha256:" + strings.Repeat("a", 64)
	input := []byte(`{"serviceId":"server","digest":"` + digest + `","descriptor":{"version":1,"pages":[{"id":"sites"}]}}`)
	output, err := safeCLIJSON(input)
	if err != nil {
		t.Fatal(err)
	}
	var value struct {
		ServiceID  string          `json:"serviceId"`
		Digest     string          `json:"digest"`
		Descriptor json.RawMessage `json:"descriptor"`
	}
	if err := json.Unmarshal(output, &value); err != nil {
		t.Fatal(err)
	}
	if value.ServiceID != "server" || value.Digest != digest || !json.Valid(value.Descriptor) {
		t.Fatalf("safe CLI boundary changed canonical admin surface: %s", output)
	}
}

func TestSafeCLIEventRedactsTextPathsAndSecrets(t *testing.T) {
	event := safeCLIEvent(models.CLIEvent{
		Type:    "diagnostic",
		Message: "request failed for /Users/alice/private/ca.pem token=private-token Authorization: Bearer bearer-secret -----BEGIN PRIVATE KEY-----\nkey-material\n-----END PRIVATE KEY-----",
	})
	for _, secret := range []string{"/Users/alice", "private-token", "bearer-secret", "key-material"} {
		if strings.Contains(event.Message, secret) {
			t.Fatalf("CLI event leaked path or secret: %q", event.Message)
		}
	}
}

func TestCLIEventErrorUsesSafeActionableDiagnostic(t *testing.T) {
	err := cliEventErrorWithDiagnostic(
		models.CLIEvent{Type: "run.failed", Code: "cli.exit", Message: "liapoldus exited with an error"},
		models.CLIEvent{Type: "diagnostic", Severity: "error", Code: "docker_mount_source_unavailable", Message: "Docker cannot access the Core state directory for target local; path=/private/tmp/core/state"},
	)
	if err == nil || err.Error() != "liapoldus: docker_mount_source_unavailable: Docker cannot access the Core state directory for target local; path=[redacted path]" {
		t.Fatalf("expected actionable sanitized diagnostic, got %v", err)
	}
}

func TestSafeCLIEventPreservesTypedDiagnosticCodeAndRedactsHostPath(t *testing.T) {
	event := safeCLIEvent(models.CLIEvent{
		Type:     "diagnostic",
		Severity: "error",
		Code:     "docker_mount_source_unavailable",
		Message:  "Core state mount source is unavailable: /private/tmp/core/state",
	})
	if event.Code != "docker_mount_source_unavailable" || !strings.Contains(event.Message, "[redacted path]") || strings.Contains(event.Message, "/private/tmp") {
		t.Fatalf("typed diagnostic was lost or leaked a host path: %+v", event)
	}
}
