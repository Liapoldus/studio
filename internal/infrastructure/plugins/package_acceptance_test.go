package plugins

import (
	"archive/zip"
	"context"
	"os"
	"testing"
)

func TestInspectPackagedServerEditor(t *testing.T) {
	packagePath := os.Getenv("STUDIO_PLUGIN_PACKAGE")
	if packagePath == "" {
		t.Skip("set STUDIO_PLUGIN_PACKAGE to inspect the workspace Server editor package")
	}
	archive, err := zip.OpenReader(packagePath)
	if err != nil {
		t.Fatalf("open packaged Server editor: %v", err)
	}
	manifest, files, err := readManifest(archive.File)
	if closeErr := archive.Close(); closeErr != nil {
		t.Fatalf("close packaged Server editor: %v", closeErr)
	}
	if err != nil {
		t.Fatalf("read packaged Server editor manifest: %v", err)
	}
	if validationErr := validateManifest(manifest, files, false); validationErr != nil {
		t.Fatalf("validate packaged Server editor manifest: %v", validationErr)
	}
	inspection, err := (Installer{}).Inspect(context.Background(), packagePath)
	if err != nil {
		t.Fatalf("inspect packaged Server editor: %v", err)
	}
	if inspection.Manifest.ID != "liapoldus.server-editor" || len(inspection.Manifest.Surfaces) != 1 {
		t.Fatalf("unexpected Server editor package manifest: id=%q surfaces=%d", inspection.Manifest.ID, len(inspection.Manifest.Surfaces))
	}
	for _, path := range []string{"ui/bridge.js", "ui/protocol.js", "ui/schema-editor.js"} {
		if !containsString(inspection.Files, path) {
			t.Fatalf("CSP-compatible Server editor asset is missing from package: %s", path)
		}
	}
	surface := inspection.Manifest.Surfaces[0]
	if surface.ID != "server-editor" || surface.Kind != "page" || surface.Route != "ui/index.html" {
		t.Fatalf("unexpected Server editor surface: %#v", surface)
	}
	if inspection.Manifest.Process != nil || len(inspection.Manifest.Tools) != 0 || !containsString(inspection.Manifest.Permissions, "service.settings.read") || !containsString(inspection.Manifest.Permissions, "service.settings.write") || !containsString(inspection.Manifest.Permissions, "service.configuration-ui.read") || !containsString(inspection.Manifest.Permissions, "service.resources.read") || !containsString(inspection.Manifest.Permissions, "service.resources.publish") || !containsString(inspection.Manifest.Permissions, "service.peer.catalog.read") || len(inspection.Manifest.Permissions) != 6 {
		t.Fatalf("Server editor must request only its explicit settings, metadata, resource and peer-catalog host permissions: %#v", inspection.Manifest.Permissions)
	}
	installer := Installer{Directory: t.TempDir()}
	installed, err := installer.Install(context.Background(), packagePath, approvedPackageTrust(t, installer, packagePath, []string{"service.settings.read", "service.settings.write", "service.configuration-ui.read", "service.resources.read", "service.resources.publish", "service.peer.catalog.read"}))
	if err != nil {
		t.Fatalf("install packaged Server editor into temporary directory: %v", err)
	}
	if installed.Manifest.ID != inspection.Manifest.ID || installed.Manifest.Version != inspection.Manifest.Version {
		t.Fatalf("installed package identity differs from inspected package: %#v", installed.Manifest)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
