// Package web serves the Studio shell and its read-only local API.
package web

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"path"
	"strings"

	"github.com/Liapoldus/studio/internal/application/product"
)

type Server struct {
	productInfo *product.ProductInfo
	static      http.Handler
}

func NewServer(productInfo *product.ProductInfo, assets fs.FS) http.Handler {
	return &Server{
		productInfo: productInfo,
		static:      http.FileServer(http.FS(assets)),
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	switch r.URL.Path {
	case "/api/v1/product-info":
		value, err := s.productInfo.Execute(r.Context())
		if err != nil {
			http.Error(w, "product information unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if err := json.NewEncoder(w).Encode(value); err != nil {
			log.Print("Studio product information response failed")
		}
		return
	case "/healthz":
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}

	cleanPath := path.Clean("/" + r.URL.Path)
	if cleanPath == "/" || path.Ext(cleanPath) == "" {
		r.URL.Path = "/index.web.html"
	}
	s.static.ServeHTTP(w, r)
}
