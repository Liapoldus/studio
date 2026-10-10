package models

import (
	"strings"
	"testing"
)

func TestRedactJSONUsesAnnotationsAndDefenseInDepth(t *testing.T) {
	value, err := RedactJSON([]byte(`{"safe":"ok","profile":{"email":"a@example.test","token":"do-not-store"},"debug":true}`), []RedactionAnnotation{{Path: "/profile/email", Action: OmitValue}})
	if err != nil {
		t.Fatal(err)
	}
	output := string(value)
	if strings.Contains(output, "a@example.test") || strings.Contains(output, "do-not-store") || !strings.Contains(output, "[REDACTED]") {
		t.Fatalf("unsafe redaction output: %s", output)
	}
}
