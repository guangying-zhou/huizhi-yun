package codocs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// createDocument keeps the document row and its owner relation in one
// transaction. The generic relation helpers intentionally remain in adapter.go
// because service-ops knowledge and document shares also use them.
func (a *Adapter) createDocument(ctx context.Context, body map[string]any) (map[string]any, error) {
	title := firstNonEmpty(stringValue(body["title"]), stringValue(body["name"]))
	ownerUID := firstNonEmpty(stringValue(body["ownerUid"]), stringValue(body["owner_uid"]), stringValue(body["current_user"]))
	if title == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Document title is required")
	}
	if ownerUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "ownerUid is required")
	}

	deptCode := firstNonEmpty(stringValue(body["deptCode"]), stringValue(body["dept_code"]))
	projectCode := firstNonEmpty(stringValue(body["projectCode"]), stringValue(body["project_code"]))
	docType := firstNonEmpty(stringValue(body["docType"]), stringValue(body["doc_type"]))
	if docType == "" {
		docType = inferDocumentTypeFromBusinessContext(body, projectCode)
	}
	folderID := int64Value(firstNonEmpty(stringValue(body["folderId"]), stringValue(body["folder_id"])))
	folderPath := firstNonEmpty(stringValue(body["folderPath"]), stringValue(body["folder_path"]))
	personalExplicitPath := (docType == "private" || docType == "slide") && firstNonEmpty(stringValue(body["ossPath"]), stringValue(body["oss_path"])) != ""
	if folderPath == "" && folderID > 0 && !personalExplicitPath {
		resolvedFolderPath, err := a.folderPath(ctx, folderID)
		if err != nil {
			return nil, err
		}
		folderPath = resolvedFolderPath
	}
	ossPath := firstNonEmpty(stringValue(body["ossPath"]), stringValue(body["oss_path"]))
	if ossPath == "" {
		ossPath = documentPath(docType, ownerUID, projectCode, deptCode, title, folderPath)
	}

	var existingID int64
	err := a.db.QueryRowContext(ctx, "SELECT id FROM documents WHERE oss_path = ? AND status != 0 LIMIT 1", ossPath).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if existingID > 0 {
		// Only the UUID-addressed immutable creation path supports replay.
		// Legacy title-addressed documents retain their conflict semantics.
		uuid := stringValue(body["uuid"])
		if uuid != "" && strings.HasPrefix(ossPath, "codocs/document-creations/"+uuid+"/") {
			var matched int64
			err := a.db.QueryRowContext(ctx, `SELECT id FROM documents WHERE id=? AND uuid=? AND title=?
			  AND doc_type=? AND owner_uid=? AND dept_code <=> ? AND project_code <=> ?
			  AND folder_id <=> ? AND status != 0`, existingID, uuid, title, docType, ownerUID, nullableString(deptCode), nullableString(projectCode), nullableInt64(folderID)).Scan(&matched)
			if err == nil {
				return map[string]any{"id": matched, "uuid": uuid, "title": title, "doc_type": docType, "oss_path": ossPath}, nil
			}
			if err != sql.ErrNoRows {
				return nil, err
			}
		}
		return nil, httperror.New(http.StatusConflict, "document_exists", "Document already exists")
	}

	docUUID := firstNonEmpty(stringValue(body["uuid"]), stringValue(body["documentUuid"]), stringValue(body["document_uuid"]))
	if docUUID == "" {
		var uuidErr error
		docUUID, uuidErr = randomUUID()
		if uuidErr != nil {
			return nil, uuidErr
		}
	}
	contentSize := int64Value(firstNonEmpty(stringValue(body["contentSize"]), stringValue(body["content_size"])))
	if contentSize == 0 {
		content := stringValue(body["content"])
		if content != "" {
			contentSize = int64(len([]byte(content)))
		}
	}

	relationTableExists, err := a.tableExists(ctx, "document_relations")
	if err != nil {
		return nil, err
	}
	if !relationTableExists {
		return nil, httperror.New(http.StatusInternalServerError, "schema_mismatch", "document_relations table is required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if folderID > 0 && (docType == "private" || docType == "slide") {
		folder, err := readFolderScope(ctx, tx, folderID, true)
		if err != nil {
			return nil, err
		}
		if folder.Kind != docType || !folderScopeAllowed(folder, ownerUID, url.Values{"current_user": {ownerUID}}, true) {
			return nil, httperror.New(403, "document_folder_scope_mismatch", "Folder is outside the personal document scope")
		}
	}

	result, err := tx.ExecContext(ctx, `
      INSERT INTO documents
        (uuid, title, doc_type, oss_path, owner_uid, dept_code, project_code, folder_id, content_size, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		docUUID,
		title,
		docType,
		ossPath,
		ownerUID,
		nullableString(deptCode),
		nullableString(projectCode),
		nullableInt64(folderID),
		contentSize,
	)
	if err != nil {
		var duplicate *mysql.MySQLError
		if errors.As(err, &duplicate) && duplicate.Number == 1062 {
			_ = tx.Rollback()
			if strings.HasPrefix(ossPath, "codocs/document-creations/"+docUUID+"/") {
				var matched int64
				lookupErr := a.db.QueryRowContext(ctx, `SELECT id FROM documents WHERE uuid=? AND oss_path=? AND title=?
				 AND doc_type=? AND owner_uid=? AND dept_code <=> ? AND project_code <=> ?
				 AND folder_id <=> ? AND status != 0`, docUUID, ossPath, title, docType, ownerUID, nullableString(deptCode), nullableString(projectCode), nullableInt64(folderID)).Scan(&matched)
				if lookupErr == nil {
					return map[string]any{"id": matched, "uuid": docUUID, "title": title, "doc_type": docType, "oss_path": ossPath}, nil
				}
				if lookupErr != sql.ErrNoRows {
					return nil, lookupErr
				}
			}
			return nil, httperror.New(http.StatusConflict, "document_uuid_conflict", "Document UUID already belongs to another creation")
		}
		return nil, err
	}
	id, _ := result.LastInsertId()
	if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{
		DocumentID:   id,
		DocumentUUID: docUUID,
		RelatedUID:   ownerUID,
		RelationType: "created_by_me",
		SourceType:   "document",
		SourceID:     strconv.FormatInt(id, 10),
		CanRead:      true,
		CanEdit:      true,
		Metadata: map[string]any{
			"docType":     docType,
			"deptCode":    nullableString(deptCode),
			"projectCode": nullableString(projectCode),
			"folderId":    nullableInt64(folderID),
			"sourceApp":   firstNonEmpty(stringValue(body["sourceApp"]), stringValue(body["source_app"])),
			"sourceBiz":   firstNonEmpty(stringValue(body["sourceBizCode"]), stringValue(body["source_biz_code"]), stringValue(body["bizId"]), stringValue(body["biz_id"])),
		},
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":       id,
		"uuid":     docUUID,
		"title":    title,
		"doc_type": docType,
		"oss_path": ossPath,
	}, nil
}

func inferDocumentTypeFromBusinessContext(body map[string]any, projectCode string) string {
	sourceApp := strings.ToLower(strings.TrimSpace(firstNonEmpty(stringValue(body["sourceApp"]), stringValue(body["source_app"]))))
	if firstNonEmpty(stringValue(body["productCode"]), stringValue(body["product_code"])) != "" {
		return "product"
	}
	switch sourceApp {
	case "aims":
		return "project"
	case "altoc":
		return "sale"
	case "assets":
		if firstNonEmpty(stringValue(body["deliveryCode"]), stringValue(body["delivery_code"]), stringValue(body["assetCode"]), stringValue(body["asset_code"])) != "" {
			if projectCode != "" {
				return "project"
			}
			return "knowledge"
		}
		return "knowledge"
	}
	if projectCode != "" {
		return "project"
	}
	if firstNonEmpty(stringValue(body["contractCode"]), stringValue(body["contract_code"]), stringValue(body["customerCode"]), stringValue(body["customer_code"])) != "" {
		return "sale"
	}
	return "private"
}

func (a *Adapter) updateDocument(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	doc, err := a.requireDocumentWriteForMutation(ctx, uuid, body, false, true)
	if err != nil {
		return nil, err
	}
	updates := map[string]any{}
	setIfPresent := func(bodyKey string, column string, normalize func(any) any) {
		value, ok := body[bodyKey]
		if !ok {
			return
		}
		if normalize != nil {
			value = normalize(value)
		}
		updates[column] = value
	}
	setIfPresent("title", "title", nil)
	setIfPresent("folder_id", "folder_id", normalizeNullableNumber)
	setIfPresent("folderId", "folder_id", normalizeNullableNumber)
	setIfPresent("star_flag", "star_flag", normalizeBoolInt)
	setIfPresent("starFlag", "star_flag", normalizeBoolInt)
	setIfPresent("home_flag", "home_flag", normalizeBoolInt)
	setIfPresent("homeFlag", "home_flag", normalizeBoolInt)
	setIfPresent("readonly_flag", "readonly_flag", normalizeBoolInt)
	setIfPresent("readonlyFlag", "readonly_flag", normalizeBoolInt)
	setIfPresent("doc_type", "doc_type", nil)
	setIfPresent("docType", "doc_type", nil)
	setIfPresent("dept_code", "dept_code", normalizeNullableString)
	setIfPresent("deptCode", "dept_code", normalizeNullableString)
	setIfPresent("project_code", "project_code", normalizeNullableString)
	setIfPresent("projectCode", "project_code", normalizeNullableString)
	setIfPresent("oss_path", "oss_path", normalizeNullableString)
	setIfPresent("ossPath", "oss_path", normalizeNullableString)
	setIfPresent("content_size", "content_size", normalizeInt64)
	setIfPresent("contentSize", "content_size", normalizeInt64)
	setIfPresent("last_editor_uid", "last_editor_uid", normalizeNullableString)
	setIfPresent("lastEditorUid", "last_editor_uid", normalizeNullableString)
	setIfPresent("ai_abstract", "ai_abstract", normalizeNullableString)
	setIfPresent("aiAbstract", "ai_abstract", normalizeNullableString)

	actorUID := actorFromBody(body)
	if _, readonlyUpdate := updates["readonly_flag"]; readonlyUpdate && actorUID != stringValue(doc["owner_uid"]) {
		return nil, httperror.New(http.StatusForbidden, "permission_denied", "Only document owner can change readonly flag")
	}
	if _, folderUpdate := updates["folder_id"]; folderUpdate {
		if err := a.validateDocumentFolderTarget(ctx, doc, updates); err != nil {
			return nil, err
		}
	}

	if int64Value(doc["readonly_flag"]) == 1 && !isReadonlyUnlockUpdate(updates) {
		return nil, httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}

	_, folderUpdate := updates["folder_id"]
	if title, ok := updates["title"]; ok && (strings.TrimSpace(fmt.Sprint(title)) != stringValue(doc["title"]) || folderUpdate) {
		folderValue := doc["folder_id"]
		if value, ok := updates["folder_id"]; ok {
			folderValue = value
		}
		if err := a.ensureDocumentTitleAvailable(ctx, uuid, doc, strings.TrimSpace(fmt.Sprint(title)), folderValue); err != nil {
			return nil, err
		}
	}
	if folderUpdate {
		if _, titleUpdate := updates["title"]; !titleUpdate {
			if err := a.ensureDocumentTitleAvailable(ctx, uuid, doc, stringValue(doc["title"]), updates["folder_id"]); err != nil {
				return nil, err
			}
		}
	}

	if len(updates) == 0 {
		return map[string]any{"uuid": uuid, "updated": false}, nil
	}

	names := make([]string, 0, len(updates))
	for name := range updates {
		names = append(names, name)
	}
	sort.Strings(names)
	set := make([]string, 0, len(names)+1)
	args := make([]any, 0, len(names)+1)
	for _, name := range names {
		set = append(set, "`"+name+"` = ?")
		args = append(args, updates[name])
	}
	set = append(set, "updated_at = NOW()")
	args = append(args, uuid)
	if _, err := a.db.ExecContext(ctx, "UPDATE documents SET "+strings.Join(set, ", ")+" WHERE uuid = ?", args...); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "updated": true}, nil
}

func (a *Adapter) validateDocumentFolderTarget(ctx context.Context, doc map[string]any, updates map[string]any) error {
	for _, field := range []string{"doc_type", "dept_code", "project_code"} {
		if value, ok := updates[field]; ok {
			var original string
			switch field {
			case "doc_type":
				original = stringValue(doc["doc_type"])
			case "dept_code":
				original = stringValue(doc["dept_code"])
			case "project_code":
				original = stringValue(doc["project_code"])
			}
			if stringValue(value) != original {
				return httperror.New(http.StatusForbidden, "folder_scope_mismatch", "Folder move cannot change document scope")
			}
		}
	}

	folderValue := updates["folder_id"]
	parentID := int64Value(folderValue)
	if parentID <= 0 {
		return nil
	}
	folderType := stringValue(doc["doc_type"])
	switch folderType {
	case "private", "slide", "department":
	default:
		return httperror.New(http.StatusForbidden, "folder_scope_mismatch", "Document type cannot use a folder target")
	}
	return a.validateFolderParent(ctx, parentID, folderType, stringValue(doc["owner_uid"]), stringValue(doc["dept_code"]), stringValue(doc["project_code"]))
}

func (a *Adapter) deleteDocument(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	if _, err := a.requireDocumentWrite(ctx, uuid, body, false); err != nil {
		return nil, err
	}
	recyclePath := firstNonEmpty(stringValue(body["recyclePath"]), stringValue(body["recycle_path"]), stringValue(body["oss_path"]))
	if _, err := a.db.ExecContext(ctx, `
      UPDATE documents
      SET status = 0, deleted_at = NOW(), oss_path = COALESCE(NULLIF(?, ''), oss_path), updated_at = NOW()
      WHERE uuid = ?`, recyclePath, uuid); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "deleted": true}, nil
}

func (a *Adapter) restoreDocument(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	doc, err := a.requireDocumentWrite(ctx, uuid, body, true)
	if err != nil {
		return nil, err
	}
	if int64Value(doc["status"]) != 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_state", "Document is not deleted")
	}
	title := firstNonEmpty(stringValue(body["title"]), stringValue(body["newTitle"]), stringValue(body["new_title"]), stringValue(doc["title"]))
	ossPath := firstNonEmpty(stringValue(body["ossPath"]), stringValue(body["oss_path"]), stringValue(doc["oss_path"]))
	if _, err := a.db.ExecContext(ctx, `
      UPDATE documents
      SET status = 1, deleted_at = NULL, title = ?, oss_path = ?, updated_at = NOW()
      WHERE uuid = ?`, title, ossPath, uuid); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "title": title, "restored": true}, nil
}

func (a *Adapter) requireDocumentWrite(ctx context.Context, uuid string, body map[string]any, includeDeleted bool) (map[string]any, error) {
	return a.requireDocumentWriteForMutation(ctx, uuid, body, includeDeleted, false)
}

func (a *Adapter) requireDocumentWriteForMutation(ctx context.Context, uuid string, body map[string]any, includeDeleted bool, allowReadonlyUnlock bool) (map[string]any, error) {
	return requireDocumentWriteFrom(ctx, a.db, uuid, body, includeDeleted, allowReadonlyUnlock, false)
}

func requireDocumentWriteFrom(ctx context.Context, db documentReadDB, uuid string, body map[string]any, includeDeleted, allowReadonlyUnlock, lock bool) (map[string]any, error) {
	doc, err := readDocumentByUUID(ctx, db, uuid, includeDeleted, lock)
	if err != nil {
		return nil, err
	}
	actorUID := actorFromBody(body)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "unauthorized", "Actor uid is required")
	}
	if int64Value(doc["status"]) == 2 || (int64Value(doc["readonly_flag"]) == 1 && !allowReadonlyUnlock) {
		return nil, httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}
	if actorUID == stringValue(doc["owner_uid"]) {
		return doc, nil
	}
	permission, err := readDocumentSharePermission(ctx, db, int64Value(doc["id"]), actorUID, lock)
	if err != nil {
		return nil, err
	}
	if permission == "write" {
		return doc, nil
	}
	return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
}

func isReadonlyUnlockUpdate(updates map[string]any) bool {
	value, ok := updates["readonly_flag"]
	return ok && len(updates) == 1 && int64Value(value) == 0
}

func (a *Adapter) ensureDocumentTitleAvailable(ctx context.Context, uuid string, doc map[string]any, title string, folderValue any) error {
	return ensureDocumentTitleAvailableFrom(ctx, a.db, uuid, doc, title, folderValue)
}

func ensureDocumentTitleAvailableFrom(ctx context.Context, db documentReadDB, uuid string, doc map[string]any, title string, folderValue any) error {
	if title == "" {
		return httperror.New(http.StatusBadRequest, "invalid_request", "Document title is required")
	}
	docType := stringValue(doc["doc_type"])
	where := []string{"title = ?", "owner_uid = ?", "uuid != ?", "status != 0"}
	args := []any{title, stringValue(doc["owner_uid"]), uuid}
	if docType == "project" || docType == "git-project" {
		where = append(where, `doc_type IN ("project", "git-project")`)
	} else {
		where = append(where, "doc_type = ?")
		args = append(args, docType)
	}
	if folderValue == nil || stringValue(folderValue) == "" || stringValue(folderValue) == "0" {
		where = append(where, "folder_id IS NULL")
	} else {
		where = append(where, "folder_id = ?")
		args = append(args, folderValue)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM documents WHERE "+strings.Join(where, " AND "), args...).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return httperror.New(http.StatusConflict, "document_exists", "Document title already exists in target folder")
	}
	return nil
}
