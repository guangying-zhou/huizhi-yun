package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The Codocs BFF supplies this fact after verifying the actor's asset scope and,
// for creation, object existence. Foundation signs the complete request target.
const publishedAssetLinkActionKey = "codocs_trusted_published_asset_link_action"

func publishedAssetLinkActor(query url.Values, action string) (string, error) {
	actor := actorFromQuery(query)
	if actor == "" {
		return "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" || strings.TrimSuffix(query.Get("hzy_runtime_source_app"), ".runtime") != "codocs" || query.Get(publishedAssetLinkActionKey) != action {
		return "", httperror.New(http.StatusForbidden, "trusted_published_asset_link_required", "Trusted Codocs published asset link authorization is required")
	}
	return actor, nil
}

// Match shared/utils/publishedAssetLink.ts, including its UTF-16 length bound.
// A short link only identifies an existing published asset, never a URL target.
func validPublishedAssetPath(path string) bool {
	if path == "" || !utf8.ValidString(path) || len(utf16.Encode([]rune(path))) > 800 || strings.Contains(path, "\\") {
		return false
	}
	for _, char := range path {
		if char < 32 || char == 127 {
			return false
		}
	}
	segments := strings.Split(path, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	if len(segments) < 4 || segments[0] != "codocs" {
		return false
	}
	if segments[1] == "company" {
		switch segments[2] {
		case "rules", "notices", "legal", "culture", "tech-specs", "knowledge", "templates", "products":
			return true
		}
	}
	if segments[1] == "departments" && len(segments) >= 5 {
		switch segments[3] {
		case "rules", "records", "outsides":
			return true
		}
	}
	return false
}

func publishedAssetLinkToken(path string) string {
	hash := sha256.Sum256([]byte(path))
	return base64.RawURLEncoding.EncodeToString(hash[:12])
}

func (a *Adapter) createPublishedAssetLink(ctx context.Context, query url.Values) (map[string]any, error) {
	actor, err := publishedAssetLinkActor(query, "create")
	if err != nil {
		return nil, err
	}
	path := query.Get("path")
	if !validPublishedAssetPath(path) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_asset_path", "Invalid published asset path")
	}
	token := publishedAssetLinkToken(path)
	// The tenant's Codocs DB owns the mapping. Duplicate requests never update
	// a destination or creator; compare the stored path to detect a collision.
	_, err = a.db.ExecContext(ctx, `INSERT INTO published_asset_links (token, oss_path, created_by, created_at)
 VALUES (?, ?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE token = token`, token, path, actor)
	if err != nil {
		return nil, err
	}
	var storedPath string
	if err := a.db.QueryRowContext(ctx, `SELECT oss_path FROM published_asset_links WHERE token = ?`, token).Scan(&storedPath); err != nil {
		return nil, err
	}
	if storedPath != path {
		return nil, httperror.New(http.StatusConflict, "published_asset_link_collision", "Published asset short link collision")
	}
	return map[string]any{"token": token, "path": path}, nil
}

func (a *Adapter) resolvePublishedAssetLink(ctx context.Context, query url.Values, token string) (map[string]any, error) {
	if _, err := publishedAssetLinkActor(query, "resolve"); err != nil {
		return nil, err
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil || len(token) != 16 || len(decoded) != 12 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_published_asset_link", "Invalid published asset short link")
	}
	var path string
	err = a.db.QueryRowContext(ctx, `SELECT oss_path FROM published_asset_links WHERE token = ?`, token).Scan(&path)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "published_asset_link_not_found", "Published asset short link not found")
	}
	if err != nil {
		return nil, err
	}
	if !validPublishedAssetPath(path) || publishedAssetLinkToken(path) != token {
		return nil, httperror.New(http.StatusConflict, "invalid_published_asset_link_target", "Invalid published asset short link target")
	}
	// Reading a link grants no content access. The BFF rechecks the resolved
	// company/department scope; the existing content endpoint checks it again.
	return map[string]any{"token": token, "path": path}, nil
}
