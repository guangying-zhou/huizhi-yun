package assets

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"strconv"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var digitalAssetFields = map[string]bool{
	"digital_code": true, "digital_name": true, "digital_type": true,
	"storage_location": true, "owner_uid": true, "access_scope": true,
	"project_code": true, "environment_id": true, "status": true, "notes": true,
}

func DigitalAssetPayload(body map[string]any) (map[string]any, error) {
	payload := map[string]any{}
	for key, value := range body {
		if !digitalAssetFields[key] {
			return nil, httperror.New(400, "invalid_digital_asset_field", "Unsupported digital asset field")
		}
		if value != nil {
			if key == "environment_id" {
				number, ok := value.(float64)
				if !ok || number < 1 || number != float64(int64(number)) {
					return nil, httperror.New(400, "invalid_digital_asset_field", "Digital asset environment is invalid")
				}
			} else {
				text, ok := value.(string)
				limit := map[string]int{"digital_code": 64, "digital_name": 255, "digital_type": 64, "storage_location": 500, "owner_uid": 64, "access_scope": 64, "project_code": 191, "status": 64, "notes": 65535}[key]
				length := utf8.RuneCountInString(text)
				if key == "notes" {
					length = len(text)
				}
				if !ok || length > limit {
					return nil, httperror.New(400, "invalid_digital_asset_field", "Digital asset field is invalid")
				}
			}
		}
		payload[key] = value
	}
	return payload, nil
}

func requireDigitalAssetWriteScopeTx(ctx context.Context, tx *sql.Tx, id int64, query url.Values) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return err
	}
	if query.Get(assetsPermissionActionQueryKey) != "edit" {
		return httperror.New(403, "assets_digital_asset_edit_scope_required", "digital asset edit scope required")
	}
	where, args := "1=1", []any{id}
	if access != "all" {
		units, scopeErr := assetsScopeUnits(query)
		if scopeErr != nil {
			return scopeErr
		}
		scopeWhere, scopeArgs := digitalAssetScopeWhere("da", actor, units)
		where, args = scopeWhere, append(args, scopeArgs...)
	}
	var found int64
	err = tx.QueryRowContext(ctx, "SELECT da.id FROM digital_assets da WHERE da.id=? AND "+where+" FOR UPDATE", args...).Scan(&found)
	if err == sql.ErrNoRows {
		return httperror.New(403, "assets_digital_asset_scope_forbidden", "digital asset outside authorized scope")
	}
	return err
}

func CreateDigitalAssetInTransaction(ctx context.Context, tx *sql.Tx, body map[string]any, query url.Values) (int64, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return 0, err
	}
	if query.Get(assetsPermissionActionQueryKey) != "edit" {
		return 0, httperror.New(403, "assets_digital_asset_edit_scope_required", "digital asset edit scope required")
	}
	if access != "all" {
		if _, err = assetsScopeUnits(query); err != nil {
			return 0, err
		}
	}
	insert, err := tx.ExecContext(ctx, `INSERT INTO digital_assets (digital_code,digital_name,digital_type,storage_location,owner_uid,access_scope,project_code,environment_id,status,notes,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
		coalesceText(body, "digital_code", buildCode("DA")), coalesceText(body, "digital_name", "未命名数字资产"), coalesceText(body, "digital_type", "document"), nullableBodyText(body, "storage_location"), nullableBodyText(body, "owner_uid"), coalesceText(body, "access_scope", "project"), nullableBodyText(body, "project_code"), nullableBodyInt64(body, "environment_id"), coalesceText(body, "status", "active"), nullableBodyText(body, "notes"), nullableString(actor), nullableString(actor))
	if err != nil {
		return 0, err
	}
	id, err := insert.LastInsertId()
	if err != nil {
		return 0, err
	}
	if err = requireDigitalAssetWriteScopeTx(ctx, tx, id, query); err != nil {
		return 0, err
	}
	if err = insertEvent(ctx, tx, "digital_asset", id, "created", actor, map[string]any{"summary": "数字资产已创建"}); err != nil {
		return 0, err
	}
	return id, nil
}

func UpdateDigitalAssetInTransaction(ctx context.Context, tx *sql.Tx, id int64, body map[string]any, query url.Values) error {
	if err := requireDigitalAssetWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	actor := query.Get("current_user")
	_, err := tx.ExecContext(ctx, `UPDATE digital_assets SET digital_name=COALESCE(?,digital_name), digital_type=COALESCE(?,digital_type), storage_location=CASE WHEN ? THEN ? ELSE storage_location END, owner_uid=CASE WHEN ? THEN ? ELSE owner_uid END, access_scope=COALESCE(?,access_scope), project_code=CASE WHEN ? THEN ? ELSE project_code END, environment_id=CASE WHEN ? THEN ? ELSE environment_id END, status=COALESCE(?,status), notes=CASE WHEN ? THEN ? ELSE notes END, updated_by=? WHERE id=?`, nullableBodyText(body, "digital_name"), nullableBodyText(body, "digital_type"), bodyHas(body, "storage_location"), nullableBodyText(body, "storage_location"), bodyHas(body, "owner_uid"), nullableBodyText(body, "owner_uid"), nullableBodyText(body, "access_scope"), bodyHas(body, "project_code"), nullableBodyText(body, "project_code"), bodyHas(body, "environment_id"), nullableBodyInt64(body, "environment_id"), nullableBodyText(body, "status"), bodyHas(body, "notes"), nullableBodyText(body, "notes"), nullableString(actor), id)
	if err != nil {
		return err
	}
	if err = requireDigitalAssetWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	return insertEvent(ctx, tx, "digital_asset", id, "updated", actor, map[string]any{"summary": "数字资产已更新"})
}

func bodyHas(body map[string]any, key string) bool { _, ok := body[key]; return ok }

func (a *Adapter) EnterpriseDigitalAssetCommand(ctx context.Context, identity ProductMasterCommandIdentity, action string, id int64, body map[string]any, query url.Values) (int64, error) {
	if action != "create" && action != "edit" {
		return 0, httperror.New(400, "invalid_digital_asset_action", "Unsupported digital asset action")
	}
	if (action == "create" && id != 0) || (action == "edit" && id <= 0) {
		return 0, httperror.New(400, "invalid_digital_asset_id", "Digital asset id invalid")
	}
	payload, err := DigitalAssetPayload(body)
	if err != nil {
		return 0, err
	}
	if action == "edit" && bodyHas(payload, "digital_code") {
		return 0, httperror.New(400, "invalid_digital_asset_field", "Digital asset code cannot be changed")
	}
	if a.enterpriseWrites == nil || a.enterpriseWrites.registry == nil {
		return 0, httperror.New(503, "enterprise_digital_assets_writer_unavailable", "Digital asset unified writer unavailable")
	}
	request := a.enterpriseWrites.request
	if identity.Tenant != request.Key.Tenant || request.Operation != enterprise.Write {
		return 0, httperror.New(403, "enterprise_digital_assets_writer_invalid", "Digital asset writer binding invalid")
	}
	tx, resolved, err := a.enterpriseWrites.registry.BeginWriteTransaction(ctx, request)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if len(resolved) != 1 {
		return 0, httperror.New(503, "enterprise_digital_assets_writer_unavailable", "Digital asset writer unavailable")
	}
	receiptTable, err := resolved[0].Table("service_command_receipt")
	if err != nil {
		return 0, err
	}
	if err = VerifyOwnedDigitalAssetReceiptSchema(ctx, resolved[0].DB, receiptTable); err != nil {
		return 0, err
	}
	repo, err := io.NewReceiptRepository(resolved[0].DB, io.WithReceiptTable(receiptTable))
	if err != nil {
		return 0, err
	}
	command := map[string]any{"action": action, "id": id, "actor": identity.ActorUID, "input": payload}
	capability := "assets:digital-asset:" + action
	receipt, err := assetsOwnedReceiptInput(identity, "assets.digital-assets."+action+".v1", capability, id, command)
	if err != nil {
		return 0, err
	}
	result, err := repo.ExecuteOwnedInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		target := id
		if action == "create" {
			target, err = CreateDigitalAssetInTransaction(ctx, tx, payload, query)
		} else {
			err = UpdateDigitalAssetInTransaction(ctx, tx, id, payload, query)
		}
		return io.ReceiptBusinessResult{TargetBizType: "digital_asset", TargetBizCode: strconv.FormatInt(target, 10), HTTPStatus: 200}, err
	})
	if err != nil {
		return 0, err
	}
	target, err := strconv.ParseInt(result.TargetBizCode, 10, 64)
	if err != nil || target <= 0 {
		return 0, httperror.New(503, "invalid_digital_asset_receipt", "Digital asset receipt unavailable")
	}
	if err = requireDigitalAssetWriteScopeTx(ctx, tx, target, query); err != nil {
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		return 0, err
	}
	return target, nil
}
