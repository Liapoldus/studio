// Package web serves the Studio shell and its read-only local API.
package web

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/Liapoldus/studio/internal/application/product"
)

type Server struct {
	productInfo *product.ProductInfo
	static      http.Handler
	projectRoot string
}

func NewServer(productInfo *product.ProductInfo, assets fs.FS) http.Handler {
	return NewServerAtProject(productInfo, assets, "")
}

func NewServerAtProject(productInfo *product.ProductInfo, assets fs.FS, projectRoot string) http.Handler {
	return &Server{
		productInfo: productInfo,
		static:      http.FileServer(http.FS(assets)),
		projectRoot: projectRoot,
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
	case "/api/v1/workspace":
		s.workspace(w, r)
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

func (s *Server) workspace(response http.ResponseWriter, request *http.Request) {
	type fileEntry struct {
		Path  string `json:"path"`
		Kind  string `json:"kind"`
		Bytes int64  `json:"bytes,omitempty"`
	}
	result := struct {
		Project *struct {
			Name string `json:"name"`
		} `json:"project"`
		Files []fileEntry `json:"files"`
	}{Files: []fileEntry{}}
	if s.projectRoot == "" {
		writeWorkspace(response, result)
		return
	}
	if info, err := os.Stat(s.projectRoot); err != nil || !info.IsDir() {
		http.Error(response, "project workspace unavailable", http.StatusServiceUnavailable)
		return
	} else {
		result.Project = &struct {
			Name string `json:"name"`
		}{Name: info.Name()}
	}
	count := 0
	err := filepath.Walk(s.projectRoot, func(filePath string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, _ := filepath.Rel(s.projectRoot, filePath)
		if rel == "." {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if info.IsDir() {
			if rel == ".git" || rel == ".studio" || strings.HasPrefix(rel, ".git/") || strings.HasPrefix(rel, ".studio/") {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(rel, ".key") || strings.HasSuffix(rel, ".pem") {
			return nil
		}
		if count >= 5000 {
			return filepath.SkipAll
		}
		kind := "file"
		if info.Mode()&os.ModeSymlink != 0 {
			kind = "link"
		}
		result.Files = append(result.Files, fileEntry{Path: rel, Kind: kind, Bytes: info.Size()})
		count++
		return nil
	})
	if err != nil {
		http.Error(response, "project workspace unavailable", http.StatusServiceUnavailable)
		return
	}
	writeWorkspace(response, result)
}

func writeWorkspace(response http.ResponseWriter, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(response).Encode(value)
}
