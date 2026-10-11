package config

import "os"

// ReleaseBuild is set by the signed packaging workflow through a Go ldflag.
// Local and unsigned QA builds keep the developer-friendly best-effort mode.
var ReleaseBuild = "false"

// ApplyReleasePluginPolicy makes the security posture part of the signed
// binary, rather than relying on a launcher to provide mutable environment
// variables. Trust roots remain external so private keys never enter the app.
func ApplyReleasePluginPolicy() {
	if ReleaseBuild != "true" {
		return
	}
	if err := os.Setenv("STUDIO_PLUGIN_REQUIRE_SIGNATURES", "true"); err != nil {
		panic("cannot enforce release plugin signature policy")
	}
	if err := os.Setenv("STUDIO_PLUGIN_SANDBOX_MODE", "required"); err != nil {
		panic("cannot enforce release plugin sandbox policy")
	}
}
