package web

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"testing/fstest"

	"github.com/Liapoldus/studio/internal/application/product"
	"github.com/Liapoldus/studio/internal/domain/models"
	productdata "github.com/Liapoldus/studio/internal/infrastructure/product"
)

func TestReadOnlyShell(t *testing.T) {
	server := NewServer(product.NewProductInfo(productdata.NewStaticReader(true, models.CoreAccessDirect)),
		fstest.MapFS{"index.web.html": {Data: []byte("Studio shell")}})
	for _, test := range []struct {
		method string
		path   string
		status int
	}{
		{http.MethodGet, "/api/v1/product-info", http.StatusOK},
		{http.MethodPost, "/api/v1/product-info", http.StatusMethodNotAllowed},
		{http.MethodGet, "/healthz", http.StatusNoContent},
		{http.MethodGet, "/api/v1/connections", http.StatusNotFound},
		{http.MethodGet, "/", http.StatusOK},
		{http.MethodGet, "/connections", http.StatusOK},
		{http.MethodGet, "/missing.js", http.StatusNotFound},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			server.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
			if response.Code != test.status {
				t.Fatalf("status %d; want %d", response.Code, test.status)
			}
			if test.path == "/api/v1/product-info" && test.method == http.MethodGet {
				var value models.ProductInfo
				if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
					t.Fatal(err)
				}
				if value.Name != "Liapoldus Studio" || !value.SingleCoreBinding || !reflect.DeepEqual(value.CoreAccessModes, []string{"direct"}) {
					t.Fatalf("web contract: %+v", value)
				}
				if response.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("product information must not be cached")
				}
			}
		})
	}
}

type failingReader struct{}

func (failingReader) Read(context.Context) (models.ProductInfo, error) {
	return models.ProductInfo{}, errors.New("private internal failure")
}

func TestUnavailableProductInfo(t *testing.T) {
	server := NewServer(product.NewProductInfo(failingReader{}), fstest.MapFS{})
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/product-info", nil))
	if response.Code != http.StatusServiceUnavailable || response.Body.String() != "product information unavailable\n" {
		t.Fatalf("failure leaked or status changed: %d %s", response.Code, response.Body.String())
	}
}
