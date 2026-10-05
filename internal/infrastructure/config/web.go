package config

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"strings"
)

var ErrInvalidWebConfig = errors.New("invalid Studio web configuration")

type Web struct {
	ListenAddress string `json:"listenAddress"`
	CoreEndpoint  string `json:"coreEndpoint"`
}

func LoadWeb(path string) (Web, error) {
	file, err := os.Open(path)
	if err != nil {
		return Web{}, ErrInvalidWebConfig
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var value Web
	if err := decoder.Decode(&value); err != nil {
		return Web{}, ErrInvalidWebConfig
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Web{}, ErrInvalidWebConfig
	}

	parsed, err := url.ParseRequestURI(strings.TrimSpace(value.CoreEndpoint))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" ||
		strings.TrimSpace(value.ListenAddress) == "" {
		return Web{}, ErrInvalidWebConfig
	}
	value.CoreEndpoint = parsed.String()
	value.ListenAddress = strings.TrimSpace(value.ListenAddress)
	return value, nil
}
