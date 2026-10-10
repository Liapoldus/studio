//go:build !darwin && !linux && !windows

package plugins

func newPlatformSandbox() (ProcessSandbox, error) {
	return platformSandbox{}, ErrSandboxUnavailable
}
