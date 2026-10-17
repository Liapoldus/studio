package wails

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/models"
)

var cliAbsolutePathPattern = regexp.MustCompile(`(^|[\s=])(/[\w.@%+,:=~/-]+|[A-Za-z]:\\[^\s"'<>]+)`)
var cliBearerPattern = regexp.MustCompile(`(?i)(bearer[\s]+)[^\s,;]+`)
var cliPrivateKeyPattern = regexp.MustCompile(`(?is)-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----`)
var cliPublicIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// safeCLIJSON is the final renderer boundary for CLI-owned JSON. The CLI
// remains authoritative for credentials and runtime paths, but Studio UI and
// StudioPlugin surfaces receive only a safe projection.
func safeCLIJSON(raw []byte) ([]byte, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	if isJSONSchema(value) {
		return json.Marshal(safeCLISchemaValue(value, ""))
	}
	return json.Marshal(safeCLIValue(value, ""))
}

func isJSONSchema(value any) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return false
	}
	if _, ok := object["$schema"]; ok {
		return true
	}
	_, hasDefinitions := object["$defs"]
	_, hasLegacyDefinitions := object["definitions"]
	if hasDefinitions || hasLegacyDefinitions {
		return true
	}
	objectType, isObjectSchema := object["type"].(string)
	properties, hasProperties := object["properties"].(map[string]any)
	return isObjectSchema && objectType == "object" && hasProperties && len(properties) <= 4096
}

// safeCLISchemaValue redacts secret-bearing examples/defaults without
// destroying the JSON Schema structure. A key such as privateKeyRef names a
// schema property here; replacing its schema object with a string would make
// the imported Project contract unusable and permanently disagree with Core.
func safeCLISchemaValue(value any, key string) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		sensitive := sensitiveCLIField(key)
		for childKey, child := range typed {
			if sensitive && (childKey == "default" || childKey == "const" || childKey == "example" || childKey == "examples" || childKey == "enum") {
				continue
			}
			result[childKey] = safeCLISchemaValue(child, childKey)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			result[index] = safeCLISchemaValue(child, key)
		}
		return result
	case string:
		return safeCLISchemaText(typed)
	default:
		return value
	}
}

// JSON Schema strings describe the contract and can legitimately contain
// route/path syntax. They are not runtime path values; preserve them exactly
// while still removing credential-like text and private-key material.
func safeCLISchemaText(value string) string {
	value = cliPrivateKeyPattern.ReplaceAllString(value, "[redacted private key material]")
	value = cliBearerPattern.ReplaceAllString(value, "$1[redacted]")
	return models.RedactText(value)
}

func safeCLIValue(value any, key string) any {
	// Purpose identifiers are public service-manifest capabilities. Preserve
	// only well-formed names; secret values and references remain redacted.
	if key == "secretPurposes" {
		values, ok := value.([]any)
		if !ok || len(values) > 128 {
			return "[redacted]"
		}
		result := make([]any, 0, len(values))
		for _, item := range values {
			purpose, ok := item.(string)
			if !ok || !validSecretPurpose(purpose) {
				return "[redacted]"
			}
			result = append(result, purpose)
		}
		return result
	}
	if sensitiveCLIField(key) {
		return "[redacted]"
	}
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for childKey, child := range typed {
			result[childKey] = safeCLIValue(child, childKey)
		}
		preserveEditorButtonKeys(typed, result)
		return result
	case []any:
		result := make([]any, len(typed))
		for index, child := range typed {
			result[index] = safeCLIValue(child, key)
		}
		return result
	case string:
		return safeCLIText(typed)
	default:
		return value
	}
}

// The SDK's button key is a public developer identifier, not key material.
// Exempt only bounded identifiers whose ID proves the service namespace.
func preserveEditorButtonKeys(source, safe map[string]any) {
	serviceID, ok := source["id"].(string)
	if !ok || !cliPublicIdentifierPattern.MatchString(serviceID) {
		return
	}
	descriptor, ok := source["editorButtons"].(map[string]any)
	if !ok || descriptor["version"] != "service-editor-buttons/v1" {
		return
	}
	buttons, ok := descriptor["buttons"].([]any)
	if !ok || len(buttons) > 64 {
		return
	}
	safeDescriptor, ok := safe["editorButtons"].(map[string]any)
	if !ok {
		return
	}
	safeButtons, ok := safeDescriptor["buttons"].([]any)
	if !ok || len(safeButtons) != len(buttons) {
		return
	}
	for index, raw := range buttons {
		button, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		key, ok := button["key"].(string)
		if !ok || !cliPublicIdentifierPattern.MatchString(key) || button["id"] != serviceID+"."+key {
			continue
		}
		if safeButton, ok := safeButtons[index].(map[string]any); ok {
			safeButton["key"] = key
		}
	}
}

func sensitiveCLIField(key string) bool {
	key = strings.ToLower(strings.NewReplacer("_", "", "-", "", ".", "").Replace(key))
	for _, fragment := range []string{"secret", "token", "password", "privatekey", "authorization", "credentialref", "credential", "apikey"} {
		if strings.Contains(key, fragment) {
			return true
		}
	}
	for _, suffix := range []string{"path", "file", "directory", "dir", "binary", "socket"} {
		if strings.HasSuffix(key, suffix) {
			return true
		}
	}
	return key == "key"
}

func safeCLIEvent(event models.CLIEvent) models.CLIEvent {
	event.Message = safeCLIText(event.Message)
	if event.ReportPath != "" {
		event.ReportPath = "[redacted path]"
	}
	if len(event.Payload) > 0 {
		if payload, err := safeCLIJSON(event.Payload); err == nil {
			event.Payload = payload
		} else {
			event.Payload = json.RawMessage(`"[redacted output]"`)
		}
	}
	return event
}

func safeCLIText(value string) string {
	value = cliPrivateKeyPattern.ReplaceAllString(value, "[redacted private key material]")
	value = cliBearerPattern.ReplaceAllString(value, "$1[redacted]")
	value = models.RedactText(value)
	return cliAbsolutePathPattern.ReplaceAllString(value, "$1[redacted path]")
}
