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

const EnterpriseProjectCreateOperation = "enterprise.aims.projects.create.v1"
const EnterpriseProjectCreateCapability = "aims:project-create:execute"

type EnterpriseProjectCreateIdentity struct {
	Tenant, SourceDeployment, TargetDeployment, ActorUID, ServiceClientID, RequestID, IdempotencyKey string
	Personnel                                                                                        []EnterprisePersonnelPermit
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
