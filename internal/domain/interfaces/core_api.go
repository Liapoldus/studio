package interfaces

import (
	"context"

	"github.com/Liapoldus/studio/internal/domain/models"
)

type CoreAPI interface {
	CheckAvailability(context.Context, models.CoreConnection) error
}
