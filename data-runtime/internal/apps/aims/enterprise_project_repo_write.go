package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) scopedProjectRepoWrite(ctx context.Context, rawProjectID string, query url.Values, action, repoCode string, write func(context.Context) (any, error)) (any, error) {
	identity, enterprise := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enterprise {
		return write(ctx)
	}
	if identity.ActorUID == "" || identity.ActorUID != strings.TrimSpace(query.Get("current_user")) || identity.CommandScope == nil {
		return nil, httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	if identity.Tenant != "" && !validDeliverableReceiptIdentity(ctx) {
		return nil, httperror.New(400, "idempotency_key_required", "Idempotency-Key is required")
	}
	projectID, err := parseID(rawProjectID, "project_id")
	if err != nil {
		return nil, err
	}
	tx, repo, err := a.beginDeliverableWrite(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := requireEnterpriseDeliverableProjectScopeTx(ctx, tx, identity.ActorUID, projectID, true); err != nil {
		return nil, err
	}
	ctx = context.WithValue(ctx, enterpriseScopedWriteTxKey{}, tx)
	result, err := executeEnterpriseRepoReceipt(ctx, tx, repo, action, projectID, repoCode, write)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func executeEnterpriseRepoReceipt(ctx context.Context, tx *sql.Tx, repo *iop.ReceiptRepository, action string, projectID int64, repoCode string, write func(context.Context) (any, error)) (any, error) {
	if repo == nil {
		return write(ctx)
	}
	input, err := enterpriseDeliverableReceiptInput(ctx, action, "aims:project-repos:edit", "project-repo.v1", map[string]any{
		"projectId": projectID, "repoProjectCode": repoCode,
	})
	if err != nil {
		return nil, err
	}
	input.OperationCode = "enterprise.aims.project-repos." + action + ".v1"
	value := map[string]any{"projectId": projectID, "repoProjectCode": repoCode}
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(writeCtx context.Context, _ *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		if _, err := write(writeCtx); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "project-repo", TargetBizCode: fmt.Sprintf("%d:%s", projectID, repoCode), HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if result.TargetBizType != "project-repo" || result.TargetBizCode != fmt.Sprintf("%d:%s", projectID, repoCode) {
		return nil, httperror.New(409, "receipt_result_unavailable", "Project repository result is unavailable")
	}
	var current int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_repos WHERE project_id=? AND repo_project_code=?", projectID, repoCode).Scan(&current); err != nil {
		return nil, err
	}
	value["linked"] = current > 0
	value["receiptId"], value["idempotent"] = result.ReceiptID, result.Existing
	return value, nil
}
