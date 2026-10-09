package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// The version includes all mutable persisted fields, including changes made by
// the compatible standalone editor. No schema counter or user-supplied scope.
func enterprisePortfolioSnapshot(ctx context.Context, tx weeklyReportReadDB, id int64, lock bool) (map[string]any, string, error) {
	var code, name, status string
	var description, owner, dept, domain, git, category sql.NullString
	var display, productLine int
	query := "SELECT code,name,description,owner_uid,dept_code,domain_code,git_group,default_category,display_order,status,is_product_line FROM project_portfolios WHERE id=?"
	if lock {
		query += " FOR UPDATE"
	}
	err := tx.QueryRowContext(ctx, query, id).Scan(&code, &name, &description, &owner, &dept, &domain, &git, &category, &display, &status, &productLine)
	if err == sql.ErrNoRows {
		return nil, "", httperror.New(404, "portfolio_not_found", "项目集不存在")
	}
	if err != nil {
		return nil, "", err
	}
	item := map[string]any{"id": id, "code": code, "name": name, "description": description.String, "ownerUid": owner.String, "deptCode": dept.String, "domainCode": domain.String, "gitGroup": git.String, "defaultCategory": category.String, "displayOrder": display, "status": status, "isProductLine": productLine}
	raw, _ := json.Marshal(item)
	sum := sha256.Sum256(raw)
	return item, hex.EncodeToString(sum[:]), nil
}

func (a *Adapter) UpdateEnterprisePortfolio(ctx context.Context, identity EnterpriseProjectCreateIdentity, rawID string, body map[string]any) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	expected, _ := body["expectedVersion"].(string)
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(expected) {
		return nil, httperror.New(400, "portfolio_version_required", "请提供项目集版本")
	}
	columns := map[string]string{"code": "code", "name": "name", "description": "description", "ownerUid": "owner_uid", "deptCode": "dept_code", "domainCode": "domain_code", "gitGroup": "git_group", "defaultCategory": "default_category", "displayOrder": "display_order"}
	for key, value := range body {
		if key == "expectedVersion" {
			continue
		}
		if columns[key] == "" {
			return nil, httperror.New(400, "portfolio_input_invalid", "项目集字段无效")
		}
		if key != "displayOrder" {
			if _, ok := value.(string); !ok {
				return nil, httperror.New(400, "portfolio_input_invalid", "项目集字段无效")
			}
		}
		if (key == "name" || key == "code") && strings.TrimSpace(fmt.Sprint(value)) == "" {
			return nil, httperror.New(400, "portfolio_input_invalid", "项目集编码和名称不能为空")
		}
	}
	input, err := enterpriseProjectCreateReceiptInput(identity, map[string]any{"portfolioId": rawID, "changes": body})
	if err != nil {
		return nil, err
	}
	input.OperationCode = "enterprise.aims.portfolio.update.v1"
	input.RequiredCapability = "aims:enterprise-host:execute"
	input.CommandSchemaVersion = "portfolio-update.v1"
	tx, repository, err := a.beginEnterpriseWrite(ctx, identity)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := repository.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		current, version, err := enterprisePortfolioSnapshot(ctx, tx, id, true)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if version != expected {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "portfolio_version_conflict", "项目集已被他人修改")
		}
		category := fmt.Sprint(current["defaultCategory"])
		if _, ok := body["defaultCategory"]; ok {
			category, err = portfolioDefaultCategory(body)
			if err != nil {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		}
		if category == "routine" {
			var other int64
			err := tx.QueryRowContext(ctx, "SELECT id FROM project_portfolios WHERE default_category='routine' AND id!=? LIMIT 1 FOR UPDATE", id).Scan(&other)
			if err == nil {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "routine_portfolio_exists", "日常事务项目集已存在")
			}
			if err != sql.ErrNoRows {
				return integrationoperation.ReceiptBusinessResult{}, err
			}
		}
		fields := []string{}
		args := []any{}
		// Fixed order keeps updates deterministic; identifiers never come from input.
		for _, key := range []string{"code", "name", "description", "ownerUid", "deptCode", "domainCode", "gitGroup", "defaultCategory", "displayOrder"} {
			value, ok := body[key]
			if !ok {
				continue
			}
			fields = append(fields, columns[key]+"=?")
			if key == "displayOrder" {
				args = append(args, portfolioBodyInt(body, key))
			} else if key == "code" {
				args = append(args, strings.ToUpper(strings.TrimSpace(value.(string))))
			} else {
				args = append(args, nullableTextValue(value))
			}
			if key == "defaultCategory" {
				fields = append(fields, "is_product_line=?")
				args = append(args, boolToInt64(category == "product_dev"))
			}
		}
		if len(fields) == 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(400, "empty_request", "没有需要更新的字段")
		}
		args = append(args, id)
		if _, err := tx.ExecContext(ctx, "UPDATE project_portfolios SET "+strings.Join(fields, ",")+" WHERE id=?", args...); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, portfolioWriteError(err)
		}
		_, next, err := enterprisePortfolioSnapshot(ctx, tx, id, false)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "project-portfolio", TargetBizCode: rawID, HTTPStatus: http.StatusOK, Value: map[string]any{"id": id, "editVersion": next}}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	value, _ := result.Value.(map[string]any)
	if value == nil {
		value = map[string]any{"id": id}
	}
	value["receiptId"] = result.ReceiptID
	value["idempotent"] = result.Existing
	return value, nil
}
