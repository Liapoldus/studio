package project

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/Liapoldus/studio/internal/domain/models"
)

func TestMutationsWriteCanonicalRuntimeGraph(t *testing.T) {
	root := t.TempDir()
	ctx := context.Background()
	mutations := Mutations{}
	for _, plugin := range []models.RuntimePluginInput{{ID: "orders", Name: "Orders", Version: "1.0.0", ManifestVersion: "v1"}, {ID: "billing", Name: "Billing", Version: "1.0.0", ManifestVersion: "v1"}} {
		if err := mutations.CreateRuntimePlugin(ctx, root, plugin); err != nil {
			t.Fatal(err)
		}
	}
	input := models.PluginLinkInput{ID: "orders-to-billing", Caller: "orders", Target: "billing", ContractVersion: "v1", Methods: []string{"charge"}, Transport: "local", SecurityProfile: "default", TimeoutMillis: 1000, RedactionPolicy: "schema"}
	if err := mutations.CreatePluginLink(ctx, root, input); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "services", "orders", "links", "orders-to-billing.json")
	data, err := os.ReadFile(path) //nolint:gosec // path is assembled from fixed validated test identifiers.
	if err != nil {
		t.Fatal(err)
	}
	var contract map[string]any
	if err := json.Unmarshal(data, &contract); err != nil || contract["caller"] != "orders" || contract["target"] != "billing" {
		t.Fatalf("invalid canonical contract: %s", data)
	}
	if err := mutations.DeletePluginLink(ctx, root, "orders", input.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := mutations.DeleteRuntimePlugin(ctx, root, "billing", true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "services", "billing")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("plugin directory remains: %v", err)
	}
}

func TestMutationsRejectUnsafeGraphIdentifiers(t *testing.T) {
	if err := (Mutations{}).CreateRuntimePlugin(context.Background(), t.TempDir(), models.RuntimePluginInput{ID: "../escape", Name: "Bad", Version: "1", ManifestVersion: "v1"}); !errors.Is(err, models.ErrInvalidProject) {
		t.Fatalf("unsafe plugin identifier accepted: %v", err)
	}
}

func TestCreatePluginLinkCreatesLinksDirectoryForImportedPlugin(t *testing.T) {
	root := t.TempDir()
	for _, id := range []string{"server", "echo"} {
		if err := os.MkdirAll(filepath.Join(root, "services", id), 0700); err != nil {
			t.Fatal(err)
		}
	}
	input := models.PluginLinkInput{ID: "server-to-echo", Caller: "server", Target: "echo", ContractVersion: "v1", Methods: []string{"hello"}}
	if err := (Mutations{}).CreatePluginLink(context.Background(), root, input); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "services", "server", "links", "server-to-echo.json")); err != nil {
		t.Fatalf("link was not created for imported plugin: %v", err)
	}
}
