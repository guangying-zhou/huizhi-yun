package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// collaborationContext projects the exact document facts the collaboration
// runtime needs after applying the same owner/share/verified-department read
// boundary as the document detail endpoint.
func (a *Adapter) collaborationContext(ctx context.Context, query url.Values) (map[string]any, error) {
	documentName := strings.TrimSpace(query.Get("documentName"))
	uuid := strings.TrimSpace(query.Get("uuid"))
	if uuid == "" && strings.HasPrefix(documentName, "doc:") {
		uuid = strings.TrimPrefix(documentName, "doc:")
	}
	if uuid == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document", "Document uuid is required")
	}
	// A v2 document has no current .yjs pair; opening a session would resume
	// stale collaboration state (stage B connects Collab to v2).
	if err := refuseSnapshotV2Document(ctx, a.db, uuid); err != nil {
		return nil, err
	}

	row := a.db.QueryRowContext(ctx, `
		SELECT id, uuid, doc_type, oss_path, owner_uid, dept_code, readonly_flag, status
		FROM documents
		WHERE uuid = ? AND status <> 0
		LIMIT 1`, uuid)

	var docID int64
	var docUUID, docType, ossPath, ownerUID string
	var deptCode sql.NullString
	var readonlyFlag int
	var status int
	if err := row.Scan(&docID, &docUUID, &docType, &ossPath, &ownerUID, &deptCode, &readonlyFlag, &status); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
		}
		return nil, err
	}

	actorUID := actorFromQuery(query)
	actorName := actorUID
	resolvedDeptCode := ""
	if deptCode.Valid {
		resolvedDeptCode = deptCode.String
	}
	trustedDepartmentRead := departmentDocumentReadAllowedByTrustedContext(map[string]any{
		"doc_type":  docType,
		"dept_code": resolvedDeptCode,
	}, query)
	sharePermission := ""
	if actorUID != "" && actorUID != ownerUID {
		err := a.db.QueryRowContext(ctx, `
			SELECT permission
			FROM document_shares
			WHERE document_id = ? AND shared_to_uid = ?
			LIMIT 1`, docID, actorUID).Scan(&sharePermission)
		if err != nil {
			if err == sql.ErrNoRows {
				if !trustedDepartmentRead {
					return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
				}
			}
			if err != sql.ErrNoRows {
				return nil, err
			}
		}
	}

	readonly := readonlyFlag == 1 || (actorUID != "" && actorUID != ownerUID && sharePermission != "write")
	result := map[string]any{
		"docId":           docID,
		"docUuid":         docUUID,
		"docType":         docType,
		"ossPath":         ossPath,
		"ownerUid":        ownerUID,
		"actorUid":        actorUID,
		"actorName":       actorName,
		"sharePermission": nil,
		"readonly":        readonly,
	}
	if sharePermission != "" {
		result["sharePermission"] = sharePermission
	}
	return result, nil
}

func (a *Adapter) collabDocs(ctx context.Context, query url.Values) (map[string]any, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}

	category := firstNonEmpty(query.Get("category"), "shared")
	scope := firstNonEmpty(query.Get("scope"), "all")
	keyword := strings.ToLower(strings.TrimSpace(query.Get("keyword")))
	deptCode := strings.TrimSpace(query.Get("dept_code"))
	ownerUID := strings.TrimSpace(query.Get("owner_uid"))

	where := "WHERE dr.related_uid = ? AND dr.status = 1 AND d.status != 0"
	args := []any{actorUID}
	if category == "shared" {
		where += " AND dr.relation_type LIKE ?"
		args = append(args, "shared_%")
	} else if category == "outside" {
		where += " AND dr.relation_type LIKE ?"
		args = append(args, "outside_%")
	} else if category == "original" {
		where += " AND dr.relation_type IN (?, ?)"
		args = append(args, "created_by_me", "transferred_by_me")
	}
	if keyword != "" {
		where += " AND LOWER(d.title) LIKE ?"
		args = append(args, "%"+keyword+"%")
	}
	if deptCode != "" {
		where += " AND d.dept_code = ?"
		args = append(args, deptCode)
	}
	if ownerUID != "" {
		where += " AND d.owner_uid = ?"
		args = append(args, ownerUID)
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT d.id AS document_id, d.uuid AS document_uuid, d.title, d.doc_type,
		       d.oss_path, d.owner_uid, d.dept_code, d.readonly_flag, d.status,
		       d.publish_info, d.updated_at, dr.relation_type, dr.source_type,
		       dr.source_id, dr.can_edit, dr.metadata AS relation_metadata,
		       COALESCE(pr.id, lr.id) AS review_id,
		       CASE
		         WHEN pr.id IS NOT NULL AND pr.archive_oss_path IS NOT NULL THEN 'archived'
		         WHEN pr.id IS NOT NULL THEN pr.workflow_status
		         ELSE lr.status
		       END AS review_status,
		       COALESCE(pr.review_type, lr.review_type) AS review_type,
		       COALESCE(pr.sub_type, lr.sub_type) AS review_sub_type,
		       COALESCE(pr.execution_status, lr.execution_status) AS review_execution_status,
		       COALESCE(lr.current_node, 0) AS review_current_node,
		       COALESCE(lr.flow_snapshot, JSON_ARRAY()) AS flow_snapshot
		FROM document_relations dr
		INNER JOIN documents d ON d.id = dr.document_id
		LEFT JOIN document_reviews lr
		  ON dr.source_type = 'review' AND lr.id = CAST(dr.source_id AS UNSIGNED)
		LEFT JOIN document_publish_requests pr
		  ON dr.source_type = 'publish_request' AND pr.id = CAST(dr.source_id AS UNSIGNED)
		`+where+`
		ORDER BY d.updated_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rowsData, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if category == "outside" &&
		query.Get("codocs_trusted_review_execution_admin") == "1" &&
		query.Get("hzy_runtime_actor_delegated") == "1" {
		adminWhere := "WHERE pr.review_type='对外发文' AND pr.execution_status='pending_seal' AND pr.archive_oss_path IS NOT NULL AND d.status<>0"
		adminArgs := []any{}
		if keyword != "" {
			adminWhere += " AND LOWER(d.title) LIKE ?"
			adminArgs = append(adminArgs, "%"+keyword+"%")
		}
		if deptCode != "" {
			adminWhere += " AND d.dept_code = ?"
			adminArgs = append(adminArgs, deptCode)
		}
		if ownerUID != "" {
			adminWhere += " AND d.owner_uid = ?"
			adminArgs = append(adminArgs, ownerUID)
		}
		adminRows, adminErr := a.db.QueryContext(ctx, `
			SELECT d.id AS document_id, d.uuid AS document_uuid, d.title, d.doc_type,
			       d.oss_path, d.owner_uid, d.dept_code, d.readonly_flag, d.status,
			       d.publish_info, d.updated_at, 'outside_seal_handler' AS relation_type,
			       'publish_request' AS source_type, CAST(pr.id AS CHAR) AS source_id,
			       0 AS can_edit, NULL AS relation_metadata,
			       pr.id AS review_id, 'archived' AS review_status, pr.review_type,
			       pr.sub_type AS review_sub_type, pr.execution_status AS review_execution_status,
			       0 AS review_current_node, JSON_ARRAY() AS flow_snapshot
			  FROM document_publish_requests pr
			  INNER JOIN documents d ON d.uuid=pr.published_document_uuid AND d.status=2
			  `+adminWhere+`
			  ORDER BY d.updated_at DESC`, adminArgs...)
		if adminErr != nil {
			return nil, adminErr
		}
		adminItems, adminErr := rowsToMaps(adminRows)
		_ = adminRows.Close()
		if adminErr != nil {
			return nil, adminErr
		}
		rowsData = append(rowsData, adminItems...)
	}

	grouped := map[string]map[string]any{}
	order := []string{}
	for _, row := range rowsData {
		uuid := stringValue(row["document_uuid"])
		if uuid == "" {
			continue
		}
		relationType := stringValue(row["relation_type"])
		flowSnapshot := jsonArrayValue(row["flow_snapshot"])
		documentReadonly := int64Value(row["status"]) == 2 || int64Value(row["readonly_flag"]) == 1
		relationCanWrite := stringValue(row["owner_uid"]) == actorUID || int64Value(row["can_edit"]) == 1
		effectiveReadonly := documentReadonly || !relationCanWrite
		isTodo := stringValue(row["review_status"]) == "in_progress" && currentReviewNodeIncludes(flowSnapshot, row["review_current_node"], actorUID)
		if !isTodo {
			isTodo = publishExecutionRelationTodo(relationType, stringValue(row["review_execution_status"]))
		}

		item, ok := grouped[uuid]
		if !ok {
			item = map[string]any{
				"uuid":                  uuid,
				"title":                 row["title"],
				"docType":               row["doc_type"],
				"ownerUid":              row["owner_uid"],
				"deptCode":              nullableMapValue(row["dept_code"]),
				"readonly":              effectiveReadonly,
				"docStatus":             int64Value(row["status"]),
				"published":             int64Value(row["status"]) == 2 || stringValue(row["publish_info"]) != "",
				"ossPath":               row["oss_path"],
				"updatedAt":             row["updated_at"],
				"relationTypes":         []string{relationType},
				"relationLabels":        []string{relationLabel(relationType)},
				"reviewId":              nullableMapValue(row["review_id"]),
				"reviewStatus":          nullableMapValue(row["review_status"]),
				"reviewType":            nullableMapValue(row["review_type"]),
				"reviewSubType":         nullableMapValue(row["review_sub_type"]),
				"reviewExecutionStatus": nullableMapValue(row["review_execution_status"]),
				"isTodo":                isTodo,
				"locationLabel":         locationLabel(stringValue(row["oss_path"]), stringValue(row["doc_type"])),
			}
			grouped[uuid] = item
			order = append(order, uuid)
			continue
		}

		item["readonly"] = boolValue(item["readonly"]) && effectiveReadonly
		item["isTodo"] = boolValue(item["isTodo"]) || isTodo
		if nullableMapValue(item["reviewId"]) == nil && nullableMapValue(row["review_id"]) != nil {
			item["reviewId"] = nullableMapValue(row["review_id"])
			item["reviewStatus"] = nullableMapValue(row["review_status"])
			item["reviewType"] = nullableMapValue(row["review_type"])
			item["reviewSubType"] = nullableMapValue(row["review_sub_type"])
			item["reviewExecutionStatus"] = nullableMapValue(row["review_execution_status"])
		}
		relationTypes := stringListValue(item["relationTypes"])
		if !stringInList(relationTypes, relationType) {
			relationTypes = append(relationTypes, relationType)
			item["relationTypes"] = relationTypes
			labels := stringListValue(item["relationLabels"])
			item["relationLabels"] = append(labels, relationLabel(relationType))
		}
	}

	items := make([]map[string]any, 0, len(order))
	for _, uuid := range order {
		item := grouped[uuid]
		if includeCollabDocScope(item, scope) {
			items = append(items, item)
		}
	}

	return map[string]any{"items": items, "total": len(items)}, nil
}

func nullableMapValue(value any) any {
	if stringValue(value) == "" || stringValue(value) == "0" {
		return nil
	}
	return value
}

func relationLabel(relationType string) string {
	labels := map[string]string{
		"shared_to_me":         "共享给我",
		"shared_by_me":         "我共享的",
		"created_by_me":        "我创建的",
		"transferred_by_me":    "我移交的",
		"outside_initiator":    "我发起的",
		"outside_reviewer":     "我参与审核",
		"outside_supervisor":   "我参与监督",
		"outside_seal_handler": "我参与盖章",
		"outside_sender":       "我负责发送",
	}
	if label, ok := labels[relationType]; ok {
		return label
	}
	return relationType
}

func locationLabel(ossPath string, docType string) string {
	if strings.Contains(ossPath, "/outsides/") {
		return "部门文档 / 对外发文"
	}
	if strings.Contains(ossPath, "/rules/") {
		return "部门文档 / 部门规章"
	}
	if strings.Contains(ossPath, "/records/") {
		return "部门文档 / 会议记录"
	}
	if strings.HasPrefix(ossPath, "codocs/company/") {
		return "组织资产"
	}
	if docType == "department" {
		return "部门文档"
	}
	if docType == "project" || docType == "git-project" {
		return "项目文档"
	}
	return "个人文档"
}

func includeCollabDocScope(item map[string]any, scope string) bool {
	if scope == "all" {
		return true
	}
	relationTypes := stringListValue(item["relationTypes"])
	reviewStatus := stringValue(item["reviewStatus"])
	if scope == "todo" {
		return boolValue(item["isTodo"])
	}
	if scope == "done" {
		if stringValue(item["reviewType"]) == "对外发文" && stringValue(item["reviewStatus"]) == "archived" {
			return stringValue(item["reviewExecutionStatus"]) == "received"
		}
		return reviewStatus == "approved" || reviewStatus == "archived" || reviewStatus == "rejected"
	}
	initiated := stringInList(relationTypes, "shared_by_me") ||
		stringInList(relationTypes, "outside_initiator") ||
		stringInList(relationTypes, "created_by_me") ||
		stringInList(relationTypes, "transferred_by_me")
	if scope == "initiated" {
		return initiated
	}
	if scope == "participated" {
		return !initiated
	}
	return true
}

func publishExecutionRelationTodo(relationType string, executionStatus string) bool {
	switch relationType {
	case "outside_seal_handler":
		return executionStatus == "pending_seal"
	case "outside_initiator":
		return executionStatus == "pending_send"
	case "outside_sender":
		return executionStatus == "pending_receive"
	default:
		return false
	}
}
