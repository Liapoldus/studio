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
	return hasDefinitions || hasLegacyDefinitions
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
	if sensitiveCLIField(key) {
		return "[redacted]"
	}
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for childKey, child := range typed {
			result[childKey] = safeCLIValue(child, childKey)
		}
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
