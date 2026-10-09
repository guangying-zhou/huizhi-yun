package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// The independent createPortfolio path remains unchanged. Host creation uses
// the already registered exact route and one fenced transaction with a receipt.
func (a *Adapter) CreateEnterprisePortfolio(ctx context.Context, identity EnterpriseProjectCreateIdentity, body map[string]any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	allowed := map[string]bool{"code": true, "name": true, "description": true, "domainCode": true, "ownerUid": true, "deptCode": true, "gitGroup": true, "defaultCategory": true, "displayOrder": true}
	for key := range body {
		if !allowed[key] {
			return nil, httperror.New(400, "portfolio_input_invalid", "项目集字段无效")
		}
	}
	code := strings.ToUpper(strings.TrimSpace(firstBodyText(body, "code")))
	name := strings.TrimSpace(firstBodyText(body, "name"))
	if code == "" || name == "" {
		return nil, httperror.New(400, "portfolio_input_invalid", "项目集编码和名称不能为空")
	}
	category, err := portfolioDefaultCategory(body)
	if err != nil {
		return nil, err
	}
	input, err := enterpriseProjectCreateReceiptInput(identity, body)
	if err != nil {
		return nil, err
	}
	input.OperationCode = "enterprise.aims.project-portfolios.create.v1"
	input.RequiredCapability = "aims:enterprise-host:execute"
	input.CommandSchemaVersion = "enterprise-portfolio-create.v1"
	tx, repository, err := a.beginEnterpriseWrite(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := repository.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		if category == "routine" {
			var id int64
			err := tx.QueryRowContext(ctx, "SELECT id FROM project_portfolios WHERE default_category='routine' LIMIT 1 FOR UPDATE").Scan(&id)
			if err == nil {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "routine_portfolio_exists", "日常事务项目集已存在")
			}
			if err != sql.ErrNoRows {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		}
		inserted, err := tx.ExecContext(ctx, `INSERT INTO project_portfolios (code,name,description,domain_code,owner_uid,dept_code,git_group,is_product_line,default_category,display_order,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, code, name, nullablePortfolioBodyText(body, "description"), nullablePortfolioBodyText(body, "domainCode"), nullablePortfolioBodyText(body, "ownerUid"), nullablePortfolioBodyText(body, "deptCode"), nullablePortfolioBodyText(body, "gitGroup"), boolToInt64(derivedIsProductLine(category, body)), nullableTextValue(category), portfolioBodyInt(body, "displayOrder"), identity.ActorUID)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, portfolioWriteError(err)
		}
		id, err := inserted.LastInsertId()
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "project-portfolio", TargetBizCode: code, HTTPStatus: http.StatusOK, Value: map[string]any{"id": id, "code": code}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	// Replayed receipts intentionally do not retain business response bodies.
	// The caller only needs confirmation of the original intent, not a second write.
	value, _ := result.Value.(map[string]any)
	if value == nil {
		value = map[string]any{"code": code}
	}
	value["receiptId"] = result.ReceiptID
	value["idempotent"] = result.Existing
	return value, nil
}
