package codocs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// These facts are added only after the Codocs BFF checks the user's permission.
// Foundation signs the complete request target, and runtime supplies the actor
// and source app from the verified delegation, never from the browser/body.
const companyAssetAccessActionKey = "codocs_trusted_company_asset_access_action"

func companyAssetAccessContext(query url.Values, action string) (string, string, error) {
	actor := actorFromQuery(query)
	if actor == "" {
		return "", "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" || strings.TrimSuffix(query.Get("hzy_runtime_source_app"), ".runtime") != "codocs" || query.Get(companyAssetAccessActionKey) != action {
		return "", "", httperror.New(http.StatusForbidden, "trusted_company_asset_access_required", "Trusted Codocs asset access authorization is required")
	}
	path := query.Get("path")
	if err := validateCompanyAssetAccessPath(path); err != nil {
		return "", "", err
	}
	return actor, path, nil
}

func validateCompanyAssetAccessPath(path string) error {
	if utf8.RuneCountInString(path) > 800 || !strings.HasPrefix(path, "codocs/company/") || strings.ContainsAny(path, "\\\x00\r\n\t") {
		return httperror.New(http.StatusBadRequest, "invalid_asset_path", "Invalid company asset path")
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return httperror.New(http.StatusBadRequest, "invalid_asset_path", "Invalid company asset path")
		}
	}
	for _, character := range path {
		if character < 32 || character == 127 {
			return httperror.New(http.StatusBadRequest, "invalid_asset_path", "Invalid company asset path")
		}
	}
	return nil
}

func (a *Adapter) recordCompanyAssetAccess(ctx context.Context, query url.Values) (map[string]any, error) {
	actor, path, err := companyAssetAccessContext(query, "record")
	if err != nil {
		return nil, err
	}
	return a.writeCompanyAssetAccess(ctx, actor, path, query.Get("eventId"))
}

// The Enterprise route has already authenticated its physical identity and
// exact capability. Resolve the object's current ACL and path again here;
// neither a browser nor the Host supplies a storage path as authorization.
func (a *Adapter) RecordEnterpriseDocumentAccess(ctx context.Context, documentUUID, actor, eventID, expectedPathHash string) (map[string]any, error) {
	doc, err := a.documentAccess(ctx, documentUUID, url.Values{"current_user": {actor}})
	if err != nil {
		return nil, err
	}
	path := stringValue(doc["oss_path"])
	if err := validateCompanyAssetAccessPath(path); err != nil {
		return nil, err
	}
	pathHash := sha256.Sum256([]byte(path))
	if expectedPathHash != hex.EncodeToString(pathHash[:]) {
		return nil, httperror.New(http.StatusConflict, "document_storage_changed", "Document storage changed during access")
	}
	return a.writeCompanyAssetAccess(ctx, actor, path, eventID)
}

func (a *Adapter) writeCompanyAssetAccess(ctx context.Context, actor, path, rawEventID string) (map[string]any, error) {
	eventID, err := uuid.Parse(rawEventID)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_access_event", "A valid access event ID is required")
	}
	pathHash := sha256.Sum256([]byte(path))
	// Repeated transport attempts of the same server-generated event are safe.
	// The timestamp is runtime UTC; body actor/timestamps are intentionally unused.
	_, err = a.db.ExecContext(ctx, `INSERT INTO company_asset_access_records (id, oss_path_hash, oss_path, viewer_uid, viewed_at)
 VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id = id`, eventID.String(), pathHash[:], path, actor)
	if err != nil {
		return nil, err
	}
	return map[string]any{"recorded": true, "id": eventID.String()}, nil
}

func companyAssetAccessFilter(query url.Values, path string) (string, []any, error) {
	pathHash := sha256.Sum256([]byte(path))
	where, args := "oss_path_hash = ? AND BINARY oss_path = ?", []any{pathHash[:], path}
	var from, to time.Time
	for _, name := range []string{"from", "to"} {
		value := query.Get(name)
		if value == "" {
			continue
		}
		date, err := time.Parse("2006-01-02", value)
		if err != nil {
			return "", nil, httperror.New(http.StatusBadRequest, "invalid_access_date", "Dates must use YYYY-MM-DD")
		}
		if name == "from" {
			from = date
			where += " AND viewed_at >= ?"
			args = append(args, date.Format("2006-01-02 15:04:05"))
		} else {
			to = date
			where += " AND viewed_at < ?"
			args = append(args, date.AddDate(0, 0, 1).Format("2006-01-02 15:04:05"))
		}
	}
	if !from.IsZero() && !to.IsZero() && from.After(to) {
		return "", nil, httperror.New(http.StatusBadRequest, "invalid_access_date_range", "Start date must not be after end date")
	}
	return where, args, nil
}

func (a *Adapter) listCompanyAssetAccessRecords(ctx context.Context, query url.Values, export bool) (map[string]any, error) {
	action := "list"
	if export {
		action = "export"
	}
	_, path, err := companyAssetAccessContext(query, action)
	if err != nil {
		return nil, err
	}
	where, args, err := companyAssetAccessFilter(query, path)
	if err != nil {
		return nil, err
	}
	page, pageSize := positiveInt(query.Get("page"), 1), positiveInt(query.Get("pageSize"), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	if page > 1000000 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_access_page", "Page is too large")
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM company_asset_access_records WHERE "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	if export {
		if total > 50000 {
			return nil, httperror.New(http.StatusRequestEntityTooLarge, "access_export_too_large", "Export exceeds 50000 records; narrow the date range")
		}
		page, pageSize = 1, 50001
	}
	rows, err := a.db.QueryContext(ctx, `SELECT id, viewer_uid AS viewerUid, oss_path AS ossPath,
 DATE_FORMAT(viewed_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS viewedAt
 FROM company_asset_access_records WHERE `+where+` ORDER BY viewed_at DESC, id DESC LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	// Concurrent reads can arrive between COUNT and SELECT. Never silently truncate.
	if export && len(items) > 50000 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "access_export_too_large", "Export exceeds 50000 records; narrow the date range")
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}
