package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const EnterpriseWorkItemCreateCapability = "aims:work-item-create:execute"
const EnterpriseWorkItemEditCapability = "aims:work-item-edit:execute"
const EnterpriseWorkItemAssociateCapability = "aims:work-item-associate:execute"

var enterpriseWorkItemBasicFields = map[string]bool{"title": true, "description": true, "priority": true, "assigneeUid": true, "startDate": true, "dueDate": true, "estimatedHours": true}
var enterpriseWorkItemCreateFields = map[string]bool{"title": true, "description": true, "priority": true, "assigneeUid": true, "startDate": true, "dueDate": true, "estimatedHours": true, "type": true, "tier": true, "milestoneId": true, "routineScope": true, "beneficiaryDeptCode": true, "isUnplanned": true, "reviewLevel": true, "required": true, "severity": true, "weight": true}

func enterpriseWorkItemSnapshot(ctx context.Context, q aimsQueryer, id string, lock bool) (map[string]any, string, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	m, err := aimsQueryOneMap(ctx, q, "SELECT id,project_id,item_key,title,description,priority,assignee_uid,start_date,due_date,estimated_hours,status,type,tier,milestone_id,parent_id,version_id,feature_id FROM work_items WHERE id=?"+suffix, id)
	if err != nil {
		return nil, "", err
	}
	if m == nil {
		return nil, "", httperror.New(404, "work_item_not_found", "Work item not found")
	}
	raw, err := json.Marshal(m)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(raw)
	return m, hex.EncodeToString(sum[:]), nil
}
func (a *Adapter) EnterpriseWorkItemEditableSnapshot(ctx context.Context, id string) (map[string]any, string, error) {
	return enterpriseWorkItemSnapshot(ctx, a.DB(), id, false)
}
func (a *Adapter) WriteEnterpriseWorkItem(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID, itemID, action string, command map[string]any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	pid, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	fields, capability := enterpriseWorkItemCreateFields, EnterpriseWorkItemCreateCapability
	if action == "edit" {
		fields = enterpriseWorkItemBasicFields
		capability = EnterpriseWorkItemEditCapability
	} else if action == "associate" {
		fields = map[string]bool{"versionId": true, "featureId": true}
		capability = EnterpriseWorkItemAssociateCapability
	} else if action != "create" {
		return nil, httperror.New(400, "work_item_action_invalid", "Invalid work item action")
	}
	for key := range command {
		if action != "create" && key == "expectedVersion" {
			continue
		}
		if !fields[key] {
			return nil, httperror.New(400, "work_item_field_deferred", "Work item state and structural editing are not migrated")
		}
	}
	expected, _ := command["expectedVersion"].(string)
	if action != "create" && len(expected) != 64 {
		return nil, httperror.New(400, "work_item_version_required", "Work item content version is required")
	}
	base := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, RequestID: identity.RequestID, IdempotencyKey: identity.IdempotencyKey, Personnel: identity.Personnel}
	required := map[string]string{}
	if uid := firstBodyText(command, "assigneeUid"); uid != "" {
		required["assigneeUid"] = uid
	}
	objectID := itemID
	if action == "create" {
		objectID = "project:" + projectID
	}
	if err := validateEnterprisePersonnel(base, required, "work_items", objectID, action, time.Now()); err != nil {
		return nil, err
	}
	ri, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "action": action, "input": command})
	if err != nil {
		return nil, err
	}
	ri.OperationCode = "enterprise.aims.work-items." + action + ".v1"
	ri.RequiredCapability = capability
	ri.CommandSchemaVersion = "work-item-" + action + ".v1"
	tx, repo, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	executed, err := repo.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		var exists int
		if err := tx.QueryRowContext(ctx, "SELECT 1 FROM aims_projects WHERE id=? FOR UPDATE", pid).Scan(&exists); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		query := url.Values{"current_user": {identity.ActorUID}, "operator_uid": {identity.ActorUID}}
		var allowed int
		roleCondition := "m.id IS NOT NULL"
		if action == "create" {
			roleCondition = "m.role='manager'"
		}
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p LEFT JOIN aims_project_members m ON m.project_id=p.id AND m.uid=? AND m.status='active' WHERE p.id=? AND (p.leader_uid=? OR "+roleCondition+") FOR UPDATE", identity.ActorUID, pid, identity.ActorUID).Scan(&allowed); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if allowed == 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(403, "project_access_denied", "Project access required")
		}
		var before any
		var result map[string]any
		if uid, ok := command["assigneeUid"].(string); ok && strings.TrimSpace(uid) != "" {
			var active int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM aims_projects p LEFT JOIN aims_project_members m ON m.project_id=p.id AND m.uid=? AND m.status='active' WHERE p.id=? AND (p.leader_uid=? OR m.id IS NOT NULL) FOR UPDATE`, uid, pid, uid).Scan(&active); err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			if active == 0 {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(400, "work_item_assignee_invalid", "Assignee must be an active project member")
			}
		}
		if action == "create" {
			if milestone, err := bodyInt64(command, "milestoneId"); err == nil && milestone > 0 {
				var bound int
				if err := tx.QueryRowContext(ctx, "SELECT 1 FROM milestones WHERE id=? AND project_id=? FOR UPDATE", milestone, pid).Scan(&bound); err != nil {
					return integrationoperation.ReceiptBusinessResult{}, httperror.New(403, "work_item_milestone_mismatch", "Milestone must belong to the project")
				}
			}
			result, err = a.createProjectWorkItemWithExternalTx(ctx, tx, projectID, query, command)
			if err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			itemID = fmt.Sprint(result["id"])
		} else {
			snapshot, version, e := enterpriseWorkItemSnapshot(ctx, tx, itemID, true)
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			if fmt.Sprint(snapshot["project_id"]) != projectID {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(403, "work_item_project_mismatch", "Work item does not belong to the project")
			}
			if version != expected {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "work_item_version_conflict", "Work item changed; reload before editing")
			}
			before = snapshot
			if err := a.requireEnterpriseWorkItemReviewUnlockedTx(ctx, tx, snapshot); err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			if err := a.requireWorkItemProjectMemberOrScopedAdmin(ctx, itemID, query); err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			if mid := serviceBodyInt(snapshot, "milestone_id"); mid > 0 {
				if err := requireMilestoneCompletionUnlockedTx(ctx, tx, int64(mid)); err != nil {
					return integrationoperation.ReceiptBusinessResult{}, err
				}
			}
			project, err := a.projectWorkItemProject(ctx, pid)
			if err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			if err = validateProjectWorkItemLifecycle(project.LifecycleStatus, aimsMapText(snapshot, "tier")); err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			body := map[string]any{}
			for key, value := range command {
				if key != "expectedVersion" {
					body[key] = value
				}
			}
			if len(body) == 0 {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(400, "work_item_update_empty", "At least one editable field is required")
			}
			if title, ok := body["title"]; ok && (title == nil || strings.TrimSpace(fmt.Sprint(title)) == "") {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(400, "missing_title", "title is required")
			}
			if action == "associate" {
				err = a.applyEnterpriseWorkItemAssociationTx(ctx, tx, itemID, pid, query, body)
				if err == nil {
					raw, _ := json.Marshal(body)
					_, err = tx.ExecContext(ctx, "INSERT INTO work_item_changelog(work_item_id,field_name,old_value,new_value,changed_by) VALUES(?,'version_association',?,?,?)", itemID, expected, string(raw), identity.ActorUID)
				}
			} else {
				_, err = a.Adapter.HandleRuntimeUpdateInTransactionWithTxHook(ctx, tx, "/v1/aims/work-items/"+itemID, query, body, func(ctx context.Context, tx *sql.Tx, id string) (map[string]any, error) {
					if err := validateRoutineWorkItemTx(ctx, tx, id); err != nil {
						return nil, err
					}
					raw, _ := json.Marshal(body)
					_, err := tx.ExecContext(ctx, "INSERT INTO work_item_changelog(work_item_id,field_name,old_value,new_value,changed_by) VALUES(?,'basic_information',?,?,?)", itemID, expected, string(raw), identity.ActorUID)
					return map[string]any{}, err
				})
			}
			if err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		}
		after, version, err := enterpriseWorkItemSnapshot(ctx, tx, itemID, false)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		changes, _ := json.Marshal(map[string]any{"before": before, "after": after, "version": version})
		if _, err = tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,?,?,?,?)", pid, itemID, action, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		result = map[string]any{"id": itemID, "itemKey": after["item_key"], "projectId": pid, "editVersion": version}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "work_item", TargetBizCode: itemID, HTTPStatus: http.StatusOK, Value: result}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": executed.ReceiptID, "idempotent": executed.Existing, "result": executed.Value}, nil
}
