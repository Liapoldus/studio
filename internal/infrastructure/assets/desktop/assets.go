// Package desktop embeds the desktop frontend build.
package desktop

import "embed"

//go:embed all:dist
var Files embed.FS
