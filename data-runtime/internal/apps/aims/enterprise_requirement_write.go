package aims

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type enterpriseRequirementTxKey struct{}
type enterpriseRequirementIdentityKey struct{}
type enterpriseRequirementIdentity struct {
	ActorUID  string
	ProjectID int64
}

func hasEnterpriseRequirementTransaction(ctx context.Context) bool {
	_, ok := ctx.Value(enterpriseRequirementTxKey{}).(*sql.Tx)
	return ok
}
func (a *Adapter) requirementDB(ctx context.Context) documentExecutor {
	if tx, ok := ctx.Value(enterpriseRequirementTxKey{}).(*sql.Tx); ok {
		return tx
	}
	return a.DB()
}

// The outer Host transaction owns both the business writes and the receipt.
func (a *Adapter) requireRequirementBoundProjectManagerOrScopedAdmin(ctx context.Context, projectID int64, uid string, q url.Values) error {
	if id, ok := ctx.Value(enterpriseRequirementIdentityKey{}).(enterpriseRequirementIdentity); ok {
		if id.ActorUID != uid || id.ProjectID != projectID {
			return httperror.New(403, "requirement_project_mismatch", "Requirement project identity mismatch")
		}
		return nil
	}
	return a.requireProjectManagerOrScopedAdmin(ctx, projectID, uid, q)
}

func (a *Adapter) beginRequirementTransaction(ctx context.Context) (*sql.Tx, func(bool) error, error) {
	if tx, ok := ctx.Value(enterpriseRequirementTxKey{}).(*sql.Tx); ok {
		return tx, func(bool) error { return nil }, nil
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	return tx, func(commit bool) error {
		if commit {
			return tx.Commit()
		}
		return tx.Rollback()
	}, err
}

var enterpriseRequirementFields = map[string][]string{
	"create":         {"title", "type", "category", "priority", "source", "milestoneId", "workItemId", "scopeNote", "contentIds", "content"},
	"content-create": {"kind", "title", "parentId", "headingDepth", "contentMd"},
	"import":         {"source", "docName", "codocsUuid", "repoProjectCode", "repoFilePath", "repoCommitId", "mode", "headingLevels", "forceOverwrite", "workItemId", "items"},
	"update":         {"title", "type", "category", "priority", "source", "milestoneId"},
	"delete":         {}, "content-update": {"title", "contentMd"}, "content-delete": {}, "content-restore": {},
	"change-create": {"reason", "workItemId", "contents"},
	"task-create":   {"title", "description", "milestoneId", "assigneeUid", "estimatedHours", "priority", "startDate", "dueDate", "reviewLevel", "deliverables"},
	"review-create": {"title", "description", "batchType", "requirementIds"},
	"review-append": {"requirementIds"}, "review-withdraw": {},
	"review-sync": {}, "review-create-tasks": {},
}

func validateEnterpriseRequirementPayload(action string, body map[string]any) error {
	fields, ok := enterpriseRequirementFields[action]
	if !ok {
		return httperror.New(400, "requirement_action_invalid", "Requirement action is invalid")
	}
	for key, v := range body {
		allowed := false
		for _, field := range fields {
			allowed = allowed || key == field
		}
		if !allowed {
			return httperror.New(400, "requirement_input_invalid", "Unsupported requirement field")
		}
		switch key {
		case "milestoneId", "workItemId", "parentId", "reviewLevel":
			if v != nil {
				if _, _, e := optionalBodyID(body, key); e != nil {
					return httperror.New(400, "requirement_input_invalid", "Invalid object ID")
				}
			}
		case "headingDepth":
			n, e := requiredRequirementContentBodyInt(body, key)
			if e != nil || n < 2 || n > 6 {
				return httperror.New(400, "requirement_input_invalid", "Invalid heading depth")
			}
		case "forceOverwrite":
			if _, ok := v.(bool); !ok {
				return httperror.New(400, "requirement_input_invalid", "Invalid overwrite flag")
			}
		case "contentIds", "requirementIds":
			ids, ok := v.([]any)
			if !ok || len(ids) > 1000 {
				return httperror.New(400, "requirement_input_invalid", "Invalid content IDs")
			}
			for _, id := range ids {
				if _, _, e := optionalBodyID(map[string]any{"id": id}, "id"); e != nil || int64BodyValue(map[string]any{"id": id}, "id") <= 0 {
					return httperror.New(400, "requirement_input_invalid", "Invalid content ID")
				}
			}
		case "content":
			m, ok := v.(map[string]any)
			if !ok {
				return httperror.New(400, "requirement_input_invalid", "Invalid inline content")
			}
			if err := validateEnterpriseRequirementPayload("content-create", m); err != nil {
				return err
			}
		case "estimatedHours":
			n, ok := v.(float64)
			if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 100000 {
				return httperror.New(400, "requirement_input_invalid", "Invalid hours")
			}
		case "contents":
			nodes, ok := v.([]any)
			if !ok || len(nodes) == 0 || len(nodes) > 1000 {
				return httperror.New(400, "requirement_input_invalid", "Invalid change chapters")
			}
			for _, raw := range nodes {
				node, ok := raw.(map[string]any)
				if !ok {
					return httperror.New(400, "requirement_input_invalid", "Invalid change chapter")
				}
				for k, v := range node {
					switch k {
					case "contentId":
						if _, yes, e := optionalBodyID(node, k); e != nil || !yes {
							return httperror.New(400, "requirement_input_invalid", "Invalid change content ID")
						}
					case "title", "contentMd":
						if _, ok := v.(string); !ok {
							return httperror.New(400, "requirement_input_invalid", "Invalid change text")
						}
					default:
						return httperror.New(400, "requirement_input_invalid", "Unsupported change field")
					}
				}
			}
		case "deliverables":
			nodes, ok := v.([]any)
			if !ok || len(nodes) > 100 {
				return httperror.New(400, "requirement_input_invalid", "Invalid deliverables")
			}
			for _, raw := range nodes {
				node, ok := raw.(map[string]any)
				if !ok {
					return httperror.New(400, "requirement_input_invalid", "Invalid deliverable")
				}
				for k, v := range node {
					switch k {
					case "name", "deliverableType", "description", "acceptanceCriteria":
						if _, ok := v.(string); !ok {
							return httperror.New(400, "requirement_input_invalid", "Invalid deliverable text")
						}
					case "required":
						if _, ok := v.(bool); !ok {
							return httperror.New(400, "requirement_input_invalid", "Invalid requirement flag")
						}
					default:
						return httperror.New(400, "requirement_input_invalid", "Unsupported deliverable field")
					}
				}
			}
		case "items":
			if err := validateEnterpriseRequirementImportItems(v, 0, new(int)); err != nil {
				return err
			}
		default:
			if v != nil {
				text, ok := v.(string)
				if !ok || len(text) > 2*1024*1024 {
					return httperror.New(400, "requirement_input_invalid", "Invalid requirement text")
				}
			}
		}
	}
	if value, ok := body["title"]; ok && (value == nil || strings.TrimSpace(fmt.Sprint(value)) == "") {
		return httperror.New(400, "invalid_title", "需求标题不能为空")
	}
	if action == "review-create" && body["batchType"] != "baseline" && body["batchType"] != "change" {
		return httperror.New(400, "requirement_input_invalid", "Invalid review type")
	}
	if action == "create" || action == "content-create" {
		if _, ok := body["title"]; !ok {
			return httperror.New(400, "invalid_title", "需求标题不能为空")
		}
	}
	for key, values := range map[string][]string{"type": {"functional", "non_functional"}, "priority": {"P0", "P1", "P2", "P3"}, "source": {"customer", "internal", "compliance", "regulation", "other"}} {
		if action == "import" && key == "source" {
			continue
		}
		if v, ok := body[key]; ok && !containsString(values, fmt.Sprint(v)) {
			return httperror.New(400, "requirement_input_invalid", "Invalid requirement option")
		}
	}
	return nil
}
func validateEnterpriseRequirementImportItems(raw any, depth int, count *int) error {
	items, ok := raw.([]any)
	if !ok || depth > 6 || len(items) == 0 && depth == 0 {
		return httperror.New(400, "requirement_import_invalid", "Invalid specification outline")
	}
	for _, v := range items {
		*count++
		if *count > 1000 {
			return httperror.New(400, "requirement_import_invalid", "Specification outline exceeds the limit")
		}
		item, ok := v.(map[string]any)
		if !ok {
			return httperror.New(400, "requirement_import_invalid", "Invalid specification item")
		}
		for k, v := range item {
			switch k {
			case "children":
				if err := validateEnterpriseRequirementImportItems(v, depth+1, count); err != nil {
					return err
				}
			case "asRequirement":
				if _, ok := v.(bool); !ok {
					return httperror.New(400, "requirement_import_invalid", "Invalid requirement flag")
				}
			case "headingDepth":
				n, e := requiredRequirementContentBodyInt(item, k)
				if e != nil || n < 1 || n > 6 {
					return httperror.New(400, "requirement_import_invalid", "Invalid heading depth")
				}
			case "title", "contentMd", "mergeGroupId", "requirementType", "requirementCategory":
				if v != nil {
					if _, ok := v.(string); !ok {
						return httperror.New(400, "requirement_import_invalid", "Invalid specification text")
					}
				}
			default:
				return httperror.New(400, "requirement_import_invalid", "Unsupported specification item field")
			}
		}
		if strings.TrimSpace(firstBodyText(item, "title")) == "" {
			return httperror.New(400, "requirement_import_invalid", "Specification title is required")
		}
	}
	return nil
}

// All object references, including the parent chain, are checked before any
// receipt is read. A public company project has no write exception here.
func requireRequirementObjectProjectTx(ctx context.Context, tx *sql.Tx, table string, objectID, projectID int64, allowMissing bool) error {
	var actual int64
	err := tx.QueryRowContext(ctx, "SELECT project_id FROM "+table+" WHERE id=? FOR UPDATE", objectID).Scan(&actual)
	if errors.Is(err, sql.ErrNoRows) {
		if allowMissing {
			return nil
		}
		return httperror.New(404, "requirement_object_not_found", "Requirement object not found")
	}
	if err != nil {
		return err
	}
	if actual != projectID {
		return httperror.New(403, "requirement_project_mismatch", "Requirement object belongs to another project")
	}
	return nil
}
func (a *Adapter) WriteEnterpriseRequirement(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID, objectID, action string, body map[string]any) (map[string]any, error) {
	if identity.ActorUID == "" || identity.CommandScope == nil || identity.IdempotencyKey == "" {
		return nil, httperror.New(403, "requirement_permit_invalid", "Requirement authorization is required")
	}
	if err := validateEnterpriseRequirementPayload(action, body); err != nil {
		return nil, err
	}
	pid, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	var instance map[string]any
	if action == "review-sync" {
		instance, err = a.readRequirementReviewWorkflow(ctx, objectID)
		if err != nil {
			return nil, err
		}
	}
	ctx = WithEnterpriseProjectCommandScope(ctx, identity)
	tx, repo, err := a.beginDeliverableWrite(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = requireEnterpriseProjectCommandScopeTx(ctx, tx, identity, projectID, "", "requirement"); err != nil {
		return nil, err
	}
	q := url.Values{"current_user": {identity.ActorUID}, "operator_uid": {identity.ActorUID}}
	for key, value := range identity.ProjectScope {
		q.Set(key, value)
	}
	adminWhere, adminArgs := projectScopedAdminWhere(q, "p")
	args := append([]any{identity.ActorUID, pid, identity.ActorUID}, adminArgs...)
	var managers int
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM aims_projects p LEFT JOIN aims_project_members pm ON pm.project_id=p.id AND BINARY pm.uid=BINARY ? AND COALESCE(pm.status,'active')='active' WHERE p.id=? AND (BINARY p.leader_uid=BINARY ? OR pm.role='manager' OR `+adminWhere+`)`, args...).Scan(&managers)
	if err != nil {
		return nil, err
	}
	if managers == 0 {
		return nil, httperror.New(403, "project_manager_required", "Project management access is required")
	}
	var lifecycle string
	if err = tx.QueryRowContext(ctx, "SELECT lifecycle_status FROM aims_projects WHERE id=? FOR UPDATE", pid).Scan(&lifecycle); err != nil {
		return nil, err
	}
	if lifecycle != "active" {
		return nil, httperror.New(409, "project_not_active", "项目当前状态不允许此操作")
	}
	oid := int64(0)
	if objectID != "" {
		oid, err = parseID(objectID, "object_id")
		if err != nil {
			return nil, err
		}
		table := "requirement_items"
		if strings.HasPrefix(action, "review-") {
			table = "requirement_review_batches"
		}
		if strings.HasPrefix(action, "content-") {
			table = "requirement_contents"
		}
		if err = requireRequirementObjectProjectTx(ctx, tx, table, oid, pid, action == "delete" || action == "review-withdraw"); err != nil {
			return nil, err
		}
	}
	for key, table := range map[string]string{"milestoneId": "milestones", "workItemId": "work_items", "parentId": "requirement_contents"} {
		if id, ok, e := optionalBodyID(body, key); e != nil {
			return nil, e
		} else if ok && id > 0 {
			if err = requireRequirementObjectProjectTx(ctx, tx, table, id, pid, false); err != nil {
				return nil, err
			}
		}
	}
	if ids, ok := body["contentIds"].([]any); ok {
		for _, id := range ids {
			if err = requireRequirementObjectProjectTx(ctx, tx, "requirement_contents", int64BodyValue(map[string]any{"id": id}, "id"), pid, false); err != nil {
				return nil, err
			}
		}
	}
	if inline, ok := body["content"].(map[string]any); ok {
		if id, ok, e := optionalBodyID(inline, "parentId"); e != nil {
			return nil, e
		} else if ok && id > 0 {
			if err = requireRequirementObjectProjectTx(ctx, tx, "requirement_contents", id, pid, false); err != nil {
				return nil, err
			}
		}
	}
	if err = validateRequirementReviewReferencesTx(ctx, tx, pid, oid, action, body); err != nil {
		return nil, err
	}
	if action == "import" {
		if err = validateRequirementImportSourceTx(ctx, tx, pid, body); err != nil {
			return nil, err
		}
	}
	if err = requireRequirementConnectedObjectsTx(ctx, tx, pid, oid, action); err != nil {
		return nil, err
	}
	ctx = context.WithValue(ctx, enterpriseRequirementTxKey{}, tx)
	ctx = context.WithValue(ctx, enterpriseRequirementIdentityKey{}, enterpriseRequirementIdentity{identity.ActorUID, pid})
	if action == "review-sync" {
		out, syncErr := a.syncEnterpriseRequirementReviewTx(ctx, tx, pid, oid, identity.ActorUID, instance)
		if syncErr != nil {
			return nil, syncErr
		}
		if identity.CommandScope.ExpiresAt <= time.Now().UnixMilli() {
			return nil, httperror.New(403, "requirement_permit_expired", "Requirement authorization expired")
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return out, nil
	}
	input, err := enterpriseDeliverableReceiptInput(ctx, action, "aims:enterprise-host:execute", "requirement-command.v1", map[string]any{"projectId": projectID, "objectId": objectID, "payload": body})
	if err != nil {
		return nil, err
	}
	input.OperationCode = "enterprise.aims.requirements." + action + ".v1"
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(writeCtx context.Context, _ *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		var value map[string]any
		var e error
		switch action {
		case "change-create":
			value, e = a.createRequirementChangeDraft(writeCtx, objectID, q, body)
		case "task-create":
			value, e = a.createRequirementTask(writeCtx, objectID, q, body)
		case "review-create":
			value, e = a.createRequirementReviewBatch(writeCtx, projectID, q, body)
		case "review-append":
			value, e = a.appendRequirementsToReviewBatch(writeCtx, objectID, q, body)
		case "review-create-tasks":
			value, e = a.createTasksForReviewBatch(writeCtx, objectID, q)
			if e == nil {
				value = map[string]any{"batchId": value["batchId"], "createdCount": value["createdCount"], "skippedCount": value["skippedCount"]}
			}
		case "review-withdraw":
			value, e = a.withdrawRequirementReviewBatch(writeCtx, objectID, q)
		case "create":
			value, e = a.createProjectRequirement(writeCtx, projectID, q, body)
		case "content-create":
			value, e = a.createProjectRequirementContent(writeCtx, projectID, q, body)
		case "import":
			value, e = a.importProjectRequirements(writeCtx, projectID, q, body)
		case "update":
			value, e = a.updateRequirementMetadata(writeCtx, objectID, q, body)
		case "delete":
			value, e = a.deleteRequirement(writeCtx, objectID, q)
		case "content-update":
			value, e = a.updateRequirementContent(writeCtx, objectID, q, body)
		case "content-delete":
			value, e = a.deleteRequirementContent(writeCtx, objectID, q)
		case "content-restore":
			value, e = a.restoreRequirementContent(writeCtx, objectID, q)
		}
		if e != nil {
			return iop.ReceiptBusinessResult{}, e
		}
		if identity.CommandScope.ExpiresAt <= time.Now().UnixMilli() {
			return iop.ReceiptBusinessResult{}, httperror.New(403, "requirement_permit_expired", "Requirement authorization expired")
		}
		code := requirementReceiptCode(projectID, objectID, action, value)
		if code == "" || len(code) > 191 {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "receipt_result_unavailable", "Requirement receipt outcome exceeds the limit")
		}
		return iop.ReceiptBusinessResult{TargetBizType: "project-requirement-command", TargetBizCode: code, HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if result.TargetBizType != "project-requirement-command" {
		return nil, httperror.New(409, "receipt_result_unavailable", "Requirement receipt binding is invalid")
	}
	value, err := requirementReceiptValue(projectID, objectID, action, result.TargetBizCode, body)
	if err != nil {
		return nil, err
	}

	if err = tx.Commit(); err != nil {
		return nil, err
	}
	value["receiptId"], value["idempotent"] = result.ReceiptID, result.Existing
	return value, nil
}
func validateRequirementImportSourceTx(ctx context.Context, tx *sql.Tx, projectID int64, body map[string]any) error {
	var count int
	switch firstBodyText(body, "source") {
	case "codocs":
		uuid := firstBodyText(body, "codocsUuid")
		if uuid == "" {
			return httperror.New(400, "codocs_uuid_required", "Codocs UUID is required")
		}
		// The owning Host core rechecks Codocs source ACL before signing this
		// fixed U request. Import creates the specification reference itself.
		if !regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`).MatchString(uuid) {
			return httperror.New(400, "codocs_uuid_required", "Invalid Codocs UUID")
		}
		return nil
	case "repo":
		code := firstBodyText(body, "repoProjectCode")
		if !(len(code) <= 255 && !strings.Contains(code, "..") && regexp.MustCompile(`^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$`).MatchString(code)) || firstBodyText(body, "repoFilePath") == "" || firstBodyText(body, "repoCommitId") == "" {
			return httperror.New(400, "repo_params_required", "Fixed repository document version is required")
		}
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_repos WHERE project_id=? AND BINARY repo_project_code=BINARY ?", projectID, code).Scan(&count); err != nil {
			return err
		}
	default:
		return httperror.New(400, "requirement_import_source_invalid", "Invalid specification source")
	}
	if count == 0 {
		return httperror.New(403, "requirement_import_source_denied", "Specification source is not associated with the project")
	}
	return nil
}

// The existing receipt stores a compact immutable outcome in TargetBizCode,
// rather than adding a parallel receipt table or replaying mutable current data.
func requirementReceiptCode(project, object, action string, value map[string]any) string {
	if strings.HasPrefix(action, "review-") || action == "change-create" || action == "task-create" {
		return requirementExtendedReceiptCode(project, object, action, value)
	}
	values := []any{project, object, action, value["id"], value["reqNumber"], value["reqCode"], value["contentsCreated"], value["requirementsCreated"], value["markedCount"], value["restoredCount"], value["changed"], value["deleted"], value["deprecated"]}
	count := 0
	switch ids := value["childContentIds"].(type) {
	case []any:
		count = len(ids)
	case []int64:
		count = len(ids)
	}
	values = append(values, count)
	raw, _ := json.Marshal(values)
	return "r1." + base64.RawURLEncoding.EncodeToString(raw)
}
func requirementReceiptValue(project, object, action, code string, body map[string]any) (map[string]any, error) {
	if strings.HasPrefix(code, "r2.") {
		return requirementExtendedReceiptValue(project, object, action, code)
	}
	var v []any
	raw, decodeErr := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(code, "r1."))
	if !strings.HasPrefix(code, "r1.") || decodeErr != nil || json.Unmarshal(raw, &v) != nil || len(v) != 14 || v[0] != project || v[1] != object || v[2] != action {
		return nil, httperror.New(409, "receipt_result_unavailable", "Requirement receipt binding is invalid")
	}
	out := map[string]any{}
	for i, k := range []string{"id", "reqNumber", "reqCode", "contentsCreated", "requirementsCreated", "markedCount", "restoredCount", "changed", "deleted", "deprecated", "childContentCount"} {
		if v[i+3] != nil {
			out[k] = v[i+3]
		}
	}
	if action == "create" {

		out["title"] = strings.TrimSpace(firstBodyText(body, "title"))
		out["type"] = firstNonEmptyText(firstBodyText(body, "type"), "functional")
		out["priority"] = firstNonEmptyText(firstBodyText(body, "priority"), "P2")
		out["source"] = firstNonEmptyText(firstBodyText(body, "source"), "internal")
		out["status"] = "draft"
	}
	if action == "content-create" {
		out["title"] = body["title"]
	}
	if action == "import" {
		out["importStatus"] = "imported_clean"
	}
	return out, nil
}

func requireRequirementConnectedObjectsTx(ctx context.Context, tx *sql.Tx, pid, oid int64, action string) error {
	rows, err := tx.QueryContext(ctx, "SELECT id,project_id,parent_id FROM requirement_contents WHERE project_id=? OR parent_id IN (SELECT id FROM requirement_contents WHERE project_id=?) ORDER BY id FOR UPDATE", pid, pid)
	if err != nil {
		return err
	}
	type node struct {
		project int64
		parent  sql.NullInt64
	}
	nodes := map[int64]node{}
	for rows.Next() {
		var id int64
		var n node
		if err = rows.Scan(&id, &n.project, &n.parent); err != nil {
			rows.Close()
			return err
		}
		nodes[id] = n
		if len(nodes) > 10000 {
			rows.Close()
			return httperror.New(503, "requirement_graph_limit", "Requirement hierarchy exceeds the supported limit")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	// Validate all touched-project edges. Foreign children must not be modified by
	// a recursive domain operation; missing/cyclic ancestors fail closed too.
	for id, n := range nodes {
		if n.project != pid {
			if n.parent.Valid && nodes[n.parent.Int64].project == pid {
				return httperror.New(403, "requirement_project_mismatch", "Requirement hierarchy crosses projects")
			}
			continue
		}
		seen := map[int64]bool{}
		for current := id; current != 0; {
			if seen[current] {
				return httperror.New(409, "requirement_hierarchy_invalid", "Requirement hierarchy is invalid")
			}
			seen[current] = true
			p, ok := nodes[current]
			if !ok || p.project != pid {
				return httperror.New(403, "requirement_project_mismatch", "Requirement hierarchy crosses projects")
			}
			if p.parent.Valid {
				current = p.parent.Int64
			} else {
				current = 0
			}
		}
	}
	if action == "delete" && oid > 0 {
		var bad int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM requirement_item_contents r JOIN requirement_contents c ON c.id=r.content_id WHERE r.requirement_id=? AND c.project_id<>?", oid, pid).Scan(&bad); err != nil {
			return err
		}
		if bad > 0 {
			return httperror.New(403, "requirement_project_mismatch", "Requirement content belongs to another project")
		}
	}
	return nil
}
