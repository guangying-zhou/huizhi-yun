package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const EnterpriseProjectProductsReadCapability = "aims:project-products:read"
const EnterpriseProjectProductsCreateCapability = "aims:project-products:create"

// The signed actor is the only source for current_user. The legacy reader
// supplies project membership and visibility checks; browser query flags are
// never accepted by this adapter.
func (a *Adapter) ListEnterpriseProjectProducts(ctx context.Context, projectID, actor string) (map[string]any, error) {
	if actor == "" {
		return nil, httperror.New(403, "project_actor_required", "Project actor is required")
	}
	return a.listProjectProducts(ctx, projectID, url.Values{"current_user": {actor}})
}

func (a *Adapter) LinkEnterpriseProjectProduct(ctx context.Context, identity EnterpriseProjectUpdateIdentity, projectID, productCode string, productPermit pc.AuthorizationPermit) (map[string]any, error) {
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	id, err := parseID(projectID, "project_id")
	if err != nil {
		return nil, err
	}
	if productCode == "" || productCode != strings.TrimSpace(productCode) || len([]rune(productCode)) > 64 || strings.ContainsAny(productCode, "/\\") {
		return nil, httperror.New(400, "product_code_invalid", "Product code is invalid")
	}
	base := EnterpriseProjectCreateIdentity{Tenant: identity.Tenant, SourceDeployment: identity.SourceDeployment, TargetDeployment: identity.TargetDeployment, ActorUID: identity.ActorUID, ServiceClientID: identity.ServiceClientID, RequestID: identity.RequestID, IdempotencyKey: identity.IdempotencyKey}
	ri, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "productCode": productCode})
	if err != nil {
		return nil, err
	}
	ri.OperationCode = "enterprise.aims.project-products.link.v1"
	ri.RequiredCapability = EnterpriseProjectProductsCreateCapability
	ri.CommandSchemaVersion = "project-product-link.v1"
	tx, repo, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Revalidate product facts for every call, including a replay. Revocation
	// therefore cannot reuse an earlier receipt to reveal its result.
	if err = pc.AuthorizeWorkspaceTransaction(ctx, tx, productCode, identity.ActorUID, "products", "view", productPermit); err != nil {
		return nil, EnterpriseProductCommandError(err)
	}
	if err = validateProjectProductManagerTx(ctx, tx, id, identity.ActorUID); err != nil {
		return nil, err
	}
	executed, err := repo.ExecuteInTransaction(ctx, tx, ri, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		var existing int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_products WHERE project_id=? AND product_code=?", id, productCode).Scan(&existing); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if existing != 0 {
			return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "project_product_exists", "Product is already linked")
		}
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_products WHERE project_id=?", id).Scan(&count); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		// A first relation becomes primary; an added relation leaves existing
		// primary and version bindings untouched.
		primary := count == 0
		if _, err := tx.ExecContext(ctx, "INSERT INTO aims_project_products(project_id,product_code,version_id,is_primary,created_by) VALUES(?,?,NULL,?,?)", id, productCode, primary, identity.ActorUID); err != nil {
			var duplicate *mysql.MySQLError
			if errors.As(err, &duplicate) && duplicate.Number == 1062 {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "project_product_exists", "Product is already linked")
			}
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		value := map[string]any{"projectId": id, "productCode": productCode, "isPrimary": primary}
		changes, err := json.Marshal(value)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'product',?,'create',?,?,?)", id, productCode, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "project_product", TargetBizCode: strconv.FormatInt(id, 10) + ":" + productCode, HTTPStatus: http.StatusCreated, Value: value}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": executed.ReceiptID, "idempotent": executed.Existing, "result": executed.Value}, nil
}

func validateProjectProductManagerTx(ctx context.Context, tx *sql.Tx, id int64, actor string) error {
	var category, lifecycle, leader string
	if err := tx.QueryRowContext(ctx, "SELECT category,lifecycle_status,leader_uid FROM aims_projects WHERE id=? FOR UPDATE", id).Scan(&category, &lifecycle, &leader); err == sql.ErrNoRows {
		return httperror.New(404, "project_not_found", "Project not found")
	} else if err != nil {
		return err
	}
	if category != "product_dev" || lifecycle != "active" {
		return httperror.New(403, "project_category_not_allowed", "Only active development projects may link products")
	}
	var managers int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_members WHERE project_id=? AND uid=? AND role='manager' AND status='active'", id, actor).Scan(&managers); err != nil {
		return err
	}
	if leader != actor && managers == 0 {
		return httperror.New(403, "project_manager_required", "Project manager access required")
	}
	return nil
}
