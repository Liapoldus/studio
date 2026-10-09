package models

type ProductInfo struct {
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	WorkspaceFeatures []string `json:"workspaceFeatures"`
}

func NewProductInfo(name, description string, features []string) (ProductInfo, error) {
	if name == "" || description == "" || len(features) == 0 {
		return ProductInfo{}, ErrInvalidProductInfo
	}

	workspaceFeatures := append([]string(nil), features...)
	return ProductInfo{
		Name:              name,
		Description:       description,
		WorkspaceFeatures: workspaceFeatures,
	}, nil
}
