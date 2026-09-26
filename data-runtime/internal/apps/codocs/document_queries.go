package codocs

import (
	"context"
	"database/sql"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// documentsList returns the document index after the caller's runtime actor
// has been verified. Its visibility predicate stays in adapter.go alongside
// the detail-read policy so both read paths share one authorization fact.
func (a *Adapter) documentsList(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID, trustedDepartmentReadDeptCode, err := requireTrustedDocumentListActor(query)
	if err != nil {
		return nil, err
	}
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("limit"), query.Get("pageSize"), query.Get("page_size")), 5000)
	offset := (page - 1) * pageSize

	docType := strings.TrimSpace(query.Get("type"))
	owner := strings.TrimSpace(query.Get("owner"))
	if docType == "shared" || docType == "shared_by_me" {
		// These views describe the authenticated actor's own share state. A
		// browser-supplied owner must not select another user's share rows.
		owner = actorUID
	}
	folderID := strings.TrimSpace(query.Get("folder_id"))
	publishedMode := strings.TrimSpace(query.Get("published_mode"))

	where := []string{"d.status = 1"}
	visibleWhere, visibleArgs := documentReadVisibilityPredicate(actorUID, trustedDepartmentReadDeptCode)
	where = append(where, visibleWhere)
	args := visibleArgs
	selectArgs := []any{}
	selectColumns := `d.id, d.uuid, d.title, d.doc_type, d.oss_path, d.owner_uid,
        d.dept_code, d.project_code, d.folder_id, d.content_size,
        d.last_editor_uid, d.created_at, d.updated_at, d.star_flag,
        d.home_flag, d.readonly_flag, d.publish_info,
        f.name AS folder_name`

	if docType == "shared" {
		if owner != "" {
			where = append(where, "d.id IN (SELECT document_id FROM document_shares WHERE shared_to_uid = ?)")
			args = append(args, owner)
			selectColumns += `,
        (SELECT is_opened FROM document_shares ds WHERE ds.document_id = d.id AND ds.shared_to_uid = ?) AS is_opened,
        (SELECT permission FROM document_shares ds WHERE ds.document_id = d.id AND ds.shared_to_uid = ?) AS share_permission,
        (SELECT message FROM document_shares ds WHERE ds.document_id = d.id AND ds.shared_to_uid = ?) AS share_message`
			selectArgs = append(selectArgs, owner, owner, owner)
		}
	} else if docType == "shared_by_me" {
		if owner != "" {
			where = append(where, "d.owner_uid = ? AND d.id IN (SELECT document_id FROM document_shares)")
			args = append(args, owner)
			selectColumns += `, (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'share_id', s.id,
            'uid', s.shared_to_uid,
            'permission', s.permission,
            'is_opened', s.is_opened,
            'opened_at', s.opened_at
          )
        )
        FROM document_shares s
        WHERE s.document_id = d.id
      ) AS shared_info`
		}
	} else {
		if docType == "project" {
			where = append(where, `d.doc_type IN ("project", "git-project")`)
		} else if docType != "" {
			where = append(where, "d.doc_type = ?")
			args = append(args, docType)
		}
		if owner != "" {
			where = append(where, "d.owner_uid = ?")
			args = append(args, owner)
		}
	}
	if keyword := strings.TrimSpace(query.Get("search")); keyword != "" {
		if len([]rune(keyword)) > 100 {
			return nil, httperror.New(400, "codocs_document_search_invalid", "Invalid document search")
		}
		literal := strings.NewReplacer("!", "!!", "\\", "!\\", "%", "!%", "_", "!_").Replace(keyword)
		where = append(where, "d.title LIKE ? ESCAPE '!'")
		args = append(args, "%"+literal+"%")
	}

	addEqualsFilter := func(queryKey string, column string) {
		value := strings.TrimSpace(query.Get(queryKey))
		if value == "" {
			return
		}
		where = append(where, "d."+column+" = ?")
		args = append(args, value)
	}
	addEqualsFilter("last_editor", "last_editor_uid")
	addEqualsFilter("uuid", "uuid")
	addEqualsFilter("dept_code", "dept_code")
	addEqualsFilter("project_code", "project_code")
	addEqualsFilter("oss_path", "oss_path")

	if query.Get("starred") == "true" || query.Get("starred") == "1" {
		where = append(where, "d.star_flag = 1")
	}
	if query.Get("home") == "true" || query.Get("home") == "1" {
		where = append(where, "d.home_flag = 1")
	}
	if _, ok := query["folder_id"]; ok {
		if folderID == "" || folderID == "null" {
			where = append(where, "d.folder_id IS NULL")
		} else {
			where = append(where, "d.folder_id = ?")
			args = append(args, folderID)
		}
	}
	if publishedMode == "published" {
		where = append(where, "d.publish_info IS NOT NULL")
	} else if publishedMode == "unpublished" {
		where = append(where, "d.publish_info IS NULL")
	}
	if query.Get("exclude_worklogs") == "true" || query.Get("exclude_worklogs") == "1" {
		where = append(where, `d.oss_path NOT LIKE 'codocs/worklogs/%'`)
	}
	if query.Get("exclude_weekly_reports") == "true" || query.Get("exclude_weekly_reports") == "1" {
		where = append(where, `d.oss_path NOT LIKE '%/weekly-reports/%'`)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents d WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT `+selectColumns+`
      FROM documents d
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE `+whereSQL+`
      ORDER BY d.updated_at DESC
      LIMIT ? OFFSET ?`, append(append(selectArgs, args...), pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (a *Adapter) documentsSearch(ctx context.Context, query url.Values) (map[string]any, error) {
	page := positiveInt(query.Get("page"), 1)
	pageSize := positiveInt(firstNonEmpty(query.Get("page_size"), query.Get("pageSize"), query.Get("limit")), 20)
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	where := []string{"d.status != 0"}
	args := []any{}
	if keyword := strings.TrimSpace(query.Get("keyword")); keyword != "" {
		where = append(where, "d.title LIKE ?")
		args = append(args, "%"+keyword+"%")
	}
	for _, filter := range []struct{ queryKey, column string }{
		{"doc_type", "doc_type"},
		{"project_code", "project_code"},
		{"dept_code", "dept_code"},
		{"owner_uid", "owner_uid"},
	} {
		value := strings.TrimSpace(query.Get(filter.queryKey))
		if value == "" {
			continue
		}
		where = append(where, "d."+filter.column+" = ?")
		args = append(args, value)
	}

	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents d WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT d.uuid, d.title, d.doc_type, d.owner_uid, d.dept_code,
             d.project_code, d.content_size, d.ai_abstract, d.updated_at
      FROM documents d
      WHERE `+whereSQL+`
      ORDER BY d.updated_at DESC
      LIMIT ? OFFSET ?`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (a *Adapter) documentsBatchSummary(ctx context.Context, body map[string]any) ([]map[string]any, error) {
	uuids := stringSlice(body["uuids"])
	if len(uuids) == 0 {
		return nil, httperror.New(400, "invalid_request", "uuids is required")
	}
	if len(uuids) > 50 {
		return nil, httperror.New(400, "invalid_request", "At most 50 documents can be requested")
	}
	unique := uniqueStrings(uuids)
	placeholders := strings.TrimRight(strings.Repeat("?,", len(unique)), ",")
	args := make([]any, 0, len(unique))
	for _, uuid := range unique {
		args = append(args, uuid)
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT uuid, title, doc_type, owner_uid, status, content_size, ai_abstract, updated_at
      FROM documents
      WHERE uuid IN (`+placeholders+`) AND status != 0`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	byUUID := map[string]map[string]any{}
	for _, item := range items {
		byUUID[stringValue(item["uuid"])] = item
	}
	result := make([]map[string]any, 0, len(uuids))
	for _, uuid := range uuids {
		if item, ok := byUUID[uuid]; ok {
			result = append(result, item)
		} else {
			result = append(result, map[string]any{"uuid": uuid, "title": nil, "error": "not_found"})
		}
	}
	return result, nil
}

func (a *Adapter) myDocumentStats(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return nil, httperror.New(401, "current_user_required", "Current user is required")
	}

	var allDocumentCount sql.NullInt64
	var allTotalSize sql.NullInt64
	var myDocumentCount sql.NullInt64
	var myTotalSize sql.NullInt64
	if err := a.db.QueryRowContext(ctx, `
      SELECT
        COUNT(*) AS all_count,
        COALESCE(SUM(content_size), 0) AS all_size,
        COALESCE(SUM(CASE WHEN owner_uid = ? THEN 1 ELSE 0 END), 0) AS my_count,
        COALESCE(SUM(CASE WHEN owner_uid = ? THEN content_size ELSE 0 END), 0) AS my_size
      FROM documents
      WHERE status IN (1, 2)
        AND deleted_at IS NULL
        AND doc_type <> 'git-project'`, actorUID, actorUID).Scan(&allDocumentCount, &allTotalSize, &myDocumentCount, &myTotalSize); err != nil {
		return nil, err
	}

	rows, err := a.db.QueryContext(ctx, `
      SELECT
        doc_type,
        COUNT(*) AS count,
        COALESCE(SUM(content_size), 0) AS size
      FROM documents
      WHERE status IN (1, 2)
        AND deleted_at IS NULL
        AND doc_type <> 'git-project'
        AND owner_uid = ?
      GROUP BY doc_type
      ORDER BY count DESC, doc_type ASC`, actorUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byType, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	normalizedByType := make([]map[string]any, 0, len(byType))
	for _, row := range byType {
		normalizedByType = append(normalizedByType, map[string]any{
			"docType": stringValue(row["doc_type"]),
			"count":   int64Value(row["count"]),
			"size":    int64Value(row["size"]),
		})
	}

	myCount := sqlNullInt64Value(myDocumentCount)
	mySize := sqlNullInt64Value(myTotalSize)
	allCount := sqlNullInt64Value(allDocumentCount)
	allSize := sqlNullInt64Value(allTotalSize)
	return map[string]any{
		"myDocumentCount":  myCount,
		"myTotalSize":      mySize,
		"allDocumentCount": allCount,
		"allTotalSize":     allSize,
		"countRatio":       ratioValue(myCount, allCount),
		"sizeRatio":        ratioValue(mySize, allSize),
		"byType":           normalizedByType,
	}, nil
}

func (a *Adapter) documentNameExists(ctx context.Context, query url.Values) (map[string]any, error) {
	title := strings.TrimSpace(query.Get("title"))
	if title == "" {
		return map[string]any{"exists": false}, nil
	}
	where := []string{"status = 1", "title = ?"}
	args := []any{title}
	docType := strings.TrimSpace(query.Get("doc_type"))
	if docType == "project" {
		where = append(where, `doc_type IN ("project", "git-project")`)
	} else if docType != "" {
		where = append(where, "doc_type = ?")
		args = append(args, docType)
	}
	if ownerUID := strings.TrimSpace(query.Get("owner_uid")); ownerUID != "" {
		where = append(where, "owner_uid = ?")
		args = append(args, ownerUID)
	}
	if _, ok := query["folder_id"]; ok {
		folderID := strings.TrimSpace(query.Get("folder_id"))
		if folderID == "" || folderID == "null" {
			where = append(where, "folder_id IS NULL")
		} else {
			where = append(where, "folder_id = ?")
			args = append(args, folderID)
		}
	}
	if deptCode := strings.TrimSpace(query.Get("dept_code")); deptCode != "" {
		where = append(where, "dept_code = ?")
		args = append(args, deptCode)
	}
	if projectCode := strings.TrimSpace(query.Get("project_code")); projectCode != "" {
		where = append(where, "project_code = ?")
		args = append(args, projectCode)
	}
	if excludeUUID := strings.TrimSpace(query.Get("exclude_uuid")); excludeUUID != "" {
		where = append(where, "uuid != ?")
		args = append(args, excludeUUID)
	}
	var count int
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents WHERE "+strings.Join(where, " AND "), args...).Scan(&count); err != nil {
		return nil, err
	}
	return map[string]any{"exists": count > 0}, nil
}

func (a *Adapter) documentsTrash(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID, trustedDepartmentReadDeptCode, err := requireTrustedDocumentListActor(query)
	if err != nil {
		return nil, err
	}
	where := []string{"d.status = 0", "d.deleted_at IS NOT NULL"}
	visibleWhere, visibleArgs := documentReadVisibilityPredicate(actorUID, trustedDepartmentReadDeptCode)
	where = append(where, visibleWhere)
	args := visibleArgs
	docType := strings.TrimSpace(query.Get("type"))
	if docType == "project" {
		where = append(where, `d.doc_type IN ("project", "git-project")`)
	} else if docType != "" {
		where = append(where, "d.doc_type = ?")
		args = append(args, docType)
	}
	if owner := strings.TrimSpace(query.Get("owner")); owner != "" {
		where = append(where, "d.owner_uid = ?")
		args = append(args, owner)
	}
	if deptCode := strings.TrimSpace(query.Get("dept_code")); deptCode != "" {
		where = append(where, "d.dept_code = ?")
		args = append(args, deptCode)
	}
	if projectCode := strings.TrimSpace(query.Get("project_code")); projectCode != "" {
		where = append(where, "d.project_code = ?")
		args = append(args, projectCode)
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT d.id, d.uuid, d.title, d.doc_type, d.oss_path, d.owner_uid,
        d.dept_code, d.project_code, d.folder_id, d.content_size,
        d.last_editor_uid, d.created_at, d.updated_at, d.deleted_at,
        f.name AS folder_name
      FROM documents d
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE `+strings.Join(where, " AND ")+`
      ORDER BY d.deleted_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": len(items), "page": 1, "pageSize": len(items)}, nil
}
