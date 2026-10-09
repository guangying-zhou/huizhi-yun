package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
)

// Directory facts are collected only by the authenticated Host BFF. The receipt
// freezes the first successful batch; a same-year retry never re-creates it even
// if the directory has changed. No browser relation/manager flags are accepted.
func (a *Adapter) CreateEnterpriseRoutineBatch(ctx context.Context, identity EnterpriseProjectCreateIdentity, yearInput any, departmentInput any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	year, err := routineProjectBatchYear(yearInput)
	if err != nil {
		return nil, err
	}
	departments, err := routineProjectBatchDepartments(departmentInput)
	if err != nil {
		return nil, err
	}
	input, err := enterpriseProjectCreateReceiptInput(identity, map[string]any{"year": year})
	if err != nil {
		return nil, err
	}
	input.OperationCode = "enterprise.aims.admin-projects.routine-batch.v1"
	input.RequiredCapability = "aims:enterprise-host:execute"
	input.CommandSchemaVersion = "admin-routine-batch.v1"
	tx, repository, err := a.beginEnterpriseWrite(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	executed, err := repository.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		value, err := a.createRoutineDepartmentProjectsTx(ctx, tx, identity.ActorUID, year, departments)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "routine-project-batch", TargetBizCode: fmt.Sprint(year), HTTPStatus: http.StatusOK, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": executed.ReceiptID, "idempotent": executed.Existing, "result": executed.Value}, nil
}
