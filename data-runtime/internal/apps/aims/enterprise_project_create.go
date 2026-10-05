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
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const EnterpriseProjectCreateOperation = "enterprise.aims.projects.create.v1"
const EnterpriseProjectCreateCapability = "aims:project-create:execute"

type EnterpriseProjectCreateIdentity struct {
	Tenant, SourceDeployment, TargetDeployment, ActorUID, ServiceClientID, RequestID, IdempotencyKey string
	Personnel                                                                                        []EnterprisePersonnelPermit
	CreateScope                                                                                      *EnterpriseProjectCommandScope
	ProjectCode, DeptCode                                                                            string
}

func (a *Adapter) CreateEnterpriseProject(ctx context.Context, identity EnterpriseProjectCreateIdentity, command map[string]any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	leader := firstBodyText(command, "leaderUid", "leader_uid")
	if leader == "" {
		return nil, httperror.New(400, "project_manager_required", "Project leader is required")
	}
	if err := validateEnterprisePersonnel(identity, map[string]string{"leaderUid": leader}, "projects", "new", "create", time.Now()); err != nil {
		return nil, err
	}
	input, err := enterpriseProjectCreateReceiptInput(identity, command)
	if err != nil {
		return nil, err
	}
	tx, repository, err := a.beginEnterpriseWrite(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := requireEnterpriseProjectCreateScopeTx(identity, command); err != nil {
		return nil, err
	}
	executed, err := repository.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		query := url.Values{"current_user": []string{identity.ActorUID}, "operator_uid": []string{identity.ActorUID}}
		result, err := a.createProjectWithProductBindingTx(ctx, tx, query, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "project", TargetBizCode: fmt.Sprint(result["projectCode"]), HTTPStatus: http.StatusCreated, Value: result}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": executed.ReceiptID, "idempotent": executed.Existing, "result": executed.Value}, nil
}

func requireEnterpriseProjectCreateScopeTx(identity EnterpriseProjectCreateIdentity, command map[string]any) error {
	scope := identity.CreateScope
	code, department := firstBodyText(command, "projectCode", "project_code"), firstBodyText(command, "deptCode", "dept_code")
	if scope == nil || scope.ExpiresAt <= time.Now().UnixMilli() || code == "" || identity.ProjectCode != code || identity.DeptCode != department {
		return httperror.New(403, "enterprise_project_create_scope_invalid", "Project create scope is invalid")
	}
	facts := projectscope.Facts{ProjectCode: code, DepartmentCode: department}
	for _, root := range scope.Projection.DepartmentTreeRoots {
		children, ok := scope.Descendants[root]
		if !ok || len(children) == 0 {
			return httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
		for _, child := range children {
			if strings.TrimSpace(child) == department && department != "" {
				facts.DepartmentTree = append(facts.DepartmentTree, root)
				break
			}
		}
	}
	allowed, err := scope.Projection.Allows(facts)
	if err != nil {
		return httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
	}
	if !allowed {
		return httperror.New(403, "enterprise_project_create_scope_denied", "Project create scope denied")
	}
	return nil
}

func enterpriseProjectCreateReceiptInput(identity EnterpriseProjectCreateIdentity, command map[string]any) (integrationoperation.ReceiptCommandInput, error) {
	raw, err := json.Marshal(command)
	if err != nil {
		return integrationoperation.ReceiptCommandInput{}, err
	}
	sum := sha256.Sum256(raw)
	operationSum := sha256.Sum256([]byte(identity.IdempotencyKey))
	h := hex.EncodeToString(operationSum[:])
	operationID := h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-8" + h[17:20] + "-" + h[20:32]
	input := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.ServiceClientID, RequestID: identity.RequestID}, SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "aims", OperationID: operationID, OperationCode: EnterpriseProjectCreateOperation, RequiredCapability: EnterpriseProjectCreateCapability, IdempotencyKey: identity.IdempotencyKey, CommandSchemaVersion: "enterprise-project-create.v1", CommandSHA256: hex.EncodeToString(sum[:]), Command: raw, OriginalActorUID: identity.ActorUID}
	return input, nil
}
func ValidEnterpriseProjectCreateIdentity(identity EnterpriseProjectCreateIdentity) bool {
	return strings.TrimSpace(identity.Tenant) != "" && strings.TrimSpace(identity.SourceDeployment) != "" && strings.TrimSpace(identity.TargetDeployment) != "" && strings.TrimSpace(identity.ActorUID) != "" && strings.TrimSpace(identity.IdempotencyKey) != ""
}
