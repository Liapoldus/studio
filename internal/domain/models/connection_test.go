package models

import (
	"errors"
	"testing"
)

func TestCoreConnection(t *testing.T) {
	for _, mode := range []CoreAccessMode{CoreAccessDirect, CoreAccessSSHBridge} {
		value, err := NewCoreConnection(" id ", " Core ", " https://core.test/api ", mode)
		if err != nil || value.ID != "id" || value.Name != "Core" || value.Endpoint != "https://core.test/api" {
			t.Fatalf("normalization: %+v %v", value, err)
		}
	}
	for _, endpoint := range []string{"http://core.test", "https://user:secret@core.test", "https://core.test?", "https://core.test#secret", "https://core.test:bad", "https:///api"} {
		if _, err := NewCoreConnection("id", "Core", endpoint, CoreAccessDirect); !errors.Is(err, ErrInvalidCoreConnection) {
			t.Fatalf("accepted endpoint %q", endpoint)
		}
	}
	for _, connection := range []CoreConnection{{Name: "Core", AccessMode: CoreAccessDirect}, {ID: "id", AccessMode: CoreAccessDirect}, {ID: "id", Name: "Core", AccessMode: "unknown"}} {
		if _, err := NewCoreConnection(connection.ID, connection.Name, "https://core.test", connection.AccessMode); !errors.Is(err, ErrInvalidCoreConnection) {
			t.Fatal("accepted invalid metadata")
		}
	}
}
