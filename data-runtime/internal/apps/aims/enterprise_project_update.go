package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const EnterpriseProjectUpdateOperation = "enterprise.aims.projects.update.v1"
const EnterpriseProjectUpdateCapability = "aims:project-edit:execute"

type EnterpriseProjectUpdateIdentity struct {
	ProjectScope                                                                                     map[string]string
	Tenant, SourceDeployment, TargetDeployment, ActorUID, ServiceClientID, RequestID, IdempotencyKey string
	Personnel                                                                                        []EnterprisePersonnelPermit
}

var enterpriseProjectUpdateColumns = map[string]string{"name": "name", "shortName": "short_name", "internalCode": "internal_code", "description": "description", "methodology": "methodology", "portfolioId": "portfolio_id", "domainCode": "domain_code", "deptCode": "dept_code", "leaderUid": "leader_uid", "startDate": "start_date", "endDate": "end_date"}

func (a *Adapter) UpdateEnterpriseProject(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID string, command map[string]any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	id, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	if len(command) < 2 {
		return nil, httperror.New(400, "project_update_empty", "At least one project field is required")
	}
	expectedVersion, ok := command["expectedVersion"].(string)
	if !ok || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(expectedVersion) {
		return nil, httperror.New(400, "project_version_required", "A valid project content version is required")
	}
	for key := range command {
		if key == "expectedVersion" {
			continue
		}
		if _, ok := enterpriseProjectUpdateColumns[key]; !ok {
			return nil, httperror.New(400, "project_update_field_invalid", "Project field is not editable")
		}
		if key != "portfolioId" && command[key] != nil {
			if _, ok := command[key].(string); !ok {
				return nil, httperror.New(400, "project_field_type_invalid", "Project text fields must be strings")
			}
		}
	}
	for _, key := range []string{"name", "shortName", "leaderUid"} {
		if value, ok := command[key]; ok && (value == nil || strings.TrimSpace(fmt.Sprint(value)) == "") {
			return nil, httperror.New(400, "project_required_field_empty", key+" cannot be empty")
		}
	}
	if value, ok := command["name"]; ok && !regexp.MustCompile(`^[\p{Han}a-zA-Z0-9]+(?:[vV]\d+)?$`).MatchString(fmt.Sprint(value)) {
		return nil, httperror.New(400, "project_name_invalid", "Project name only accepts Chinese characters, letters and digits")
	}
	for key, max := range map[string]int{"name": 200, "shortName": 50, "internalCode": 50, "domainCode": 50, "deptCode": 50, "leaderUid": 64} {
		if value, ok := command[key]; ok && len([]rune(fmt.Sprint(value))) > max {
			return nil, httperror.New(400, "project_field_too_long", key+" is too long")
		}
	}
	if value, ok := command["methodology"]; ok {
		allowed := map[string]bool{"PIVR": true, "agile": true, "waterfall": true, "kanban": true, "hybrid": true}
		if !allowed[fmt.Sprint(value)] {
			return nil, httperror.New(400, "project_methodology_invalid", "Invalid project methodology")
		}
	}
	for _, key := range []string{"startDate", "endDate"} {
		if value, ok := command[key]; ok && value != nil && fmt.Sprint(value) != "" {
			if _, err := time.Parse("2006-01-02", fmt.Sprint(value)); err != nil {
				return nil, httperror.New(400, "project_date_invalid", "Invalid project date")
			}
		}
	}
	base := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, RequestID: identity.RequestID, IdempotencyKey: identity.IdempotencyKey, Personnel: identity.Personnel}
	required := map[string]string{}
	if uid := firstBodyText(command, "leaderUid"); uid != "" {
		required["leaderUid"] = uid
	}
	if err := validateEnterprisePersonnel(base, required, "projects", projectID, "edit", time.Now()); err != nil {
		return nil, err
	}
	receiptInput, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "changes": command})
	if err != nil {
		return nil, err
	}
	receiptInput.OperationCode = EnterpriseProjectUpdateOperation
	receiptInput.RequiredCapability = EnterpriseProjectUpdateCapability
	receiptInput.CommandSchemaVersion = "enterprise-project-update.v1"
	tx, repository, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	executed, err := repository.ExecuteInTransaction(ctx, tx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		before, currentVersion, err := enterpriseProjectSnapshot(ctx, tx, projectID, true)
		if err == sql.ErrNoRows {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(404, "project_not_found", "Project not found")
		} else if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		var managerCount int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM aims_projects p LEFT JOIN aims_project_members pm ON pm.project_id=p.id AND pm.uid=? AND COALESCE(pm.status,'active')='active' WHERE p.id=? AND (p.leader_uid=? OR pm.role='manager')`, identity.ActorUID, id, identity.ActorUID).Scan(&managerCount); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if managerCount == 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(403, "project_manager_required", "Project manager access required")
		}
		if expectedVersion != currentVersion {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "project_version_conflict", "Project information has changed; reload before editing")
		}
		keys := make([]string, 0, len(command))
		for key := range command {
			if key == "expectedVersion" {
				continue
			}
			keys = append(keys, key)
		}
		sort.Strings(keys)
		set := make([]string, 0, len(keys))
		args := make([]any, 0, len(keys)+1)
		for _, key := range keys {
			set = append(set, "`"+enterpriseProjectUpdateColumns[key]+"` = ?")
			value := command[key]
			if key != "name" && key != "shortName" && key != "leaderUid" && strings.TrimSpace(fmt.Sprint(value)) == "" {
				value = nil
			}
			args = append(args, value)
		}
		args = append(args, id)
		if _, err := tx.ExecContext(ctx, "UPDATE aims_projects SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if err := validateServiceYearProjectTx(ctx, tx, projectID); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		leader := ""
		if value, ok := command["leaderUid"]; ok {
			leader = strings.TrimSpace(fmt.Sprint(value))
		}
		if leader != "" {
			if err := ensureProjectLeaderMemberTx(ctx, tx, projectID, leader); err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		}
		value := map[string]any{"id": id, "updated": true, "changes": command}
		after, newVersion, err := enterpriseProjectSnapshot(ctx, tx, projectID, false)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		value["editVersion"] = newVersion
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "beforeVersion": currentVersion, "afterVersion": newVersion})
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'project',?,'edit',?,?,?)", id, projectID, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "project", TargetBizCode: projectID, HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": executed.ReceiptID, "idempotent": executed.Existing, "result": executed.Value}, nil
}
