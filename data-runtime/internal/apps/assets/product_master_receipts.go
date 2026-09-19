package assets

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// ProductMasterCommandIdentity is built only by the authenticated owning adapter
// or Registry service. CommandDeployment is stable across physical caller apps.
type ProductMasterCommandIdentity struct{ Tenant, CommandDeployment, ActorUID, ClientID, RequestID, Key string }

var productMasterFields = map[string]bool{"product_code": true, "product_name": true, "product_line": true, "customer_domain": true, "business_domain": true, "product_level": true, "asset_level": true, "status": true, "build_stage": true, "current_version": true, "target_version": true, "productization_value_level": true, "supported_terminals": true, "summary": true, "built_at": true, "business_owner_uid": true, "technical_owner_uid": true, "project_code": true, "covered_legacy_systems": true, "notes": true}

func ProductMasterPayload(body map[string]any) (map[string]any, error) {
	result := map[string]any{}
	for k, v := range body {
		if !productMasterFields[k] {
			return nil, httperror.New(400, "invalid_product_field", "Unsupported product field")
		}
		result[k] = v
	}
	return result, nil
}

// ExecuteProductMasterInTransaction shares receipt, mutation and scope checks.
// Permission evidence is deliberately excluded from the immutable command hash.
func ExecuteProductMasterInTransaction(ctx context.Context, tx *sql.Tx, repo *io.ReceiptRepository, identity ProductMasterCommandIdentity, action string, id int64, body map[string]any, q url.Values) (int64, error) {
	if identity.ActorUID == "" || identity.ActorUID != q.Get("current_user") || strings.TrimSpace(identity.Key) == "" {
		return 0, httperror.New(403, "invalid_product_command_identity", "Bound actor and idempotency key required")
	}
	if action != "create" && action != "edit" {
		return 0, httperror.New(400, "invalid_product_action", "Unsupported product action")
	}
	payload, err := ProductMasterPayload(body)
	if err != nil {
		return 0, err
	}
	if q.Get(assetsPermissionActionQueryKey) != "edit" {
		return 0, httperror.New(403, "assets_product_edit_scope_required", "Product edit scope required")
	}
	if action == "edit" {
		if err = requireProductWriteScopeTx(ctx, tx, id, q); err != nil {
			return 0, err
		}
	}
	command := map[string]any{"action": action, "id": id, "actor": identity.ActorUID, "input": payload}
	input, err := assetsOwnedReceiptInput(identity, "assets.products."+action+".v1", "assets:product:edit", id, command)
	if err != nil {
		return 0, err
	}
	result, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		target := id
		var err error
		if action == "create" {
			target, err = CreateProductInTransaction(ctx, tx, payload, q)
		} else {
			err = UpdateProductInTransaction(ctx, tx, id, payload, q)
		}
		return io.ReceiptBusinessResult{TargetBizType: "product_asset", TargetBizCode: strconv.FormatInt(target, 10), HTTPStatus: 200}, err
	})
	if err != nil {
		return 0, err
	}
	target, err := strconv.ParseInt(result.TargetBizCode, 10, 64)
	if err != nil || target <= 0 {
		return 0, httperror.New(503, "invalid_product_receipt", "Product receipt unavailable")
	}
	// A replay does not preserve old authority after ownership changes.
	if err = requireProductWriteScopeTx(ctx, tx, target, q); err != nil {
		return 0, err
	}
	return target, nil
}

// executeLegacyProductMaster retains the old adapter's physical store while
// using exactly the same owning-domain receipt identity and command payload.
func (a *Adapter) executeLegacyProductMaster(ctx context.Context, action string, id int64, body map[string]any, q url.Values) (int64, error) {
	trusted, err := io.TrustedContextFromMap(body, "assets")
	if err != nil {
		return 0, err
	}
	payload := map[string]any{}
	for k, v := range body {
		if productMasterFields[k] {
			payload[k] = v
		}
	}
	identity := ProductMasterCommandIdentity{Tenant: trusted.TenantCode, CommandDeployment: trusted.DeploymentCode, ActorUID: q.Get("current_user"), ClientID: trusted.ServiceClientID, RequestID: trusted.RequestID, Key: bodyText(body, "idempotency_key")}
	if err := VerifyOwnedProductReceiptSchema(ctx, a.DB(), "`service_command_receipt`"); err != nil {
		return 0, err
	}
	repo, err := io.NewReceiptRepository(a.DB())
	if err != nil {
		return 0, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	target, err := ExecuteProductMasterInTransaction(ctx, tx, repo, identity, action, id, payload, q)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return target, nil
}

func ProductMasterBusinessPayload(body map[string]any) map[string]any {
	result := map[string]any{}
	for k, v := range body {
		if productMasterFields[k] {
			result[k] = v
		}
	}
	return result
}

func assetsOwnedReceiptInput(identity ProductMasterCommandIdentity, operation, capability string, id int64, command map[string]any) (io.OwnedReceiptCommandInput, error) {
	raw, err := json.Marshal(command)
	if err != nil {
		return io.OwnedReceiptCommandInput{}, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return io.OwnedReceiptCommandInput{}, err
	}
	namespace := sha256.Sum256([]byte(identity.Tenant + "\x00" + identity.CommandDeployment + "\x00" + identity.ActorUID + "\x00" + operation + "\x00" + strconv.FormatInt(id, 10) + "\x00" + identity.Key))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	input := io.OwnedReceiptCommandInput{TrustedContext: io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.CommandDeployment, SourceApp: "assets", ServiceClientID: identity.ClientID, RequestID: identity.RequestID}, SourceDeploymentCode: identity.CommandDeployment, TargetDeploymentCode: identity.CommandDeployment, TargetApp: "assets", OperationID: uuid, OperationCode: operation, RequiredCapability: capability, IdempotencyKey: key, CommandSchemaVersion: "assets-owned-command.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.ActorUID}

	return input, nil
}

// ExecuteProductCategoryInTransaction is only called after trusted admin/admin
// authorization. The scope is fixed to product and cannot select another module.
func ExecuteProductCategoryInTransaction(ctx context.Context, tx *sql.Tx, repo *io.ReceiptRepository, identity ProductMasterCommandIdentity, id int64, body map[string]any) (map[string]any, error) {
	if identity.ActorUID == "" || identity.Key == "" {
		return nil, httperror.New(403, "invalid_category_identity", "Bound administrator required")
	}
	payload := map[string]any{}
	allowed := map[string]bool{"label": true, "value": true, "shortCode": true, "description": true, "enabled": true, "sortOrder": true, "items": true}
	for k, v := range body {
		if k == "scope" {
			if v != "product" {
				return nil, httperror.New(400, "invalid_category_scope", "Only product categories are supported")
			}
			continue
		}
		if !allowed[k] {
			return nil, httperror.New(400, "invalid_category_field", "Unsupported category field")
		}
		payload[k] = v
	}
	input, err := assetsOwnedReceiptInput(identity, "assets.product-categories.save.v1", "assets:admin:admin", id, map[string]any{"actor": identity.ActorUID, "id": id, "scope": "product", "input": payload})
	if err != nil {
		return nil, err
	}
	result, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		item, err := SaveAssetCategoryInTransaction(ctx, tx, "product", id, payload, identity.ActorUID)
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		return io.ReceiptBusinessResult{TargetBizType: "asset_category_group", TargetBizCode: strconv.FormatInt(asInt(item["id"]), 10), HTTPStatus: 200}, nil
	})
	if err != nil {
		return nil, err
	}
	target, err := strconv.ParseInt(result.TargetBizCode, 10, 64)
	if err != nil {
		return nil, err
	}
	items, err := ListAssetCategoriesInTransaction(ctx, tx, "product", true)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if asInt(item["id"]) == target {
			return item, nil
		}
	}
	return nil, notFound("产品线不存在")
}

// VerifyOwnedProductReceiptSchema reports an actionable dependency failure
// before a runtime upgrade attempts owned commands against the old CHECK.
type ProductReceiptSchemaReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func VerifyOwnedProductReceiptSchema(ctx context.Context, db ProductReceiptSchemaReader, registeredTable string) error {
	if !regexp.MustCompile("^`[A-Za-z_][A-Za-z0-9_]{0,63}`$").MatchString(registeredTable) {
		return httperror.New(503, "assets_owned_receipt_schema_unavailable", "Assets receipt schema unavailable")
	}
	var clause string
	err := db.QueryRowContext(ctx, `SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES' AND cc.CHECK_CLAUSE LIKE '%assets-owned-command.v1%'`, strings.Trim(registeredTable, "`")).Scan(&clause)
	if err != nil {
		return httperror.New(503, "assets_owned_receipt_schema_unavailable", "Apply Assets owned product receipt migration before enabling writes")
	}
	for _, required := range []string{"assets.products.create.v1", "assets.products.edit.v1", "assets.product-categories.save.v1", "original_actor_uid", "source_deployment_code"} {
		if !strings.Contains(clause, required) {
			return httperror.New(503, "assets_owned_receipt_schema_unavailable", "Assets receipt constraint is not ready")
		}
	}
	return nil
}

// VerifyOwnedDigitalAssetReceiptSchema keeps the digital-assets migration
// independently fail-closed. A product receipt CHECK can be present while the
// later digital-assets operation clauses are still absent.
func VerifyOwnedDigitalAssetReceiptSchema(ctx context.Context, db ProductReceiptSchemaReader, registeredTable string) error {
	if err := VerifyOwnedProductReceiptSchema(ctx, db, registeredTable); err != nil {
		return err
	}
	var clause string
	err := db.QueryRowContext(ctx, `SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES' AND cc.CHECK_CLAUSE LIKE '%assets-owned-command.v1%'`, strings.Trim(registeredTable, "`")).Scan(&clause)
	if err != nil || !strings.Contains(clause, "assets.digital-assets.create.v1") || !strings.Contains(clause, "assets.digital-assets.edit.v1") {
		return httperror.New(503, "assets_digital_asset_receipt_schema_unavailable", "Apply Assets digital asset receipt migration before enabling writes")
	}
	return nil
}

func VerifyOwnedIPAssetReceiptSchema(ctx context.Context, db ProductReceiptSchemaReader, registeredTable string) error {
	if err := VerifyOwnedProductReceiptSchema(ctx, db, registeredTable); err != nil {
		return err
	}
	var clause string
	err := db.QueryRowContext(ctx, `SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES' AND cc.CHECK_CLAUSE LIKE '%assets-owned-command.v1%'`, strings.Trim(registeredTable, "`")).Scan(&clause)
	if err != nil || !strings.Contains(clause, "assets.ip-assets.create.v1") || !strings.Contains(clause, "assets.ip-assets.edit.v1") {
		return httperror.New(503, "assets_ip_asset_receipt_schema_unavailable", "Apply Assets IP asset receipt migration before enabling writes")
	}
	return nil
}

func VerifyOwnedIPAssetProductLinkReceiptSchema(ctx context.Context, db ProductReceiptSchemaReader, registeredTable string) error {
	if err := VerifyOwnedIPAssetReceiptSchema(ctx, db, registeredTable); err != nil {
		return err
	}
	var clause string
	err := db.QueryRowContext(ctx, `SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES' AND cc.CHECK_CLAUSE LIKE '%assets-owned-command.v1%'`, strings.Trim(registeredTable, "`")).Scan(&clause)
	if err != nil || !strings.Contains(clause, "assets.ip-assets.link-product.v1") {
		return httperror.New(503, "assets_ip_asset_link_receipt_schema_unavailable", "Apply Assets IP asset product link receipt migration before linking")
	}
	return nil
}
