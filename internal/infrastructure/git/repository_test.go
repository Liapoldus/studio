package git

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepositoryStatus(t *testing.T) {
	root := t.TempDir()
	runGit(t, root, "init", "-q")
	runGit(t, root, "config", "user.email", "studio@example.test")
	runGit(t, root, "config", "user.name", "Studio Test")
	file := filepath.Join(root, "project.yaml")
	if err := os.WriteFile(file, []byte("id: demo\nname: Demo\n"), 0600); err != nil {
		t.Fatal(err)
	}
	status, err := (Repository{}).Status(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Available || status.Branch == "" || status.Revision != "" || !status.Dirty {
		t.Fatalf("unexpected dirty status: %+v", status)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "initial")
	status, err = (Repository{}).Status(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Available || status.Revision == "" || status.Dirty {
		t.Fatalf("expected clean status: %+v", status)
	}
}

func TestBranchName(t *testing.T) {
	for input, expected := range map[string]string{
		"## main...origin/main [ahead 1]":   "main",
		"## No commits yet on feature/demo": "feature/demo",
		"## HEAD (no branch)":               "HEAD",
	} {
		if actual := branchName(input); actual != expected {
			t.Errorf("branchName(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestParseStatusIncludesChangeDetails(t *testing.T) {
	status := parseStatus("## feature/demo...origin/feature/demo [ahead 1]\nM  staged.yaml\n M working.yaml\n?? new.yaml\nR  old.yaml -> renamed.yaml\nUU conflict.yaml\n")
	if !status.Dirty || !status.Conflict || status.Branch != "feature/demo" || len(status.Changes) != 5 {
		t.Fatalf("unexpected status: %+v", status)
	}
	if status.Changes[0].Path != "staged.yaml" || status.Changes[0].IndexStatus != "M" || status.Changes[0].WorktreeStatus != " " {
		t.Fatalf("unexpected staged change: %+v", status.Changes[0])
	}
	if status.Changes[3].Path != "renamed.yaml" {
		t.Fatalf("unexpected rename: %+v", status.Changes[3])
	}
}

func TestRepositoryDiffBranchesAndCommit(t *testing.T) {
	root := t.TempDir()
	runGit(t, root, "init", "-q")
	runGit(t, root, "config", "user.email", "studio@example.test")
	runGit(t, root, "config", "user.name", "Studio Test")
	file := filepath.Join(root, "project.yaml")
	if err := os.WriteFile(file, []byte("name: before\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "initial")
	if err := os.WriteFile(file, []byte("name: after\n"), 0600); err != nil {
		t.Fatal(err)
	}
	repository := Repository{}
	diff, err := repository.Diff(context.Background(), root, "project.yaml")
	if err != nil || !strings.Contains(diff.Patch, "name: after") || diff.Truncated {
		t.Fatalf("diff: %+v %v", diff, err)
	}
	branches, err := repository.Branches(context.Background(), root)
	if err != nil || len(branches) != 1 || !branches[0].Current {
		t.Fatalf("branches: %+v %v", branches, err)
	}
	if _, commitErr := repository.Commit(context.Background(), root, "save changes", []string{"project.yaml"}, false); !errors.Is(commitErr, ErrConfirmation) {
		t.Fatalf("missing confirmation: %v", commitErr)
	}
	revision, err := repository.Commit(context.Background(), root, "save changes", []string{"project.yaml"}, true)
	if err != nil || revision == "" {
		t.Fatalf("commit: %q %v", revision, err)
	}
	status, err := repository.Status(context.Background(), root)
	if err != nil || status.Dirty {
		t.Fatalf("post-commit status: %+v %v", status, err)
	}
	history, err := repository.History(context.Background(), root, 10)
	if err != nil || len(history) != 2 || history[0].Subject != "save changes" {
		t.Fatalf("history: %+v %v", history, err)
	}
	if _, err := repository.History(context.Background(), root, 101); !errors.Is(err, ErrInvalidGitRequest) {
		t.Fatalf("expected history limit validation, got %v", err)
	}
}

func TestRepositoryRemotesRedactCredentialsAndCheckoutCleanBranch(t *testing.T) {
	root := t.TempDir()
	runGit(t, root, "init", "-q")
	runGit(t, root, "config", "user.email", "studio@example.test")
	runGit(t, root, "config", "user.name", "Studio Test")
	if err := os.WriteFile(filepath.Join(root, "project.yaml"), []byte("name: demo\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "initial")
	runGit(t, root, "branch", "feature/demo")
	runGit(t, root, "remote", "add", "origin", "https://token:password@example.test/liapoldus/project.git")
	repository := Repository{}
	remotes, err := repository.Remotes(context.Background(), root)
	if err != nil || len(remotes) != 1 || strings.Contains(remotes[0].FetchURL, "token") || strings.Contains(remotes[0].FetchURL, "password") {
		t.Fatalf("redacted remotes: %+v %v", remotes, err)
	}
	if checkoutErr := repository.Checkout(context.Background(), root, "feature/demo", true); checkoutErr != nil {
		t.Fatalf("checkout: %v", checkoutErr)
	}
	status, err := repository.Status(context.Background(), root)
	if err != nil || status.Branch != "feature/demo" {
		t.Fatalf("checked out status: %+v %v", status, err)
	}
}

func runGit(t *testing.T, root string, args ...string) {
	t.Helper()
	command := exec.CommandContext(context.Background(), "git", append([]string{"-C", root}, args...)...) //nolint:gosec // fixed Git binary and test-owned temporary root.
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}
