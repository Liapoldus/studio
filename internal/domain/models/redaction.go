package models

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

var textSecretPattern = regexp.MustCompile(`(?i)(token|password|secret|private[_-]?key|authorization)(["']?)(\s*[:=]\s*)(["']?)([^\s,"'}]+)`)

type RedactionAction string

const (
	RedactValue RedactionAction = "redact"
	OmitValue   RedactionAction = "omit"
)

type RedactionAnnotation struct {
	Path   string          `json:"path"`
	Action RedactionAction `json:"action"`
}

func RedactJSON(raw []byte, annotations []RedactionAnnotation) ([]byte, error) {
	if len(raw) == 0 {
		return []byte("null"), nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	redacted := redactValue(value, "", annotations)
	if redacted == nil {
		return []byte("null"), nil
	}
	return json.Marshal(redacted)
}

func RedactText(value string) string {
	return textSecretPattern.ReplaceAllString(value, `$1$2$3$4[REDACTED]`)
}

func redactValue(value any, path string, annotations []RedactionAnnotation) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, child := range typed {
			childPath := path + "/" + escapeJSONPointer(key)
			action := annotationAction(childPath, key, annotations)
			if action == OmitValue {
				continue
			}
			if action == RedactValue {
				result[key] = "[REDACTED]"
				continue
			}
			result[key] = redactValue(child, childPath, annotations)
		}
		return result
	case []any:
		result := make([]any, 0, len(typed))
		for index, child := range typed {
			result = append(result, redactValue(child, path+"/"+strconv.Itoa(index), annotations))
		}
		return result
	default:
		return value
	}
}

func annotationAction(path, key string, annotations []RedactionAnnotation) RedactionAction {
	for _, annotation := range annotations {
		if annotation.Path == path {
			if annotation.Action == OmitValue {
				return OmitValue
			}
			return RedactValue
		}
	}
	key = strings.ToLower(key)
	for _, sensitive := range []string{"secret", "token", "password", "privatekey", "authorization"} {
		if strings.Contains(key, sensitive) {
			return RedactValue
		}
	}
	return ""
}

func escapeJSONPointer(value string) string {
	value = strings.ReplaceAll(value, "~", "~0")
	return strings.ReplaceAll(value, "/", "~1")
}
