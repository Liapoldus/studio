// Package config reads ENV-only Studio bootstrap values.
package config

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var ErrInvalidBootstrap = errors.New("invalid Studio ENV bootstrap")

type LookupEnv func(string) (string, bool)

type Web struct {
	ListenAddress string
	ProjectRoot   string
}

type Desktop struct{ DatabasePath string }

func LoadWeb(lookup LookupEnv) (Web, error) {
	address := "127.0.0.1:8080"
	if value, ok := lookup("STUDIO_WEB_LISTEN_ADDRESS"); ok {
		address = strings.TrimSpace(value)
	}
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		return Web{}, ErrInvalidBootstrap
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return Web{}, ErrInvalidBootstrap
	}
	projectRoot := ""
	if value, ok := lookup("STUDIO_PROJECT_ROOT"); ok {
		projectRoot = filepath.Clean(strings.TrimSpace(value))
		if projectRoot == "." || !filepath.IsAbs(projectRoot) || strings.ContainsRune(projectRoot, '\x00') {
			return Web{}, ErrInvalidBootstrap
		}
	}
	return Web{ListenAddress: address, ProjectRoot: projectRoot}, nil
}

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
