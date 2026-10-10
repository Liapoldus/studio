// Package git implements the native Git subprocess boundary for Studio.
package git

import (
	"bufio"
	"context"
	"errors"
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
