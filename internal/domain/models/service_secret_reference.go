package models

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// ServiceSecretReference contains safe catalog metadata only.
type ServiceSecretReference struct {
	Reference string `json:"reference"`
	ServiceID string `json:"serviceId"`
	Purpose   string `json:"purpose"`
	Label     string `json:"label"`
	State     string `json:"state"`
	CreatedAt string `json:"createdAt"`
}

func (reference ServiceSecretReference) ValidFor(serviceID string) bool {
	const prefix = "ssr:v1:"
	if reference.ServiceID != serviceID || len(reference.Reference) != len(prefix)+32 || !strings.HasPrefix(reference.Reference, prefix) ||
		reference.Purpose == "" || reference.Label == "" || strings.TrimSpace(reference.Label) != reference.Label || utf8.RuneCountInString(reference.Label) > 128 ||
		reference.CreatedAt == "" || (reference.State != "active" && reference.State != "revoked") {
		return false
	}
	for _, character := range reference.Reference[len(prefix):] {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return false
		}
	}
	if !validServiceSecretPurpose(reference.Purpose) {
		return false
	}
	for _, character := range reference.Label {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

func validServiceSecretPurpose(value string) bool {
	if len(value) > 192 || strings.TrimSpace(value) != value {
		return false
	}
	for _, part := range strings.Split(value, ".") {
		if part == "" || part[0] < 'a' || part[0] > 'z' {
			return false
		}
		for _, character := range part {
			if !strings.ContainsRune("abcdefghijklmnopqrstuvwxyz0123456789-", character) {
				return false
			}
		}
	}
	return true
}
