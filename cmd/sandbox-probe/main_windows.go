//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: sandbox-probe <project-root> <outside-root>")
		os.Exit(2)
	}
	projectPath := filepath.Join(os.Args[1], "allowed.txt")
	if err := os.WriteFile(projectPath, []byte("sandboxed"), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "project write failed: %v\n", err)
		os.Exit(1)
	}
	outsidePath := filepath.Join(os.Args[2], "denied.txt")
	if err := os.WriteFile(outsidePath, []byte("escape"), 0o600); err == nil {
		fmt.Fprintln(os.Stderr, "outside write unexpectedly succeeded")
		os.Exit(1)
	} else if !errors.Is(err, os.ErrPermission) {
		fmt.Fprintf(os.Stderr, "outside write failed with unexpected error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("sandbox filesystem smoke: PASS")
}
