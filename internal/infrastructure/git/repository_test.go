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

func TestRepositoryPartialStagingAndStashRecovery(t *testing.T) {
	root := t.TempDir()
	runGit(t, root, "init", "-q")
	runGit(t, root, "config", "user.email", "studio@example.test")
	runGit(t, root, "config", "user.name", "Studio Test")
	writeGitTestFile(t, root, "a.yaml", "name: a\n")
	writeGitTestFile(t, root, "b.yaml", "name: b\n")
	runGit(t, root, "add", ".")
	runGit(t, root, "commit", "-q", "-m", "initial")
	writeGitTestFile(t, root, "a.yaml", "name: a-two\n")
	writeGitTestFile(t, root, "b.yaml", "name: b-two\n")
	repository := Repository{}
	if err := repository.Stage(context.Background(), root, []string{"a.yaml"}, true); err != nil {
		t.Fatalf("stage: %v", err)
	}
	status, err := repository.Status(context.Background(), root)
	if err != nil || status.Changes[0].IndexStatus != "M" || status.Changes[0].WorktreeStatus != " " {
		t.Fatalf("expected staged a.yaml: %+v %v", status, err)
	}
	if unstageErr := repository.Unstage(context.Background(), root, []string{"a.yaml"}, true); unstageErr != nil {
		t.Fatalf("unstage: %v", unstageErr)
	}
	if _, commitErr := repository.CommitStaged(context.Background(), root, "should fail", true); !errors.Is(commitErr, ErrInvalidGitRequest) {
		t.Fatalf("expected no staged commit, got %v", commitErr)
	}
	if stageErr := repository.Stage(context.Background(), root, []string{"a.yaml"}, true); stageErr != nil {
		t.Fatalf("restage: %v", stageErr)
	}
	if _, commitErr := repository.CommitStaged(context.Background(), root, "partial save", true); commitErr != nil {
		t.Fatalf("commit staged: %v", commitErr)
	}
	writeGitTestFile(t, root, "untracked.txt", "draft\n")
	ref, err := repository.Stash(context.Background(), root, "draft recovery", true, true)
	if err != nil || ref != "stash@{0}" {
		t.Fatalf("stash: %q %v", ref, err)
	}
	stashes, err := repository.Stashes(context.Background(), root, 10)
	if err != nil || len(stashes) != 1 || stashes[0].Message != "On "+status.Branch+": draft recovery" {
		t.Fatalf("stashes: %+v %v", stashes, err)
	}
	clean, err := repository.Status(context.Background(), root)
	if err != nil || clean.Dirty {
		t.Fatalf("expected clean after stash: %+v %v", clean, err)
	}
	if applyErr := repository.ApplyStash(context.Background(), root, 0, true, true); applyErr != nil {
		t.Fatalf("apply stash: %v", applyErr)
	}
	recovered, err := repository.Status(context.Background(), root)
	if err != nil || !recovered.Dirty {
		t.Fatalf("expected recovered draft: %+v %v", recovered, err)
	}
	stashes, err = repository.Stashes(context.Background(), root, 10)
	if err != nil || len(stashes) != 0 {
		t.Fatalf("expected dropped stash: %+v %v", stashes, err)
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

func TestRepositoryHistoryOperationsAndConflictAbort(t *testing.T) {
	root := t.TempDir()
	runGit(t, root, "init", "-q")
	runGit(t, root, "config", "user.email", "studio@example.test")
	runGit(t, root, "config", "user.name", "Studio Test")
	file := filepath.Join(root, "project.yaml")
	if err := os.WriteFile(file, []byte("name: base\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "initial")
	defaultBranch := strings.TrimSpace(string(runGitOutput(t, root, "branch", "--show-current")))
	runGit(t, root, "branch", "feature")
	runGit(t, root, "switch", "feature")
	if err := os.WriteFile(file, []byte("name: feature\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "feature")
	featureCommit := strings.TrimSpace(string(runGitOutput(t, root, "rev-parse", "feature")))
	runGit(t, root, "switch", defaultBranch)

	if err := (Repository{}).CherryPick(context.Background(), root, featureCommit, false); !errors.Is(err, ErrConfirmation) {
		t.Fatalf("expected cherry-pick confirmation, got %v", err)
	}
	if err := (Repository{}).CherryPick(context.Background(), root, featureCommit, true); err != nil {
		t.Fatalf("cherry-pick failed: %v", err)
	}

	runGit(t, root, "branch", "topic")
	runGit(t, root, "switch", "topic")
	if err := os.WriteFile(file, []byte("name: topic\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "topic")
	if err := os.WriteFile(file, []byte("name: dirty\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := (Repository{}).Rebase(context.Background(), root, defaultBranch, true); !errors.Is(err, ErrConfirmation) {
		t.Fatalf("expected dirty rebase confirmation, got %v", err)
	}
	runGit(t, root, "checkout", "--", "project.yaml")
	if err := (Repository{}).Rebase(context.Background(), root, defaultBranch, true); err != nil {
		t.Fatalf("rebase failed: %v", err)
	}

	runGit(t, root, "switch", defaultBranch)
	runGit(t, root, "branch", "conflict-feature")
	runGit(t, root, "switch", "conflict-feature")
	if err := os.WriteFile(file, []byte("name: conflict-feature\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "conflict feature")
	runGit(t, root, "switch", defaultBranch)
	if err := os.WriteFile(file, []byte("name: main\n"), 0600); err != nil {
		t.Fatal(err)
	}
	runGit(t, root, "add", "project.yaml")
	runGit(t, root, "commit", "-q", "-m", "main conflict")
	if err := (Repository{}).Merge(context.Background(), root, "conflict-feature", true); err == nil {
		t.Fatal("expected conflicting merge to fail")
	}
	status, err := (Repository{}).Status(context.Background(), root)
	if err != nil || !status.Conflict {
		t.Fatalf("expected merge conflict status: %+v %v", status, err)
	}
	conflict, err := (Repository{}).Conflict(context.Background(), root, "project.yaml")
	if err != nil || !conflict.Base.Available || !conflict.Ours.Available || !conflict.Theirs.Available || !strings.Contains(conflict.Ours.Content, "main") || !strings.Contains(conflict.Theirs.Content, "conflict-feature") {
		t.Fatalf("unexpected conflict sides: %+v %v", conflict, err)
	}
	if abortErr := (Repository{}).Abort(context.Background(), root, "merge", true); abortErr != nil {
		t.Fatalf("merge abort failed: %v", abortErr)
	}
	status, err = (Repository{}).Status(context.Background(), root)
	if err != nil || status.Conflict {
		t.Fatalf("expected clean state after merge abort: %+v %v", status, err)
	}
	if mergeErr := (Repository{}).Merge(context.Background(), root, "conflict-feature", true); mergeErr == nil {
		t.Fatal("expected second conflicting merge to fail")
	}
	if resolveErr := (Repository{}).ResolveConflict(context.Background(), root, "project.yaml", "ours", true); resolveErr != nil {
		t.Fatalf("ours resolution failed: %v", resolveErr)
	}
	status, err = (Repository{}).Status(context.Background(), root)
	if err != nil || status.Conflict {
		t.Fatalf("expected clean state after resolving ours: %+v %v", status, err)
	}
}

func runGit(t *testing.T, root string, args ...string) {
	t.Helper()
	command := exec.CommandContext(context.Background(), "git", append([]string{"-C", root}, args...)...) //nolint:gosec // fixed Git binary and test-owned temporary root.
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}

func writeGitTestFile(t *testing.T, root, path, contents string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, path), []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
}

func runGitOutput(t *testing.T, root string, args ...string) []byte {
	t.Helper()
	command := exec.CommandContext(context.Background(), "git", append([]string{"-C", root}, args...)...) //nolint:gosec // fixed Git binary and test-owned temporary root.
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
	return output
}
