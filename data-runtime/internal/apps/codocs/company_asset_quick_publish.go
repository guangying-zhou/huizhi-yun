package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const quickPublishTrustedQueryKey = "codocs_trusted_company_quick_publish"

type quickPublishItem struct {
	SourceUUID string `json:"sourceUuid"`
	SourcePath string `json:"sourcePath"`
	Title      string `json:"title"`
	NewUUID    string `json:"newUuid"`
	OSSPath    string `json:"ossPath"`
}
type quickPublishPlan struct {
	OperationID string             `json:"operationId"`
	Items       []quickPublishItem `json:"items"`
}

func quickPublishActor(query url.Values) (string, error) {
	actor := actorFromQuery(query)
	if actor == "" {
		return "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" || query.Get(quickPublishTrustedQueryKey) != "1" || strings.TrimSuffix(strings.TrimSpace(query.Get("hzy_runtime_source_app")), ".runtime") != "codocs" {
		return "", httperror.New(http.StatusForbidden, "quick_publish_admin_required", "Trusted administrator publication context is required")
	}
	return actor, nil
}
func quickPublishCommand(body map[string]any) (string, string, []string, error) {
	id := strings.TrimSpace(stringValue(body["operationId"]))
	prefix := stringValue(body["targetPrefix"])
	invalid := func() (string, string, []string, error) {
		return "", "", nil, httperror.New(http.StatusBadRequest, "invalid_quick_publish_command", "Invalid publication operation, target or documents")
	}
	if id == "" || len(id) > 64 || strings.ContainsAny(id, "/\\\x00") {
		return invalid()
	}
	segments := strings.Split(strings.TrimSuffix(prefix, "/"), "/")
	categories := map[string]bool{"rules": true, "culture": true, "legal": true, "notices": true, "knowledge": true, "tech-specs": true, "templates": true}
	if len(segments) < 3 || segments[0] != "codocs" || segments[1] != "company" || !categories[segments[2]] || len(prefix) > 350 || !strings.HasSuffix(prefix, "/") || strings.ContainsAny(prefix, "\\\x00\r\n") {
		return invalid()
	}
	for _, s := range segments {
		if s == "" || s == "." || s == ".." {
			return invalid()
		}
	}
	raw, ok := body["documentUuids"].([]any)
	if !ok || len(raw) == 0 || len(raw) > 50 {
		return invalid()
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, v := range raw {
		s := stringValue(v)
		if len(s) != 36 || strings.ContainsAny(s, "/\\") {
			return invalid()
		}
		if !seen[s] {
			ids = append(ids, s)
			seen[s] = true
		}
	}
	sort.Strings(ids)
	return id, prefix, ids, nil
}
func (a *Adapter) quickPublishPrepare(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actor, err := quickPublishActor(query)
	if err != nil {
		return nil, err
	}
	id, prefix, ids, err := quickPublishCommand(body)
	if err != nil {
		return nil, err
	}
	payload, _ := json.Marshal([]any{actor, prefix, ids})
	digest := sha256.Sum256(payload)
	hash := hex.EncodeToString(digest[:])
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Insert reserves the operation before source inspection; concurrent retries block on its primary key.
	empty, _ := json.Marshal(quickPublishPlan{OperationID: id, Items: []quickPublishItem{}})
	res, err := tx.ExecContext(ctx, `INSERT IGNORE INTO company_asset_quick_publish_operations (operation_id,actor_uid,command_sha256,plan_json) VALUES (?,?,?,?)`, id, actor, hash, string(empty))
	if err != nil {
		return nil, err
	}
	inserted, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	var owner, storedHash, storedPlan string
	var result sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT actor_uid,command_sha256,plan_json,result_json FROM company_asset_quick_publish_operations WHERE operation_id=? FOR UPDATE`, id).Scan(&owner, &storedHash, &storedPlan, &result)
	if err != nil {
		return nil, err
	}
	if owner != actor || storedHash != hash {
		return nil, httperror.New(http.StatusConflict, "quick_publish_operation_conflict", "Operation already belongs to another publication")
	}
	plan := quickPublishPlan{}
	if err = json.Unmarshal([]byte(storedPlan), &plan); err != nil {
		return nil, err
	}
	if inserted > 0 {
		plan = quickPublishPlan{OperationID: id, Items: []quickPublishItem{}}
		for _, uuid := range ids {
			var title, source, dept string
			err = tx.QueryRowContext(ctx, `SELECT title,oss_path,dept_code FROM documents WHERE uuid=? AND doc_type='department' AND status=1 AND dept_code IS NOT NULL FOR UPDATE`, uuid).Scan(&title, &source, &dept)
			if errors.Is(err, sql.ErrNoRows) {
				return nil, httperror.New(http.StatusBadRequest, "quick_publish_source_invalid", "Only active department documents can be published")
			}
			if err != nil {
				return nil, err
			}
			if dept == "" || source == "" || !strings.HasPrefix(source, "codocs/") || strings.Contains(source, "/../") {
				return nil, httperror.New(http.StatusBadRequest, "quick_publish_source_invalid", "Department document has no valid stored content")
			}
			newUUID, e := randomUUID()
			if e != nil {
				return nil, e
			}
			filename := strings.NewReplacer("/", "-", "\\", "-", "\r", "", "\n", "", "\x00", "").Replace(title)
			filename = strings.TrimSuffix(filename, ".md")
			if filename == "" {
				filename = "document"
			}
			if len([]rune(filename)) > 80 {
				filename = string([]rune(filename)[:80])
			}
			plan.Items = append(plan.Items, quickPublishItem{SourceUUID: uuid, SourcePath: source, Title: title, NewUUID: newUUID, OSSPath: prefix + filename + "-" + newUUID + ".md"})
		}
		data, _ := json.Marshal(plan)
		if _, err = tx.ExecContext(ctx, `UPDATE company_asset_quick_publish_operations SET plan_json=? WHERE operation_id=?`, string(data), id); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	response := map[string]any{"plan": plan, "completed": result.Valid}
	if result.Valid {
		var value map[string]any
		if err = json.Unmarshal([]byte(result.String), &value); err != nil {
			return nil, err
		}
		response["result"] = value
	}
	return response, nil
}
func (a *Adapter) quickPublishComplete(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actor, err := quickPublishActor(query)
	if err != nil {
		return nil, err
	}
	id := stringValue(body["operationId"])
	if id == "" {
		return nil, httperror.New(http.StatusBadRequest, "operation_required", "Operation is required")
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var owner, rawPlan string
	var previous sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT actor_uid,plan_json,result_json FROM company_asset_quick_publish_operations WHERE operation_id=? FOR UPDATE`, id).Scan(&owner, &rawPlan, &previous)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "operation_not_found", "Publication operation not found")
	}
	if err != nil {
		return nil, err
	}
	if owner != actor {
		return nil, httperror.New(http.StatusForbidden, "operation_actor_mismatch", "Publication operation belongs to another actor")
	}
	if previous.Valid {
		var result map[string]any
		err = json.Unmarshal([]byte(previous.String), &result)
		return result, err
	}
	var plan quickPublishPlan
	if err = json.Unmarshal([]byte(rawPlan), &plan); err != nil {
		return nil, err
	}
	copies, ok := body["copies"].([]any)
	if !ok || len(copies) != len(plan.Items) {
		return nil, httperror.New(http.StatusBadRequest, "copy_evidence_required", "All copied objects are required")
	}
	imported := []map[string]any{}
	for i, item := range plan.Items {
		evidence, ok := copies[i].(map[string]any)
		if !ok || stringValue(evidence["newUuid"]) != item.NewUUID || stringValue(evidence["ossPath"]) != item.OSSPath || stringValue(evidence["etag"]) == "" {
			return nil, httperror.New(http.StatusBadRequest, "copy_evidence_invalid", "Copied object binding is invalid")
		}
		size := int64Value(evidence["size"])
		if size < 0 {
			return nil, httperror.New(http.StatusBadRequest, "copy_evidence_invalid", "Copied object size is invalid")
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO documents (uuid,title,doc_type,oss_path,owner_uid,readonly_flag,status,content_size,last_editor_uid,publish_info,created_at,updated_at) VALUES (?,?,'company',?,?,1,2,?,?,?,NOW(),NOW())`, item.NewUUID, item.Title, item.OSSPath, actor, size, actor, "管理员直接发布（无审批、无通知）")
		if err != nil {
			return nil, err
		}
		imported = append(imported, map[string]any{"sourceUuid": item.SourceUUID, "title": item.Title, "newUuid": item.NewUUID, "ossPath": item.OSSPath})
	}
	result := map[string]any{"operationId": id, "imported": imported, "skipped": []any{}}
	raw, _ := json.Marshal(result)
	if _, err = tx.ExecContext(ctx, `UPDATE company_asset_quick_publish_operations SET result_json=?,completed_at=NOW() WHERE operation_id=?`, string(raw), id); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}
