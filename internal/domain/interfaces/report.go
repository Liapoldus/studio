package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type ReportStore interface {
	Save(context.Context, string, models.Report, []models.RedactionAnnotation) (string, error)
	List(context.Context, string) ([]models.Report, error)
}
