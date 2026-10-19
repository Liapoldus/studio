// Package sandboxargs parses the command boundary for the plugin sandbox launcher.
package sandboxargs

import "errors"

var errMissingCommandSeparator = errors.New("sandbox launcher command must follow --")
var errEmptyCommand = errors.New("sandbox launcher command is empty")

// AfterSeparator returns the command suffix following the required separator.
func AfterSeparator(arguments []string, separator string) ([]string, error) {
	for index, argument := range arguments {
		if argument != separator {
			continue
		}
		if index+1 == len(arguments) {
			return nil, errEmptyCommand
		}
		command := make([]string, len(arguments)-index-1)
		copy(command, arguments[index+1:])
		return command, nil
	}
	return nil, errMissingCommandSeparator
}
