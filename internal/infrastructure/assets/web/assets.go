// Package web embeds the web frontend build.
package web

import "embed"

//go:embed all:dist
var Files embed.FS
