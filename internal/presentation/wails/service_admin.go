package wails

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"path/filepath"
	"strings"
	"time"

	"github.com/Liapoldus/studio/internal/domain/models"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const maxRuntimeAdminActionBytes = 1 << 20

type runtimeAdminSurface struct {
	ServiceID  string                 `json:"serviceId"`
	Digest     string                 `json:"digest"`
	Descriptor runtimeAdminDescriptor `json:"descriptor"`
}

type runtimeAdminDescriptor struct {
	Service string             `json:"service"`
	Pages   []runtimeAdminPage `json:"pages"`
	Version int                `json:"version"`
}

type runtimeAdminPage struct {
	ID       string                `json:"id"`
	Sections []runtimeAdminSection `json:"sections"`
}

type runtimeAdminSection struct {
	ID            string               `json:"id"`
	Kind          string               `json:"kind"`
	QueryResource string               `json:"queryResource"`
	Columns       []string             `json:"columns"`
	Actions       []runtimeAdminAction `json:"actions"`
}

type runtimeAdminAction struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Confirmation string `json:"confirmation"`
	IfMatchField string `json:"ifMatchField"`
	Dangerous    bool   `json:"dangerous"`
}

// ReadRuntimeServiceAdminTable queries one descriptor-declared table through
// the typed CLI. Core remains the only client of the service SDK.
func (a *App) ReadRuntimeServiceAdminTable(projectID, serviceID, pageID, sectionID, surfaceDigest, cursor string) (string, error) {
	if a.workspace == nil || a.cli == nil || !safeProjectResourceID(serviceID) || !safeProjectResourceID(pageID) ||
		!safeProjectResourceID(sectionID) || !validRuntimeAdminDigestFormat(surfaceDigest) || len(cursor) > 1024 || strings.ContainsAny(cursor, "\x00\r\n") {
		return "", errInvalidProjectResource
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil || workspace.Project == nil || workspace.Project.ID != projectID || !workspaceHasService(workspace, serviceID) {
		return "", models.ErrInvalidProject
	}
	surface, err := a.readRuntimeAdminSurface(workspace, serviceID)
	if err != nil {
		return "", err
	}
	if surface.Digest != surfaceDigest {
		return "", errors.New("bridge.admin_surface_changed")
	}
	columns, found := surface.table(pageID, sectionID)
	if !found {
		return "", errInvalidProjectResource
	}
	result, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.admin.query", Target: "local", ServiceID: serviceID, PageID: pageID, SectionID: sectionID, Cursor: cursor, Digest: surface.Digest,
	}, 30*time.Second)
	if err != nil {
		return "", err
	}
	var response struct {
		ServiceID string          `json:"serviceId"`
		PageID    string          `json:"pageId"`
		SectionID string          `json:"sectionId"`
		Data      json.RawMessage `json:"data"`
	}
	if len(result) == 0 || len(result) > maxRuntimeAdminActionBytes || json.Unmarshal(result, &response) != nil ||
		response.ServiceID != serviceID || response.PageID != pageID || response.SectionID != sectionID {
		return "", errors.New("core returned an invalid service administration table")
	}
	sanitized, valid := sanitizeRuntimeAdminTableData(response.Data, columns)
	if !valid {
		return "", errors.New("core returned an invalid service administration table")
	}
	return string(sanitized), nil
}

// InvokeRuntimeServiceAdminAction stages only bounded, non-secret action input
// in a private Project temp file, then invokes the exact live descriptor action
// through the typed CLI. A changed descriptor or context aborts the operation.
func (a *App) InvokeRuntimeServiceAdminAction(projectID, serviceID, pageID, sectionID, actionID, inputJSON, ifMatch, surfaceDigest string) (string, error) {
	return a.invokeRuntimeServiceAdminAction(projectID, serviceID, pageID, sectionID, actionID, inputJSON, ifMatch, surfaceDigest, func(ctx context.Context, title, message string) (bool, error) {
		result, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: title, Message: message, Buttons: []string{"Отмена", "Продолжить"}, DefaultButton: "Отмена", CancelButton: "Отмена"})
		return result == "Продолжить", err
	})
}

func (a *App) invokeRuntimeServiceAdminAction(projectID, serviceID, pageID, sectionID, actionID, inputJSON, ifMatch, surfaceDigest string, confirm func(context.Context, string, string) (bool, error)) (result string, resultErr error) {
	if a.workspace == nil || a.cli == nil || confirm == nil || !safeProjectResourceID(serviceID) || !safeProjectResourceID(pageID) ||
		!safeProjectResourceID(sectionID) || !safeProjectResourceID(actionID) || len(inputJSON) < 2 || len(inputJSON) > maxRuntimeAdminActionBytes ||
		len(ifMatch) > 512 || strings.ContainsAny(ifMatch, "\x00\r\n") || len(surfaceDigest) != len("sha256:")+64 || !strings.HasPrefix(surfaceDigest, "sha256:") {
		return "", errInvalidProjectResource
	}
	input := []byte(inputJSON)
	if !safeServiceActionMetadata(input) {
		return "", errInvalidProjectResource
	}
	workspace, err := a.workspace.OpenByID(a.context(), projectID)
	if err != nil || workspace.Project == nil || workspace.Project.ID != projectID || !workspaceHasService(workspace, serviceID) {
		return "", models.ErrInvalidProject
	}
	surface, err := a.readRuntimeAdminSurface(workspace, serviceID)
	if err != nil {
		return "", err
	}
	if surface.Digest != surfaceDigest {
		return "", errors.New("bridge.admin_surface_changed")
	}
	action, found := surface.action(pageID, sectionID, actionID)
	if !found {
		return "", errInvalidProjectResource
	}
	if action.IfMatchField != "" {
		var values map[string]any
		if json.Unmarshal(input, &values) != nil || values == nil {
			return "", errInvalidProjectResource
		}
		value, ok := values[action.IfMatchField].(string)
		if !ok || strings.TrimSpace(value) == "" || ifMatch != "" && ifMatch != value {
			return "", errInvalidProjectResource
		}
		ifMatch = value
	} else if ifMatch == "" {
		ifMatch = "*"
	}
	if action.Dangerous || strings.TrimSpace(action.Confirmation) != "" {
		message := strings.TrimSpace(action.Confirmation)
		if message == "" {
			message = "Выполнить действие сервиса?"
		}
		message = fmt.Sprintf("%s\n\nПроект: %s\nСервис: %s", message, workspace.Project.Name, serviceID)
		confirmed, confirmErr := confirm(a.context(), "Подтвердите действие сервиса", message)
		if confirmErr != nil {
			return "", confirmErr
		}
		if !confirmed {
			return "", errors.New("bridge.action_cancelled")
		}
	}
	requestPath, cleanup, err := stageServiceActionMetadata(workspace.Project.RootPath, input)
	if err != nil {
		return "", err
	}
	defer func() {
		if cleanupErr := cleanup(); cleanupErr != nil {
			resultErr = errors.Join(resultErr, cleanupErr)
		}
	}()
	requestPath = filepath.Join(workspace.Project.RootPath, filepath.FromSlash(requestPath))
	var keyBytes [16]byte
	if _, err = rand.Read(keyBytes[:]); err != nil {
		return "", errors.New("could not create service action key")
	}
	request, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.admin.action.invoke", Target: "local", ServiceID: serviceID, PageID: pageID, Digest: surface.Digest,
		SectionID: sectionID, ActionID: actionID, RequestFilePath: requestPath, IfMatch: ifMatch,
		IdempotencyKey: "studio-admin-" + hex.EncodeToString(keyBytes[:]),
	}, 2*time.Minute)
	if err != nil {
		return "", err
	}
	var completed struct {
		Completed bool `json:"completed"`
	}
	var completionFields map[string]json.RawMessage
	if len(request) == 0 || len(request) > 4096 || json.Unmarshal(request, &completed) != nil || !completed.Completed ||
		json.Unmarshal(request, &completionFields) != nil || len(completionFields) != 1 {
		return "", errors.New("service action returned an invalid completion result")
	}
	return `{"completed":true}`, nil
}

func (a *App) readRuntimeAdminSurface(workspace models.Workspace, serviceID string) (runtimeAdminSurface, error) {
	encoded, err := a.runCLIJSONInWorkspaceWithTimeout(workspace, models.CLIIntent{
		Command: "service.admin-surface.inspect", Target: "local", ServiceID: serviceID,
	}, 12*time.Second)
	if err != nil {
		return runtimeAdminSurface{}, err
	}
	var response struct {
		ServiceID  string          `json:"serviceId"`
		Digest     string          `json:"digest"`
		Descriptor json.RawMessage `json:"descriptor"`
	}
	if len(encoded) == 0 || len(encoded) > maxRuntimeAdminActionBytes || json.Unmarshal(encoded, &response) != nil {
		return runtimeAdminSurface{}, errors.New("core returned an invalid service administration surface envelope")
	}
	if response.ServiceID != serviceID || !validRuntimeAdminDigestFormat(response.Digest) {
		return runtimeAdminSurface{}, errors.New("core returned an invalid service administration surface digest")
	}
	var descriptor runtimeAdminDescriptor
	if json.Unmarshal(response.Descriptor, &descriptor) != nil || descriptor.Service != serviceID || descriptor.Version != 1 || len(descriptor.Pages) == 0 {
		return runtimeAdminSurface{}, errors.New("core returned an invalid service administration descriptor")
	}
	surface := runtimeAdminSurface{ServiceID: response.ServiceID, Digest: response.Digest, Descriptor: descriptor}
	return surface, nil
}

func validRuntimeAdminDigestFormat(digest string) bool {
	if len(digest) != len("sha256:")+64 || !strings.HasPrefix(digest, "sha256:") || strings.ToLower(digest) != digest {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(digest, "sha256:"))
	return err == nil
}

func sanitizeRuntimeAdminTableData(raw json.RawMessage, columns []string) (json.RawMessage, bool) {
	var data struct {
		NextCursor string           `json:"nextCursor"`
		Items      []map[string]any `json:"items"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if len(raw) == 0 || len(raw) > maxRuntimeAdminActionBytes || decoder.Decode(&data) != nil || data.Items == nil || len(data.Items) > 100 || len(columns) == 0 || len(columns) > 128 {
		return nil, false
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF || len(data.NextCursor) > 1024 || strings.ContainsAny(data.NextCursor, "\x00\r\n") {
		return nil, false
	}
	allowed := make(map[string]bool, len(columns))
	for _, column := range columns {
		if !safeProjectResourceID(column) || sensitiveAdminColumn(column) || allowed[column] {
			return nil, false
		}
		allowed[column] = true
	}
	rows := make([]map[string]any, len(data.Items))
	for index, row := range data.Items {
		if row == nil || len(row) > 128 {
			return nil, false
		}
		sanitizedRow := make(map[string]any, len(allowed))
		for column, cell := range row {
			if !allowed[column] {
				continue
			}
			if !validRuntimeAdminCell(cell) {
				return nil, false
			}
			sanitizedRow[column] = cell
		}
		rows[index] = sanitizedRow
	}
	var nextCursor *string
	if data.NextCursor != "" {
		nextCursor = &data.NextCursor
	}
	result, err := json.Marshal(map[string]any{"items": rows, "nextCursor": nextCursor})
	if err != nil || len(result) > maxRuntimeAdminActionBytes {
		return nil, false
	}
	return result, true
}

func validRuntimeAdminCell(value any) bool {
	switch cell := value.(type) {
	case nil, bool:
		return true
	case string:
		return len(cell) <= 4096 && !strings.ContainsAny(cell, "\x00\r\n")
	case json.Number:
		number, err := cell.Float64()
		return err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	default:
		return false
	}
}

func sensitiveAdminColumn(value string) bool {
	lower := strings.ToLower(value)
	for _, marker := range []string{"secret", "password", "passwd", "token", "privatekey", "private_key", "credential", "authorization", "authkey"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func (surface runtimeAdminSurface) table(pageID, sectionID string) ([]string, bool) {
	for _, page := range surface.Descriptor.Pages {
		if page.ID != pageID {
			continue
		}
		for _, section := range page.Sections {
			if section.ID == sectionID && section.Kind == "table" && safeProjectResourceID(section.QueryResource) && len(section.Columns) > 0 {
				return append([]string(nil), section.Columns...), true
			}
		}
	}
	return nil, false
}

func (surface runtimeAdminSurface) action(pageID, sectionID, actionID string) (runtimeAdminAction, bool) {
	for _, page := range surface.Descriptor.Pages {
		if page.ID != pageID {
			continue
		}
		for _, section := range page.Sections {
			if section.ID != sectionID {
				continue
			}
			for _, action := range section.Actions {
				if action.ID == actionID {
					return action, true
				}
			}
		}
	}
	return runtimeAdminAction{}, false
}
