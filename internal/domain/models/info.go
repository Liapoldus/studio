package models

type ProductInfo struct {
	Name              string   `json:"name"`
	Description       string   `json:"description"`
	CoreAccessModes   []string `json:"coreAccessModes"`
	SingleCoreBinding bool     `json:"singleCoreBinding"`
}

func NewProductInfo(name, description string, accessModes []string, singleCoreBinding bool) (ProductInfo, error) {
	if name == "" || description == "" || len(accessModes) == 0 {
		return ProductInfo{}, ErrInvalidProductInfo
	}

	modes := append([]string(nil), accessModes...)
	return ProductInfo{
		Name:              name,
		Description:       description,
		CoreAccessModes:   modes,
		SingleCoreBinding: singleCoreBinding,
	}, nil
}
