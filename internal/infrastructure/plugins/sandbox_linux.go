//go:build linux

package plugins

import "os/exec"

func newPlatformSandbox() (ProcessSandbox, error) {
	binary, err := exec.LookPath("bwrap")
	if err != nil {
		return platformSandbox{kind: "linux"}, ErrSandboxUnavailable
	}
	return platformSandbox{kind: "linux", binary: binary}, nil
}
