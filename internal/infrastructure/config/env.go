// Package config reads ENV-only Studio bootstrap values.
package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

var ErrInvalidBootstrap = errors.New("invalid Studio ENV bootstrap")

type LookupEnv func(string) (string, bool)

type Desktop struct{ DatabasePath string }

func LoadDesktop(lookup LookupEnv, defaultPath string) (Desktop, error) {
	path := defaultPath
	if value, ok := lookup("STUDIO_DESKTOP_DB_PATH"); ok {
		path = value
	}
	if !filepath.IsAbs(path) || strings.ContainsRune(path, '\x00') {
		return Desktop{}, ErrInvalidBootstrap
	}
	return Desktop{DatabasePath: filepath.Clean(path)}, nil
}

func DesktopFromENV() (Desktop, error) {
	if _, ok := os.LookupEnv("STUDIO_DESKTOP_DB_PATH"); ok {
		return LoadDesktop(os.LookupEnv, "")
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return Desktop{}, ErrInvalidBootstrap
	}
	return LoadDesktop(os.LookupEnv, filepath.Join(dir, "Liapoldus", "Studio", "client.sqlite"))
}
