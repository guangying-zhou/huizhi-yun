package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// documentAccess is the compatibility document-detail read boundary. Its
// owner/share/relation/department facts are reused by write, share, review,
// annotation and collaboration domains, so this file deliberately owns the
// shared detail-read helpers rather than duplicating any ACL decision.
func (a *Adapter) documentAccess(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	includeDeleted := query.Get("include_deleted") == "1" || query.Get("includeDeleted") == "true"
	doc, err := a.documentByUUID(ctx, uuid, includeDeleted)
	if err != nil {
		return nil, err
	}
	ownerUID := stringValue(doc["owner_uid"])
	sharePermission := ""
	if actorUID != "" && actorUID != ownerUID {
		permission, shareErr := a.sharePermission(ctx, int64Value(doc["id"]), actorUID)
		if shareErr != nil {
			return nil, shareErr
		}
		sharePermission = permission
		if sharePermission == "" {
			canRead, relationErr := a.relationCanRead(ctx, int64Value(doc["id"]), actorUID)
			if relationErr != nil {
				return nil, relationErr
			}
			if !canRead && !departmentDocumentReadAllowedByTrustedContext(doc, query) {
				return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
			}
		}
	}

	status := int64Value(doc["status"])
	readonlyFlag := int64Value(doc["readonly_flag"])
	canWrite := status != 2 && readonlyFlag != 1 && (actorUID == "" || actorUID == ownerUID || sharePermission == "write")
	if actorUID != "" && actorUID != ownerUID && sharePermission == "" {
		canWrite = false
	}
	doc["sharePermission"] = nil
	if sharePermission != "" {
		doc["sharePermission"] = sharePermission
	}
	doc["readonly"] = !canWrite
	return doc, nil
}

func departmentDocumentReadAllowedByTrustedContext(doc map[string]any, query url.Values) bool {
	deptCode := firstNonEmpty(
		query.Get("trusted_department_read_dept_code"),
		query.Get("trustedDepartmentReadDeptCode"),
	)
	return deptCode != "" &&
		stringValue(doc["doc_type"]) == "department" &&
		stringValue(doc["dept_code"]) == deptCode
}

func (a *Adapter) documentByUUID(ctx context.Context, uuid string, includeDeleted bool) (map[string]any, error) {
	return readDocumentByUUID(ctx, a.db, uuid, includeDeleted, false)
}

type documentReadDB interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readDocumentByUUID(ctx context.Context, db documentReadDB, uuid string, includeDeleted, lock bool) (map[string]any, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document", "Document uuid is required")
	}
	where := "uuid = ?"
	if !includeDeleted {
		where += " AND status <> 0"
	}
	statement := "SELECT * FROM documents WHERE " + where + " LIMIT 1"
	if lock {
		statement += " FOR UPDATE"
	}
	rows, err := db.QueryContext(ctx, statement, uuid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
	}
	return items[0], nil
}

func (a *Adapter) sharePermission(ctx context.Context, docID int64, actorUID string) (string, error) {
	return readDocumentSharePermission(ctx, a.db, docID, actorUID, false)
}

func readDocumentSharePermission(ctx context.Context, db documentReadDB, docID int64, actorUID string, lock bool) (string, error) {
	var permission string
	statement := `
      SELECT permission
      FROM document_shares
      WHERE document_id = ? AND shared_to_uid = ?
      LIMIT 1`
	if lock {
		statement += " FOR UPDATE"
	}
	err := db.QueryRowContext(ctx, statement, docID, actorUID).Scan(&permission)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return permission, nil
}

func (a *Adapter) relationCanRead(ctx context.Context, docID int64, actorUID string) (bool, error) {
	exists, err := a.tableExists(ctx, "document_relations")
	if err != nil || !exists {
		return false, err
	}
	var count int
	if err := a.db.QueryRowContext(ctx, `
      SELECT COUNT(*)
      FROM document_relations
      WHERE document_id = ? AND related_uid = ? AND status = 1 AND can_read = 1
        AND (source_type <> 'project_preview_access' OR updated_at >= DATE_SUB(NOW(), INTERVAL 12 HOUR))`,
		docID,
		actorUID,
	).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}
