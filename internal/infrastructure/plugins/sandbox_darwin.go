//go:build darwin

package plugins

import "os/exec"

func newPlatformSandbox() (ProcessSandbox, error) {
	binary, err := exec.LookPath("sandbox-exec")
	if err != nil {
		return platformSandbox{kind: "darwin"}, ErrSandboxUnavailable
	}
	return platformSandbox{kind: "darwin", binary: binary}, nil
}
