// Package git implements the native Git subprocess boundary for Studio.
package git

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
	"github.com/Liapoldus/studio/internal/domain/models"
)

var (
	ErrUnavailable       = errors.New("git is unavailable for this project")
	ErrConfirmation      = errors.New("explicit Git confirmation is required")
	ErrInvalidGitRequest = errors.New("invalid Git request")
	ErrDiffTooLarge      = errors.New("git diff exceeds Studio limit")
)

type Repository struct{}

var _ interfaces.GitRepository = Repository{}

func (Repository) Init(ctx context.Context, root string) error {
	root, err := validateRoot(root)
	if err != nil {
		return models.ErrInvalidProject
	}
	command := exec.CommandContext(ctx, "git", "-C", root, "init")
	if output, commandErr := command.CombinedOutput(); commandErr != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("git init: %w: %s", ErrUnavailable, strings.TrimSpace(string(output)))
	}
	return nil
}

func (Repository) Status(ctx context.Context, root string) (models.GitStatus, error) {
	root, err := validateRoot(root)
	if err != nil {
		return models.GitStatus{}, models.ErrInvalidProject
	}
	command := exec.CommandContext(ctx, "git", "-C", root, "status", "--porcelain=v1", "--branch")
	output, err := command.Output()
	if err != nil {
		if ctx.Err() != nil {
			return models.GitStatus{}, ctx.Err()
		}
		return models.GitStatus{}, ErrUnavailable
	}
	status := parseStatus(string(output))
	status.Available = true
	revision, revisionErr := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--short", "HEAD").Output()
	if revisionErr == nil {
		status.Revision = strings.TrimSpace(string(revision))
	}
	return status, nil
}

func (Repository) Diff(ctx context.Context, root, path string) (models.GitDiff, error) {
	root, err := validateRoot(root)
	if err != nil {
		return models.GitDiff{}, err
	}
	if path != "" {
		if pathErr := validateGitPath(path); pathErr != nil {
			return models.GitDiff{}, pathErr
		}
	}
	args := []string{"-C", root, "diff", "--no-ext-diff", "--unified=3", "--"}
	if path != "" {
		args = append(args, filepath.ToSlash(filepath.Clean(path)))
	}
	command := exec.CommandContext(ctx, "git", args...) //nolint:gosec // native Git arguments are constructed from validated project paths.
	stdout, err := command.StdoutPipe()
	if err != nil {
		return models.GitDiff{}, err
	}
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return models.GitDiff{}, err
	}
	data, readErr := io.ReadAll(io.LimitReader(stdout, 4*1024*1024+1))
	waitErr := command.Wait()
	if readErr != nil {
		return models.GitDiff{}, readErr
	}
	if waitErr != nil {
		if ctx.Err() != nil {
			return models.GitDiff{}, ctx.Err()
		}
		return models.GitDiff{}, ErrUnavailable
	}
	if len(data) > 4*1024*1024 {
		return models.GitDiff{Path: path, Patch: string(data[:4*1024*1024]), Truncated: true}, ErrDiffTooLarge
	}
	return models.GitDiff{Path: path, Patch: string(data)}, nil
}

func (Repository) Conflict(ctx context.Context, root, path string) (models.GitConflict, error) {
	root, err := validateRoot(root)
	if err != nil {
		return models.GitConflict{}, err
	}
	if pathErr := validateGitPath(path); pathErr != nil {
		return models.GitConflict{}, pathErr
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return models.GitConflict{}, err
	}
	conflicted := false
	for _, change := range status.Changes {
		if change.Path == path && isConflictChange(change) {
			conflicted = true
			break
		}
	}
	if !conflicted {
		return models.GitConflict{}, ErrInvalidGitRequest
	}
	base, err := readConflictSide(ctx, root, path, 1)
	if err != nil {
		return models.GitConflict{}, err
	}
	ours, err := readConflictSide(ctx, root, path, 2)
	if err != nil {
		return models.GitConflict{}, err
	}
	theirs, err := readConflictSide(ctx, root, path, 3)
	if err != nil {
		return models.GitConflict{}, err
	}
	return models.GitConflict{Path: path, Base: base, Ours: ours, Theirs: theirs}, nil
}

func (Repository) ResolveConflict(ctx context.Context, root, path, side string, confirm bool) error {
	root, err := validateRoot(root)
	if err != nil {
		return err
	}
	if !confirm || !validConflictSide(side) {
		return ErrConfirmation
	}
	if pathErr := validateGitPath(path); pathErr != nil {
		return pathErr
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return err
	}
	conflicted := false
	for _, change := range status.Changes {
		if change.Path == path && isConflictChange(change) {
			conflicted = true
			break
		}
	}
	if !conflicted {
		return ErrInvalidGitRequest
	}
	checkout := exec.CommandContext(ctx, "git", "-C", root, "checkout", "--"+side, "--", filepath.ToSlash(filepath.Clean(path))) //nolint:gosec // side and path are validated above.
	if output, commandErr := checkout.CombinedOutput(); commandErr != nil {
		return commandError(ctx, output, commandErr)
	}
	add := exec.CommandContext(ctx, "git", "-C", root, "add", "--", filepath.ToSlash(filepath.Clean(path))) //nolint:gosec // path is validated above.
	if output, commandErr := add.CombinedOutput(); commandErr != nil {
		return commandError(ctx, output, commandErr)
	}
	return nil
}

func (Repository) Stage(ctx context.Context, root string, paths []string, confirm bool) error {
	return runPathMutation(ctx, root, "add", paths, confirm, false)
}

func (Repository) Unstage(ctx context.Context, root string, paths []string, confirm bool) error {
	return runPathMutation(ctx, root, "restore", paths, confirm, true)
}

func runPathMutation(ctx context.Context, root, operation string, paths []string, confirm, stagedRestore bool) error {
	root, err := validateRoot(root)
	if err != nil {
		return err
	}
	if !confirm || len(paths) == 0 || len(paths) > 200 {
		return ErrConfirmation
	}
	for _, path := range paths {
		if pathErr := validateGitPath(path); pathErr != nil {
			return pathErr
		}
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return err
	}
	if status.Conflict {
		return ErrConfirmation
	}
	args := []string{"-C", root, operation}
	if stagedRestore {
		args = append(args, "--staged", "--")
	} else {
		args = append(args, "--")
	}
	args = append(args, normalizedGitPaths(paths)...)
	if output, commandErr := exec.CommandContext(ctx, "git", args...).CombinedOutput(); commandErr != nil { //nolint:gosec // operation and validated project paths are fixed.
		return commandError(ctx, output, commandErr)
	}
	return nil
}

func (Repository) CommitStaged(ctx context.Context, root, message string, confirm bool) (string, error) {
	root, err := validateRoot(root)
	if err != nil {
		return "", err
	}
	if !confirm || !validCommitMessage(message) {
		return "", ErrConfirmation
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return "", err
	}
	if status.Conflict {
		return "", ErrConfirmation
	}
	staged := false
	for _, change := range status.Changes {
		if change.IndexStatus != " " && change.IndexStatus != "?" {
			staged = true
			break
		}
	}
	if !staged {
		return "", ErrInvalidGitRequest
	}
	if output, commandErr := exec.CommandContext(ctx, "git", "-C", root, "commit", "-m", message).CombinedOutput(); commandErr != nil {
		return "", commandError(ctx, output, commandErr)
	}
	revision, err := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return "", ErrUnavailable
	}
	return strings.TrimSpace(string(revision)), nil
}

func (Repository) Stashes(ctx context.Context, root string, limit int) ([]models.GitStash, error) {
	root, err := validateRoot(root)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidGitRequest
	}
	format := "%gd%x00%aI%x00%gs"
	output, err := exec.CommandContext(ctx, "git", "-C", root, "stash", "list", "-n", strconv.Itoa(limit), "--format="+format).Output() //nolint:gosec // limit is bounded before becoming an argument.
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrUnavailable
	}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	stashes := make([]models.GitStash, 0, limit)
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\x00", 3)
		if len(parts) != 3 || !validStashRef(parts[0]) {
			return nil, ErrUnavailable
		}
		stashes = append(stashes, models.GitStash{Ref: parts[0], CreatedAt: parts[1], Message: parts[2]})
	}
	return stashes, nil
}

func (Repository) Stash(ctx context.Context, root, message string, includeUntracked, confirm bool) (string, error) {
	root, err := validateRoot(root)
	if err != nil {
		return "", err
	}
	if !confirm || !validCommitMessage(message) {
		return "", ErrConfirmation
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return "", err
	}
	if !status.Dirty || status.Conflict {
		return "", ErrInvalidGitRequest
	}
	args := []string{"-C", root, "stash", "push", "--message", message}
	if includeUntracked {
		args = append(args, "--include-untracked")
	}
	if output, commandErr := exec.CommandContext(ctx, "git", args...).CombinedOutput(); commandErr != nil { //nolint:gosec // message is validated and passed as one argument.
		return "", commandError(ctx, output, commandErr)
	}
	stashes, err := (Repository{}).Stashes(ctx, root, 1)
	if err != nil || len(stashes) == 0 {
		return "", ErrUnavailable
	}
	return stashes[0].Ref, nil
}

func (Repository) ApplyStash(ctx context.Context, root string, index int, drop, confirm bool) error {
	root, err := validateRoot(root)
	if err != nil {
		return err
	}
	if !confirm || index < 0 || index > 9999 {
		return ErrConfirmation
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return err
	}
	if status.Dirty || status.Conflict {
		return ErrConfirmation
	}
	ref := stashRef(index)
	if output, commandErr := exec.CommandContext(ctx, "git", "-C", root, "stash", "apply", "--index", ref).CombinedOutput(); commandErr != nil { //nolint:gosec // index is range-validated.
		return commandError(ctx, output, commandErr)
	}
	if drop {
		if output, commandErr := exec.CommandContext(ctx, "git", "-C", root, "stash", "drop", ref).CombinedOutput(); commandErr != nil { //nolint:gosec // index is range-validated.
			return commandError(ctx, output, commandErr)
		}
	}
	return nil
}

func validCommitMessage(message string) bool {
	return strings.TrimSpace(message) != "" && len(message) <= 5000 && !strings.ContainsAny(message, "\x00\r\n")
}

func validStashRef(ref string) bool {
	return strings.HasPrefix(ref, "stash@{") && strings.HasSuffix(ref, "}") && len(ref) > len("stash@{}") && strings.Trim(ref[len("stash@{"):len(ref)-1], "0123456789") == ""
}

func stashRef(index int) string {
	return fmt.Sprintf("stash@{%d}", index)
}

const maxConflictBlobBytes = 1 << 20

func readConflictSide(ctx context.Context, root, path string, stage int) (models.GitConflictSide, error) {
	command := exec.CommandContext(ctx, "git", "-C", root, "show", fmt.Sprintf(":%d:%s", stage, filepath.ToSlash(filepath.Clean(path)))) //nolint:gosec // stage is internal and path is validated by the caller.
	stdout, err := command.StdoutPipe()
	if err != nil {
		return models.GitConflictSide{}, err
	}
	if err := command.Start(); err != nil {
		if ctx.Err() != nil {
			return models.GitConflictSide{}, ctx.Err()
		}
		return models.GitConflictSide{}, nil
	}
	data, readErr := io.ReadAll(io.LimitReader(stdout, maxConflictBlobBytes+1))
	waitErr := command.Wait()
	if readErr != nil {
		return models.GitConflictSide{}, readErr
	}
	if waitErr != nil {
		if ctx.Err() != nil {
			return models.GitConflictSide{}, ctx.Err()
		}
		return models.GitConflictSide{}, nil
	}
	truncated := len(data) > maxConflictBlobBytes
	if truncated {
		data = data[:maxConflictBlobBytes]
	}
	return models.GitConflictSide{Available: true, Content: string(data), Truncated: truncated}, nil
}

func validConflictSide(side string) bool {
	return side == "ours" || side == "theirs"
}

func isConflictChange(change models.GitChange) bool {
	return change.IndexStatus == "U" || change.WorktreeStatus == "U" || change.IndexStatus == "A" && change.WorktreeStatus == "A" || change.IndexStatus == "D" && change.WorktreeStatus == "D"
}

func (Repository) Branches(ctx context.Context, root string) ([]models.GitBranch, error) {
	root, err := validateRoot(root)
	if err != nil {
		return nil, err
	}
	output, err := exec.CommandContext(ctx, "git", "-C", root, "for-each-ref", "--format=%(refname:short)\t%(upstream:short)\t%(HEAD)", "refs/heads").Output()
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrUnavailable
	}
	branches := make([]models.GitBranch, 0)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 {
			return nil, ErrUnavailable
		}
		branches = append(branches, models.GitBranch{Name: parts[0], Remote: parts[1], Current: parts[2] == "*"})
	}
	return branches, nil
}

func (Repository) History(ctx context.Context, root string, limit int) ([]models.GitCommit, error) {
	root, err := validateRoot(root)
	if err != nil {
		return nil, err
	}
	if limit < 1 || limit > 100 {
		return nil, ErrInvalidGitRequest
	}
	format := "%H%x09%h%x09%an%x09%aI%x09%s"
	output, err := exec.CommandContext(ctx, "git", "-C", root, "log", "--no-decorate", "--date=iso-strict", "-n", strconv.Itoa(limit), "--pretty=format:"+format, "--").Output() //nolint:gosec // limit is bounded above and below before it becomes an argument.
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrUnavailable
	}
	commits := make([]models.GitCommit, 0, limit)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 5)
		if len(parts) != 5 {
			return nil, ErrUnavailable
		}
		commits = append(commits, models.GitCommit{Hash: parts[0], ShortHash: parts[1], Author: parts[2], Timestamp: parts[3], Subject: parts[4]})
	}
	return commits, nil
}

func (Repository) Remotes(ctx context.Context, root string) ([]models.GitRemote, error) {
	root, err := validateRoot(root)
	if err != nil {
		return nil, err
	}
	output, err := exec.CommandContext(ctx, "git", "-C", root, "remote", "-v").Output()
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrUnavailable
	}
	byName := make(map[string]*models.GitRemote)
	order := make([]string, 0)
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 3 {
			continue
		}
		name := parts[0]
		remote, exists := byName[name]
		if !exists {
			remote = &models.GitRemote{Name: name}
			byName[name] = remote
			order = append(order, name)
		}
		redacted := redactRemoteURL(parts[1])
		if parts[2] == "(push)" {
			remote.PushURL = redacted
		} else {
			remote.FetchURL = redacted
		}
	}
	remotes := make([]models.GitRemote, 0, len(order))
	for _, name := range order {
		remotes = append(remotes, *byName[name])
	}
	return remotes, nil
}

func (Repository) Checkout(ctx context.Context, root, branch string, confirm bool) error {
	root, err := validateRoot(root)
	if err != nil {
		return err
	}
	if !confirm || !validGitToken(branch) {
		return ErrConfirmation
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return err
	}
	if status.Dirty || status.Conflict {
		return ErrConfirmation
	}
	if output, err := exec.CommandContext(ctx, "git", "-C", root, "switch", "--", branch).CombinedOutput(); err != nil {
		return commandError(ctx, output, err)
	}
	return nil
}

func (Repository) Commit(ctx context.Context, root, message string, paths []string, confirm bool) (string, error) {
	root, err := validateRoot(root)
	if err != nil {
		return "", err
	}
	if !confirm || strings.TrimSpace(message) == "" || strings.ContainsRune(message, '\x00') || len(message) > 5000 || len(paths) == 0 {
		return "", ErrConfirmation
	}
	for _, path := range paths {
		if pathErr := validateGitPath(path); pathErr != nil {
			return "", pathErr
		}
	}
	addArgs := []string{"-C", root, "add", "--"}
	addArgs = append(addArgs, normalizedGitPaths(paths)...)
	if output, addErr := exec.CommandContext(ctx, "git", addArgs...).CombinedOutput(); addErr != nil { //nolint:gosec // native Git arguments are validated path scopes.
		return "", commandError(ctx, output, addErr)
	}
	commitArgs := []string{"-C", root, "commit", "-m", message, "--"}
	commitArgs = append(commitArgs, normalizedGitPaths(paths)...)
	if output, commitErr := exec.CommandContext(ctx, "git", commitArgs...).CombinedOutput(); commitErr != nil { //nolint:gosec // native Git arguments are validated path scopes.
		return "", commandError(ctx, output, commitErr)
	}
	revision, err := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return "", ErrUnavailable
	}
	return strings.TrimSpace(string(revision)), nil
}

func (Repository) Pull(ctx context.Context, root, remote, branch string, confirm bool) error {
	return runRemote(ctx, root, "pull", remote, branch, confirm)
}

func (Repository) Push(ctx context.Context, root, remote, branch string, confirm bool) error {
	return runRemote(ctx, root, "push", remote, branch, confirm)
}

func (Repository) Merge(ctx context.Context, root, branch string, confirm bool) error {
	return runLocalHistoryOperation(ctx, root, "merge", branch, confirm)
}

func (Repository) Rebase(ctx context.Context, root, branch string, confirm bool) error {
	return runLocalHistoryOperation(ctx, root, "rebase", branch, confirm)
}

func (Repository) CherryPick(ctx context.Context, root, commit string, confirm bool) error {
	return runLocalHistoryOperation(ctx, root, "cherry-pick", commit, confirm)
}

func (Repository) Abort(ctx context.Context, root, operation string, confirm bool) error {
	root, err := validateRoot(root)
	if err != nil {
		return err
	}
	if !confirm || !isHistoryOperation(operation) {
		return ErrConfirmation
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return err
	}
	if !status.Conflict {
		return ErrInvalidGitRequest
	}
	command := exec.CommandContext(ctx, "git", "-C", root, operation, "--abort")
	if output, commandErr := command.CombinedOutput(); commandErr != nil {
		return commandError(ctx, output, commandErr)
	}
	return nil
}

func runLocalHistoryOperation(ctx context.Context, root, operation, target string, confirm bool) error {
	root, err := validateRoot(root)
	if err != nil {
		return err
	}
	if !confirm || !isHistoryOperation(operation) || !validGitToken(target) {
		return ErrConfirmation
	}
	status, err := (Repository{}).Status(ctx, root)
	if err != nil {
		return err
	}
	if status.Dirty || status.Conflict {
		return ErrConfirmation
	}
	args := []string{"-C", root, operation}
	if operation == "merge" {
		args = append(args, "--no-edit")
	}
	args = append(args, "--", target)
	command := exec.CommandContext(ctx, "git", args...) //nolint:gosec // operation and target are validated before becoming arguments.
	if output, commandErr := command.CombinedOutput(); commandErr != nil {
		return commandError(ctx, output, commandErr)
	}
	return nil
}

func isHistoryOperation(operation string) bool {
	return operation == "merge" || operation == "rebase" || operation == "cherry-pick"
}

func runRemote(ctx context.Context, root, operation, remote, branch string, confirm bool) error {
	root, err := validateRoot(root)
	if err != nil {
		return err
	}
	if !confirm || !validGitToken(remote) || !validGitToken(branch) {
		return ErrConfirmation
	}
	if output, err := exec.CommandContext(ctx, "git", "-C", root, operation, remote, branch).CombinedOutput(); err != nil {
		return commandError(ctx, output, err)
	}
	return nil
}

func validateRoot(root string) (string, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) || strings.ContainsRune(root, '\x00') {
		return "", models.ErrInvalidProject
	}
	return root, nil
}

func validateGitPath(path string) error {
	if strings.TrimSpace(path) == "" || strings.ContainsRune(path, '\x00') || filepath.IsAbs(path) || strings.HasPrefix(path, "-") {
		return ErrInvalidGitRequest
	}
	clean := filepath.Clean(path)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".git" || strings.HasPrefix(clean, ".git"+string(filepath.Separator)) || clean == ".studio" || strings.HasPrefix(clean, ".studio"+string(filepath.Separator)) {
		return ErrInvalidGitRequest
	}
	return nil
}

func normalizedGitPaths(paths []string) []string {
	result := make([]string, len(paths))
	for index, path := range paths {
		if path == "." {
			result[index] = "."
			continue
		}
		result[index] = filepath.ToSlash(filepath.Clean(path))
	}
	return result
}

func validGitToken(value string) bool {
	if strings.TrimSpace(value) == "" || strings.ContainsRune(value, '\x00') || strings.ContainsAny(value, " \t\r\n:@?#") || strings.HasPrefix(value, "-") {
		return false
	}
	return true
}

func redactRemoteURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return models.RedactText(raw)
	}
	parsed.User = nil
	query := parsed.Query()
	for key := range query {
		if strings.Contains(strings.ToLower(key), "token") || strings.Contains(strings.ToLower(key), "password") || strings.Contains(strings.ToLower(key), "secret") {
			query.Del(key)
		}
	}
	parsed.RawQuery = query.Encode()
	parsed.Fragment = ""
	return models.RedactText(parsed.String())
}

func commandError(ctx context.Context, _ []byte, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return ErrUnavailable
	}
	return nil
}

func parseStatus(output string) models.GitStatus {
	status := models.GitStatus{}
	scanner := bufio.NewScanner(strings.NewReader(output))
	if scanner.Scan() {
		status.Branch = branchName(strings.TrimSpace(scanner.Text()))
	}
	status.Changes = make([]models.GitChange, 0)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "## ") || len(line) < 3 {
			continue
		}
		path := strings.TrimSpace(line[3:])
		if arrow := strings.LastIndex(path, " -> "); arrow >= 0 {
			path = strings.TrimSpace(path[arrow+4:])
		}
		status.Changes = append(status.Changes, models.GitChange{
			Path:           path,
			IndexStatus:    string(line[0]),
			WorktreeStatus: string(line[1]),
		})
		if line[0] == 'U' || line[1] == 'U' || line[0] == 'A' && line[1] == 'A' || line[0] == 'D' && line[1] == 'D' {
			status.Conflict = true
		}
	}
	status.Dirty = len(status.Changes) > 0
	return status
}

func branchName(header string) string {
	header = strings.TrimPrefix(header, "## ")
	if strings.HasPrefix(header, "No commits yet on ") {
		return strings.TrimPrefix(header, "No commits yet on ")
	}
	if strings.HasPrefix(header, "HEAD (") {
		return "HEAD"
	}
	if index := strings.Index(header, "..."); index >= 0 {
		header = header[:index]
	}
	if index := strings.Index(header, " ["); index >= 0 {
		header = header[:index]
	}
	return strings.TrimSpace(header)
}
