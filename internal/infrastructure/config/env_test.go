package config

import (
	"errors"
	"testing"
)

func lookup(values map[string]string) LookupEnv {
	return func(key string) (string, bool) { value, ok := values[key]; return value, ok }
}

func TestWebENV(t *testing.T) {
	value, err := LoadWeb(lookup(nil))
	if err != nil || value.ListenAddress != "127.0.0.1:8080" {
		t.Fatalf("unexpected bootstrap: %+v, %v", value, err)
	}
	for _, address := range []string{"", "localhost", "127.0.0.1:bad", "127.0.0.1:0", "127.0.0.1:65536"} {
		_, err := LoadWeb(lookup(map[string]string{"STUDIO_WEB_LISTEN_ADDRESS": address}))
		if !errors.Is(err, ErrInvalidBootstrap) {
			t.Fatalf("accepted listen address %q", address)
		}
	}
}

func TestDesktopENV(t *testing.T) {
	value, err := LoadDesktop(lookup(nil), "/tmp/studio/client.sqlite")
	if err != nil || value.DatabasePath != "/tmp/studio/client.sqlite" {
		t.Fatalf("default: %+v %v", value, err)
	}
	value, err = LoadDesktop(lookup(map[string]string{"STUDIO_DESKTOP_DB_PATH": "/tmp/custom.sqlite"}), "")
	if err != nil || value.DatabasePath != "/tmp/custom.sqlite" {
		t.Fatalf("override: %+v %v", value, err)
	}
	for _, path := range []string{"", "relative.sqlite", ":memory:", "file:/tmp/studio.sqlite"} {
		if _, err := LoadDesktop(lookup(map[string]string{"STUDIO_DESKTOP_DB_PATH": path}), "/tmp/default.sqlite"); !errors.Is(err, ErrInvalidBootstrap) {
			t.Fatalf("accepted path %q", path)
		}
	}
}
