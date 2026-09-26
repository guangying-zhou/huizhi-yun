package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"strings"
	"time"
)

const EnterpriseProjectMemberAddCapability = "aims:project-member-add:execute"
const EnterpriseProjectMemberRoleCapability = "aims:project-member-role:execute"
const EnterpriseProjectMemberRemoveCapability = "aims:project-member-remove:execute"

type EnterpriseProjectMemberIdentity = EnterpriseProjectUpdateIdentity

func (a *Adapter) WriteEnterpriseProjectMember(ctx context.Context, identity EnterpriseProjectMemberIdentity, projectID, action string, command map[string]any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	id, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(fmt.Sprint(command["uid"]))
	for key := range command {
		if key != "uid" && key != "role" {
			return nil, httperror.New(400, "project_member_field_invalid", "Invalid member field")
		}
	}
	if uid == "" || uid == "<nil>" {
		return nil, httperror.New(400, "missing_uid", "uid is required")
	}
	role := strings.TrimSpace(fmt.Sprint(command["role"]))
	if action == "remove" {
		role = ""
	}
	capability := map[string]string{"add": EnterpriseProjectMemberAddCapability, "role": EnterpriseProjectMemberRoleCapability, "remove": EnterpriseProjectMemberRemoveCapability}[action]
	if capability == "" {
		return nil, httperror.New(400, "project_member_action_invalid", "Invalid member action")
	}
	if action != "remove" && role != "manager" && role != "member" && role != "viewer" {
		return nil, httperror.New(400, "project_member_role_invalid", "Invalid project member role")
	}
	base := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, RequestID: identity.RequestID, IdempotencyKey: identity.IdempotencyKey, Personnel: identity.Personnel}
	required := map[string]string{}
	if action != "remove" {
		required["uid"] = uid
	}
	if err := validateEnterprisePersonnel(base, required, "project-members", projectID, action, time.Now()); err != nil {
		return nil, err
	}
	ri, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "action": action, "input": command})
	if err != nil {
		return nil, err
	}
	ri.OperationCode = "enterprise.aims.project-members." + action + ".v1"
	ri.RequiredCapability = capability
	ri.CommandSchemaVersion = "project-member-" + action + ".v1"
	tx, repo, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	executed, err := repo.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		var leader string
		var managers int
		if err := tx.QueryRowContext(ctx, `SELECT p.leader_uid,COUNT(CASE WHEN m.uid=? AND m.role='manager' AND m.status='active' THEN 1 END) FROM aims_projects p LEFT JOIN aims_project_members m ON m.project_id=p.id WHERE p.id=? GROUP BY p.id FOR UPDATE`, identity.ActorUID, id).Scan(&leader, &managers); err == sql.ErrNoRows {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(404, "project_not_found", "Project not found")
		} else if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if identity.ActorUID != leader && managers == 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(403, "project_manager_required", "Project manager access required")
		}
		if action == "add" {
			if _, err := tx.ExecContext(ctx, "INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(?,?,?,'active')", id, uid, role); err != nil {
				var sqlError *mysql.MySQLError
				if errors.As(err, &sqlError) && sqlError.Number == 1062 {
					return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "project_member_exists", "User is already a project member")
				}
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		} else {
			var currentRole string
			if err := tx.QueryRowContext(ctx, "SELECT role FROM aims_project_members WHERE project_id=? AND uid=? FOR UPDATE", id, uid).Scan(&currentRole); err == sql.ErrNoRows {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(404, "project_member_not_found", "Project member not found")
			} else if err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			if err := validateEnterpriseProjectMemberRemoval(leader, identity.ActorUID, uid, action, role); err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
			if action == "role" {
				_, err = tx.ExecContext(ctx, "UPDATE aims_project_members SET role=?,status='active' WHERE project_id=? AND uid=?", role, id, uid)
			} else {
				if uid == identity.ActorUID {
					return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "cannot_remove_self", "Project manager cannot remove self")
				}
				var work int
				if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_items WHERE project_id=? AND assignee_uid=?", id, uid).Scan(&work); err == nil && work > 0 {
					return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "project_member_has_work_items", "Member has assigned work items")
				}
				if err == nil {
					_, err = tx.ExecContext(ctx, "DELETE FROM aims_project_members WHERE project_id=? AND uid=?", id, uid)
				}
			}
			if err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		}
		value := map[string]any{"projectId": id, "uid": uid, "action": action}
		if role != "" {
			value["role"] = role
		}
		changes, err := json.Marshal(value)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'member',?,?,?,?,?)", id, uid, action, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "project_member", TargetBizCode: projectID + ":" + uid, HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": executed.ReceiptID, "idempotent": executed.Existing, "result": executed.Value}, nil
}

func validateEnterpriseProjectMemberRemoval(leader, actor, uid, action, role string) error {
	if uid == leader && (action == "remove" || role != "manager") {
		return httperror.New(409, "project_last_leader", "Project leader must remain a manager")
	}
	if action == "remove" && uid == actor {
		return httperror.New(409, "cannot_remove_self", "Project manager cannot remove self")
	}
	return nil
}
