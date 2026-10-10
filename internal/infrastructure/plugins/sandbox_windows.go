//go:build windows

package plugins

import (
	"os"
	"path/filepath"
)

func newPlatformSandbox() (ProcessSandbox, error) {
	helper := os.Getenv("STUDIO_PLUGIN_SANDBOX_HELPER")
	if helper == "" {
		executable, err := os.Executable()
		if err != nil {
			return platformSandbox{kind: "windows"}, ErrSandboxUnavailable
		}
		helper = filepath.Join(filepath.Dir(executable), "studio-sandbox-launcher.exe")
	}
	info, err := os.Stat(helper)
	if err != nil || info.IsDir() || !info.Mode().IsRegular() {
		return platformSandbox{kind: "windows"}, ErrSandboxUnavailable
	}
	return platformSandbox{kind: "windows", binary: helper}, nil
}
