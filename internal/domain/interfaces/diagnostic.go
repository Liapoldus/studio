package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type DiagnosticStore interface {
	Append(context.Context, string, models.Diagnostic) error
	List(context.Context, string) ([]models.Diagnostic, error)
}
