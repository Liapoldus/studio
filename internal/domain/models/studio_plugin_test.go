package models

import (
	"encoding/json"
	"testing"
)

func TestStudioPluginProcessIdentityIsQualifiedWithoutChangingPackageIdentity(t *testing.T) {
	status := StudioPluginProcessStatus{StudioPluginID: "example.plugin", Version: "1", State: "running", Sandboxed: true}
	data, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"studioPluginId":"example.plugin","version":"1","state":"running","sandboxed":true}` {
		t.Fatalf("unqualified process status identity: %s", data)
	}
	manifest := StudioPluginManifest{ID: "example.plugin", Version: "1"}
	data, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var packageIdentity struct {
		ID string `json:"id"`
	}
	if parseErr := json.Unmarshal(data, &packageIdentity); parseErr != nil || packageIdentity.ID != "example.plugin" {
		t.Fatalf("package identity changed: %s %v", data, parseErr)
	}
}
