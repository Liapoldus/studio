package sqlite

import "testing"

func TestSQLiteDSNUsesPlatformCorrectFileURI(t *testing.T) {
	for _, test := range []struct {
		name     string
		path     string
		wantPath string
		windows  bool
	}{
		{
			name:     "windows drive path",
			path:     `C:/Users/runner/AppData/Studio/client.sqlite`,
			windows:  true,
			wantPath: `file:///C:/Users/runner/AppData/Studio/client.sqlite?_foreign_keys=on&_busy_timeout=5000&_journal_mode=DELETE`,
		},
		{
			name:     "posix path",
			path:     "/Users/runner/Library/Studio/client.sqlite",
			wantPath: "file:///Users/runner/Library/Studio/client.sqlite?_foreign_keys=on&_busy_timeout=5000&_journal_mode=DELETE",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := sqliteDSN(test.path, test.windows); got != test.wantPath {
				t.Fatalf("sqliteDSN() = %q, want %q", got, test.wantPath)
			}
		})
	}
}
