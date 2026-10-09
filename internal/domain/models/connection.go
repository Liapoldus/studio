package models

import (
	"errors"
	"net/url"
	"strings"
)

type CoreAccessMode string

const (
	CoreAccessDirect    CoreAccessMode = "direct"
	CoreAccessSSHBridge CoreAccessMode = "ssh-bridge"
)

var ErrInvalidCoreConnection = errors.New("invalid Core connection")

type CoreConnection struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Endpoint   string         `json:"endpoint"`
	AccessMode CoreAccessMode `json:"accessMode"`
}

func NewCoreConnection(id, name, endpoint string, mode CoreAccessMode) (CoreConnection, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(endpoint))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.Opaque != "" || strings.Contains(endpoint, "#") {
		return CoreConnection{}, ErrInvalidCoreConnection
	}
	if strings.TrimSpace(id) == "" || strings.TrimSpace(name) == "" || !validCoreAccessMode(mode) {
		return CoreConnection{}, ErrInvalidCoreConnection
	}

	return CoreConnection{
		ID:         strings.TrimSpace(id),
		Name:       strings.TrimSpace(name),
		Endpoint:   parsed.String(),
		AccessMode: mode,
	}, nil
}

func validCoreAccessMode(mode CoreAccessMode) bool {
	return mode == CoreAccessDirect || mode == CoreAccessSSHBridge
}
