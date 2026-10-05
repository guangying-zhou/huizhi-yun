package assets

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var ipAssetFields = map[string]bool{"ip_code": true, "ip_name": true, "ip_type": true, "registration_no": true, "right_holder": true, "apply_date": true, "effective_date": true, "expires_at": true, "status": true, "owner_uid": true, "notes": true}
var ipAssetTypes = map[string]bool{"software_copyright": true, "trademark": true, "patent": true, "copyright": true, "qualification": true}
var ipAssetStatuses = map[string]bool{"active": true, "applying": true, "expired": true, "abandoned": true}

func IPAssetPayload(body map[string]any) (map[string]any, error) {
	payload := map[string]any{}
	limits := map[string]int{"ip_code": 64, "ip_name": 255, "ip_type": 64, "registration_no": 128, "right_holder": 255, "apply_date": 10, "effective_date": 10, "expires_at": 10, "status": 64, "owner_uid": 64, "notes": 65535}
	for key, value := range body {
		if !ipAssetFields[key] {
			return nil, httperror.New(400, "invalid_ip_asset_field", "Unsupported IP asset field")
		}
		if value != nil {
			text, ok := value.(string)
			if !ok || !utf8.ValidString(text) {
				return nil, httperror.New(400, "invalid_ip_asset_field", "IP asset field is invalid")
			}
			length := utf8.RuneCountInString(text)
			if key == "notes" {
				length = len(text)
			}
			if length > limits[key] {
				return nil, httperror.New(400, "invalid_ip_asset_field", "IP asset field is invalid")
			}
			if (key == "ip_name" || key == "ip_type" || key == "status") && strings.TrimSpace(text) == "" {
				return nil, httperror.New(400, "invalid_ip_asset_field", "IP asset required field is invalid")
			}
			if (key == "ip_type" && !ipAssetTypes[text]) || (key == "status" && !ipAssetStatuses[text]) {
				return nil, httperror.New(400, "invalid_ip_asset_field", "IP asset dictionary value is invalid")
			}
			if (key == "apply_date" || key == "effective_date" || key == "expires_at") && text != "" {
				if _, err := time.Parse("2006-01-02", text); err != nil {
					return nil, httperror.New(400, "invalid_ip_asset_field", "IP asset date is invalid")
				}
			}
		} else if key == "ip_name" || key == "ip_type" || key == "status" {
			return nil, httperror.New(400, "invalid_ip_asset_field", "IP asset required field cannot be cleared")
		}
		payload[key] = value
	}
	return payload, nil
}

func requireIPAssetWriteScopeTx(ctx context.Context, tx *sql.Tx, id int64, query url.Values) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return err
	}
	if query.Get(assetsPermissionActionQueryKey) != "edit" {
		return httperror.New(403, "assets_ip_asset_edit_scope_required", "IP asset edit scope required")
	}
	where, args := "1=1", []any{id}
	if access != "all" {
		units, e := assetsScopeUnits(query)
		if e != nil {
			return e
		}
		where, args = ipAssetScopeWhere("ip", actor, units)
		args = append([]any{id}, args...)
	}
	var found int64
	err = tx.QueryRowContext(ctx, "SELECT ip.id FROM ip_assets ip WHERE ip.id=? AND "+where+" FOR UPDATE", args...).Scan(&found)
	if err == sql.ErrNoRows {
		return httperror.New(403, "assets_ip_asset_scope_forbidden", "IP asset outside authorized scope")
	}
	return err
}

func createIPAssetInTransaction(ctx context.Context, tx *sql.Tx, body map[string]any, query url.Values) (int64, error) {
	_, actor, err := assetsObjectAccess(query)
	if err != nil {
		return 0, err
	}
	if query.Get(assetsPermissionActionQueryKey) != "edit" {
		return 0, httperror.New(403, "assets_ip_asset_edit_scope_required", "IP asset edit scope required")
	}
	insert, err := tx.ExecContext(ctx, `INSERT INTO ip_assets (ip_code,ip_name,ip_type,registration_no,right_holder,apply_date,effective_date,expires_at,status,owner_uid,notes,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		coalesceText(body, "ip_code", buildCode("IP")), coalesceText(body, "ip_name", "未命名知识产权"), coalesceText(body, "ip_type", "software_copyright"), nullableBodyText(body, "registration_no"), nullableBodyText(body, "right_holder"), nullableBodyText(body, "apply_date"), nullableBodyText(body, "effective_date"), nullableBodyText(body, "expires_at"), coalesceText(body, "status", "active"), nullableBodyText(body, "owner_uid"), nullableBodyText(body, "notes"), nullableString(actor), nullableString(actor))
	if err != nil {
		return 0, err
	}
	id, err := insert.LastInsertId()
	if err != nil {
		return 0, err
	}
	if err = requireIPAssetWriteScopeTx(ctx, tx, id, query); err != nil {
		return 0, err
	}
	if err = insertEvent(ctx, tx, "ip_asset", id, "created", actor, map[string]any{"summary": "知识产权资产已创建"}); err != nil {
		return 0, err
	}
	return id, nil
}

func updateIPAssetInTransaction(ctx context.Context, tx *sql.Tx, id int64, body map[string]any, query url.Values) error {
	if err := requireIPAssetWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	actor := query.Get("current_user")
	_, err := tx.ExecContext(ctx, `UPDATE ip_assets SET ip_name=COALESCE(?,ip_name),ip_type=COALESCE(?,ip_type),registration_no=CASE WHEN ? THEN ? ELSE registration_no END,right_holder=CASE WHEN ? THEN ? ELSE right_holder END,apply_date=CASE WHEN ? THEN ? ELSE apply_date END,effective_date=CASE WHEN ? THEN ? ELSE effective_date END,expires_at=CASE WHEN ? THEN ? ELSE expires_at END,status=COALESCE(?,status),owner_uid=CASE WHEN ? THEN ? ELSE owner_uid END,notes=CASE WHEN ? THEN ? ELSE notes END,updated_by=? WHERE id=?`, nullableBodyText(body, "ip_name"), nullableBodyText(body, "ip_type"), bodyHas(body, "registration_no"), nullableBodyText(body, "registration_no"), bodyHas(body, "right_holder"), nullableBodyText(body, "right_holder"), bodyHas(body, "apply_date"), nullableBodyText(body, "apply_date"), bodyHas(body, "effective_date"), nullableBodyText(body, "effective_date"), bodyHas(body, "expires_at"), nullableBodyText(body, "expires_at"), nullableBodyText(body, "status"), bodyHas(body, "owner_uid"), nullableBodyText(body, "owner_uid"), bodyHas(body, "notes"), nullableBodyText(body, "notes"), nullableString(actor), id)
	if err != nil {
		return err
	}
	if err = requireIPAssetWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	return insertEvent(ctx, tx, "ip_asset", id, "updated", actor, map[string]any{"summary": "知识产权资产已更新"})
}

func (a *Adapter) EnterpriseIPAssetCommand(ctx context.Context, identity ProductMasterCommandIdentity, action string, id int64, body map[string]any, query url.Values) (int64, error) {
	if action != "create" && action != "edit" || (action == "create" && id != 0) || (action == "edit" && id <= 0) {
		return 0, httperror.New(400, "invalid_ip_asset_action", "IP asset command invalid")
	}
	payload, err := IPAssetPayload(body)
	if err != nil {
		return 0, err
	}
	if action == "edit" && bodyHas(payload, "ip_code") {
		return 0, httperror.New(400, "invalid_ip_asset_field", "IP asset code cannot be changed")
	}
	if a.enterpriseWrites == nil || a.enterpriseWrites.registry == nil {
		return 0, httperror.New(503, "enterprise_ip_assets_writer_unavailable", "IP asset unified writer unavailable")
	}
	request := a.enterpriseWrites.request
	if identity.Tenant != request.Key.Tenant || request.Operation != enterprise.Write {
		return 0, httperror.New(403, "enterprise_ip_assets_writer_invalid", "IP asset writer binding invalid")
	}
	tx, resolved, err := a.enterpriseWrites.registry.BeginWriteTransaction(ctx, request)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if len(resolved) != 1 {
		return 0, httperror.New(503, "enterprise_ip_assets_writer_unavailable", "IP asset writer unavailable")
	}
	receiptTable, err := resolved[0].Table("service_command_receipt")
	if err != nil {
		return 0, err
	}
	if err = VerifyOwnedIPAssetProductLinkReceiptSchema(ctx, resolved[0].DB, receiptTable); err != nil {
		return 0, err
	}
	repo, err := io.NewReceiptRepository(resolved[0].DB, io.WithReceiptTable(receiptTable))
	if err != nil {
		return 0, err
	}
	command := map[string]any{"action": action, "id": id, "actor": identity.ActorUID, "input": payload}
	receipt, err := assetsOwnedReceiptInput(identity, "assets.ip-assets."+action+".v1", "assets:ip-asset:"+action, id, command)
	if err != nil {
		return 0, err
	}
	result, err := repo.ExecuteOwnedInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		target := id
		var e error
		if action == "create" {
			target, e = createIPAssetInTransaction(ctx, tx, payload, query)
		} else {
			e = updateIPAssetInTransaction(ctx, tx, id, payload, query)
		}
		return io.ReceiptBusinessResult{TargetBizType: "ip_asset", TargetBizCode: strconv.FormatInt(target, 10), HTTPStatus: 200}, e
	})
	if err != nil {
		return 0, err
	}
	target, err := strconv.ParseInt(result.TargetBizCode, 10, 64)
	if err != nil || target <= 0 {
		return 0, httperror.New(503, "invalid_ip_asset_receipt", "IP asset receipt unavailable")
	}
	if err = requireIPAssetWriteScopeTx(ctx, tx, target, query); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return target, nil
}

// EnterpriseIPAssetProductLink owns the relation, audit event and receipt in
// one Registry-fenced transaction. Both source and target scopes are rechecked
// for every replay.
func (a *Adapter) EnterpriseIPAssetProductLink(ctx context.Context, identity ProductMasterCommandIdentity, id int64, body map[string]any, query url.Values) (int64, error) {
	if id <= 0 || identity.ActorUID == "" || identity.ActorUID != query.Get("current_user") || strings.TrimSpace(identity.Key) == "" {
		return 0, httperror.New(403, "invalid_ip_asset_link_identity", "Bound actor, IP asset and key required")
	}
	if len(body) != 1 {
		return 0, httperror.New(400, "invalid_ip_asset_link_field", "Unsupported IP product relation field")
	}
	productID, err := requireIDBody(body, "product_asset_id", "Product required")
	if err != nil {
		return 0, err
	}
	if a.enterpriseWrites == nil || a.enterpriseWrites.registry == nil {
		return 0, httperror.New(503, "enterprise_ip_assets_writer_unavailable", "IP asset unified writer unavailable")
	}
	tx, resolved, err := a.enterpriseWrites.registry.BeginWriteTransaction(ctx, a.enterpriseWrites.request)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if len(resolved) != 1 {
		return 0, httperror.New(503, "enterprise_ip_assets_writer_unavailable", "IP asset writer unavailable")
	}
	receiptTable, err := resolved[0].Table("service_command_receipt")
	if err != nil {
		return 0, err
	}
	if err = VerifyOwnedIPAssetReceiptSchema(ctx, resolved[0].DB, receiptTable); err != nil {
		return 0, err
	}
	repo, err := io.NewReceiptRepository(resolved[0].DB, io.WithReceiptTable(receiptTable))
	if err != nil {
		return 0, err
	}
	if err = requireIPAssetWriteScopeTx(ctx, tx, id, query); err != nil {
		return 0, err
	}
	if err = requireIPAssetTargetProductTx(ctx, tx, productID, query); err != nil {
		return 0, err
	}
	input, err := assetsOwnedReceiptInput(identity, "assets.ip-assets.link-product.v1", "assets:ip-asset:link-product", id, map[string]any{"action": "link-product", "id": id, "actor": identity.ActorUID, "input": map[string]any{"product_asset_id": productID}})
	if err != nil {
		return 0, err
	}
	result, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if err := requireIPAssetWriteScopeTx(ctx, tx, id, query); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		if err := requireIPAssetTargetProductTx(ctx, tx, productID, query); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		_, err := tx.ExecContext(ctx, "INSERT INTO ip_asset_products (ip_asset_id, product_asset_id, created_by) VALUES (?, ?, ?)", id, productID, nullableString(identity.ActorUID))
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		if err = insertEvent(ctx, tx, "ip_asset", id, "product_bound", identity.ActorUID, map[string]any{"summary": "知识产权已关联产品", "product_asset_id": productID}); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		return io.ReceiptBusinessResult{TargetBizType: "ip_asset", TargetBizCode: strconv.FormatInt(id, 10), HTTPStatus: 200}, nil
	})
	if err != nil {
		return 0, err
	}
	if result.TargetBizCode != strconv.FormatInt(id, 10) {
		return 0, httperror.New(503, "invalid_ip_asset_receipt", "IP asset receipt unavailable")
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return id, nil
}
