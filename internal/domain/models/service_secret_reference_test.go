package models

import "testing"

func TestServiceSecretReferenceAcceptsOnlyOpaqueServiceBoundMetadata(t *testing.T) {
	valid := ServiceSecretReference{Reference: "ssr:v1:00112233445566778899aabbccddeeff", ServiceID: "server", Purpose: "http.auth.bearer", Label: "edge", State: "active", CreatedAt: "2026-10-17T00:00:00Z"}
	if !valid.ValidFor("server") {
		t.Fatal("valid service secret metadata was rejected")
	}
	for _, mutate := range []func(*ServiceSecretReference){
		func(item *ServiceSecretReference) { item.ServiceID = "echo" },
		func(item *ServiceSecretReference) { item.Reference = "/private/token" },
		func(item *ServiceSecretReference) { item.Purpose = "invalid purpose" },
		func(item *ServiceSecretReference) { item.Label = "bad\nlabel" },
		func(item *ServiceSecretReference) { item.State = "unknown" },
	} {
		candidate := valid
		mutate(&candidate)
		if candidate.ValidFor("server") {
			t.Fatalf("invalid metadata was accepted: %+v", candidate)
		}
	}
}
