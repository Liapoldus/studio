package sandboxargs

import (
	"errors"
	"reflect"
	"testing"
)

func TestAfterSeparatorReturnsCommandAndArguments(t *testing.T) {
	arguments := []string{"--project-root", "project", "--", "probe.exe", "--flag", "value"}
	command, err := AfterSeparator(arguments, "--")
	if err != nil {
		t.Fatalf("AfterSeparator() error = %v", err)
	}
	want := []string{"probe.exe", "--flag", "value"}
	if !reflect.DeepEqual(command, want) {
		t.Fatalf("AfterSeparator() = %#v, want %#v", command, want)
	}
}

func TestAfterSeparatorRequiresSeparatorAndCommand(t *testing.T) {
	if _, err := AfterSeparator([]string{"--project-root", "project", "probe.exe"}, "--"); !errors.Is(err, errMissingCommandSeparator) {
		t.Fatalf("missing separator error = %v", err)
	}
	if _, err := AfterSeparator([]string{"--project-root", "project", "--"}, "--"); !errors.Is(err, errEmptyCommand) {
		t.Fatalf("empty command error = %v", err)
	}
}
