package wails

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/Liapoldus/studio/internal/domain/interfaces"
)

type studioPluginSurfaceAssetReader interface {
	SurfaceAsset(context.Context, string, string, string, string) ([]byte, string, error)
}

type studioPluginAssetHandler struct {
	plugins studioPluginSurfaceAssetReader
}

// NewPluginAssetHandler serves only verified assets declared by installed
// Studio-plugin page/panel surfaces. It is an HTTP adapter, not a Wails-bound
// App method, so transport types never leak into generated frontend bindings.
func NewPluginAssetHandler(plugins interfaces.StudioPluginHost) http.Handler {
	return studioPluginAssetHandler{plugins: plugins}
}

func (handler studioPluginAssetHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	serveStudioPluginAsset(writer, request, handler.plugins)
}

func serveStudioPluginAsset(writer http.ResponseWriter, request *http.Request, plugins studioPluginSurfaceAssetReader) {
	const prefix = "/studio-plugin-assets/"
	if request.Method != http.MethodGet && request.Method != http.MethodHead {
		writer.Header().Set("Allow", "GET, HEAD")
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	escapedPath := request.URL.EscapedPath()
	if !strings.HasPrefix(escapedPath, prefix) || plugins == nil {
		http.NotFound(writer, request)
		return
	}
	parts := strings.Split(strings.TrimPrefix(escapedPath, prefix), "/")
	if len(parts) < 4 {
		http.NotFound(writer, request)
		return
	}
	decoded := make([]string, len(parts))
	for index, part := range parts {
		value, err := url.PathUnescape(part)
		if err != nil || value == "" || value == "." || value == ".." || strings.ContainsAny(value, "/\\:\x00") {
			http.NotFound(writer, request)
			return
		}
		decoded[index] = value
	}
	assetPath := strings.Join(decoded[3:], "/")
	data, contentType, err := plugins.SurfaceAsset(request.Context(), decoded[0], decoded[1], decoded[2], assetPath)
	if err != nil {
		http.NotFound(writer, request)
		return
	}
	writer.Header().Set("Content-Type", contentType)
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("Referrer-Policy", "no-referrer")
	// Modules loaded from a sandboxed iframe use the serialized opaque origin
	// "null" and CORS mode. Grant only that origin so the isolated plugin UI can
	// load its declared ES-module assets; package contents are public UI code,
	// while all privileged operations remain behind the typed host bridge.
	if request.Header.Get("Origin") == "null" {
		writer.Header().Set("Access-Control-Allow-Origin", "null")
		writer.Header().Add("Vary", "Origin")
	}
	if strings.HasPrefix(contentType, "text/html") {
		// Studio plugin surfaces run in an opaque-origin sandbox. In that context
		// CSP 'self' is the opaque origin, not the Wails asset origin serving the
		// verified package files, so external module scripts are otherwise blocked.
		// Permit executable code only from the local Wails origin; network access
		// remains disabled and the iframe still has no same-origin privilege.
		writer.Header().Set("Content-Security-Policy", "default-src 'none'; script-src wails://wails; style-src 'self' wails://wails 'unsafe-inline'; img-src 'self' wails://wails data: blob:; font-src 'self' wails://wails data:; media-src 'self' wails://wails data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
	}
	writer.Header().Set("Content-Length", fmt.Sprint(len(data)))
	writer.WriteHeader(http.StatusOK)
	if request.Method == http.MethodGet {
		if _, writeErr := writer.Write(data); writeErr != nil {
			return
		}
	}
}
