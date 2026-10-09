package assets

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	assetsOffboardingSyncOperation  = "people.offboarding.assets-recovery-sync.v1"
	assetsOffboardingSyncCapability = "assets:offboarding-recovery:sync"
)

func (a *Adapter) handleOffboardingRecoveryRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	switch {
	case method == http.MethodPost && path == "/v1/assets/service/offboarding-recoveries:upsert":
		item, err := a.upsertOffboardingRecovery(ctx, query, body)
		return okWithMessage(item, "ok"), "assets.offboarding_recoveries.upsert", true, err
	case method == http.MethodGet && path == "/v1/assets/offboarding-recoveries":
		items, err := a.listOffboardingRecoveries(ctx, query)
		return okWithMessage(map[string]any{"items": items, "total": len(items)}, "ok"), "assets.offboarding_recoveries.list", true, err
	case method == http.MethodGet && offboardingRecoveryCode(path) != "":
		item, err := a.getOffboardingRecovery(ctx, offboardingRecoveryCode(path), time.Now().UTC(), query)
		return okWithMessage(item, "ok"), "assets.offboarding_recoveries.get", true, err
	case method == http.MethodPatch && offboardingRecoveryCode(path) != "":
		item, err := a.assignOffboardingRecoveryResponsibility(ctx, offboardingRecoveryCode(path), query, body, actorFromRequest(query, body))
		return okWithMessage(item, "ok"), "assets.offboarding_recoveries.assign_responsibility", true, err
	default:
		return nil, "", false, nil
	}
}

func offboardingRecoveryCode(path string) string {
	raw, ok := singlePathParam(path, "/v1/assets/offboarding-recoveries/")
	if !ok {
		return ""
	}
	return strings.TrimSpace(raw)
}

func validOffboardingUID(uid string) bool {
	if uid == "" || uid != strings.TrimSpace(uid) || len(uid) > 64 || strings.EqualFold(uid, "@all") {
		return false
	}
	for _, r := range uid {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}

func (a *Adapter) upsertOffboardingRecovery(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(body, "assets", assetsOffboardingSyncOperation, assetsOffboardingSyncCapability)
	if err != nil {
		if errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch) {
			return nil, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "service command identity or payload does not match")
		}
		return nil, httperror.New(http.StatusForbidden, "service_command_context_invalid", "a signed People service command envelope is required")
	}
	if receiptInput.TrustedContext.SourceApp != "people" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be people")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		item, err := a.upsertOffboardingRecoveryTx(ctx, tx, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "offboarding_recovery_case", TargetBizCode: cleanAnyString(item["case_code"]), HTTPStatus: http.StatusOK, Value: item}, nil
	})
	if err != nil {
		return nil, assetsServiceCommandReceiptError(err)
	}
	return map[string]any{"receiptId": executed.ReceiptID, "receiptStatus": "succeeded", "operationId": receiptInput.OperationID, "operationCode": receiptInput.OperationCode, "idempotencyKey": receiptInput.IdempotencyKey, "commandSchemaVersion": receiptInput.CommandSchemaVersion, "commandSha256": receiptInput.CommandSHA256, "idempotent": executed.Existing, "targetBizType": executed.TargetBizType, "targetBizCode": executed.TargetBizCode, "responseSummarySha256": executed.ResponseSummarySHA256, "result": executed.Value}, nil
}

func (a *Adapter) upsertOffboardingRecoveryTx(ctx context.Context, tx *sql.Tx, body map[string]any) (map[string]any, error) {
	sourceEvent := strings.TrimSpace(bodyString(body, "sourceEventKey", "source_event_key"))
	departedUID := strings.TrimSpace(bodyString(body, "departedEmployeeUid", "departed_employee_uid"))
	for _, forbidden := range []string{"caseCode", "case_code", "recoveryDueAt", "recovery_due_at", "recoveryResponsibleUid", "recovery_responsible_uid", "assetIds", "asset_ids", "sourceApp", "source_app"} {
		if _, exists := body[forbidden]; exists {
			return nil, httperror.New(http.StatusBadRequest, "assets_offboarding_recovery_payload_forbidden", "case, due, responsibility and asset facts are owned by Assets")
		}
	}
	if sourceEvent == "" || len(sourceEvent) > 191 || !validOffboardingUID(departedUID) {
		return nil, httperror.New(http.StatusBadRequest, "assets_offboarding_recovery_identity_invalid", "sourceEventKey and departedEmployeeUid are required")
	}
	offboardedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(bodyString(body, "offboardedAt", "offboarded_at")))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "assets_offboarding_recovery_offboarded_at_invalid", "offboardedAt must be RFC3339")
	}
	departedName := strings.TrimSpace(bodyString(body, "departedEmployeeName", "departed_employee_name"))
	canonical := strings.Join([]string{"v1", "people", sourceEvent, departedUID, departedName, offboardedAt.UTC().Format(time.RFC3339)}, "|")
	payloadHash := sha256.Sum256([]byte(canonical))
	payloadSHA := hex.EncodeToString(payloadHash[:])
	identityHash := sha256.Sum256([]byte("people|" + sourceEvent))
	caseCode := "AOR-" + strings.ToUpper(hex.EncodeToString(identityHash[:8]))
	dueAt := offboardedAt.UTC().Format("2006-01-02")
	operator := firstText(bodyString(body, "current_user"), bodyString(body, integrationoperation.TrustedServiceCommandSourceClientKey))
	_, err = tx.ExecContext(ctx, `INSERT IGNORE INTO asset_offboarding_recovery_cases(case_code,source_app,source_event_key,source_payload_sha256,departed_employee_uid,departed_employee_name,offboarded_at,recovery_due_at,status,created_by,updated_by)
		VALUES(?,'people',?,?,?,?,?,?,'active',?,?)`, caseCode, sourceEvent, payloadSHA, departedUID, nullableString(departedName), offboardedAt.UTC(), dueAt, nullableString(operator), nullableString(operator))
	if err != nil {
		return nil, err
	}
	var storedCase, storedSHA string
	if err := tx.QueryRowContext(ctx, `SELECT case_code,source_payload_sha256 FROM asset_offboarding_recovery_cases WHERE source_app='people' AND source_event_key=? LIMIT 1 FOR UPDATE`, sourceEvent).Scan(&storedCase, &storedSHA); err != nil {
		return nil, err
	}
	if storedSHA != payloadSHA || storedCase != caseCode {
		return nil, httperror.New(http.StatusConflict, "assets_offboarding_recovery_payload_conflict", "sourceEventKey already exists with different lifecycle evidence")
	}
	return map[string]any{"case_code": caseCode, "departed_employee_uid": departedUID, "departed_employee_name": nullableString(departedName), "offboarded_at": offboardedAt.UTC().Format(time.RFC3339), "recovery_due_at": dueAt, "recovery_responsible_uid": nil, "status": "active"}, nil
}

func (a *Adapter) assignOffboardingRecoveryResponsibility(ctx context.Context, caseCode string, query url.Values, body map[string]any, operator string) (map[string]any, error) {
	var departed string
	if err := a.DB().QueryRowContext(ctx, `SELECT departed_employee_uid FROM asset_offboarding_recovery_cases WHERE case_code=? LIMIT 1`, caseCode).Scan(&departed); err == sql.ErrNoRows {
		return nil, notFound("离职资产回收事项不存在")
	} else if err != nil {
		return nil, err
	}
	value, present := body["recovery_responsible_uid"]
	if !present {
		value, present = body["recoveryResponsibleUid"]
	}
	if !present {
		return nil, httperror.New(http.StatusBadRequest, "assets_recovery_responsible_required", "recoveryResponsibleUid is required")
	}
	var responsible any
	if value != nil {
		uid, ok := value.(string)
		if !ok || !validOffboardingUID(uid) || uid == departed {
			return nil, httperror.New(http.StatusBadRequest, "assets_recovery_responsible_invalid", "recovery responsible must be an explicit non-departed UID")
		}
		responsible = uid
	}
	if err := a.requireOffboardingRecoveryObjectAccess(ctx, query, caseCode); err != nil {
		return nil, err
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE asset_offboarding_recovery_cases SET recovery_responsible_uid=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE case_code=?`, responsible, nullableString(operator), caseCode)
	if err != nil {
		return nil, err
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return nil, notFound("离职资产回收事项不存在")
	}
	return a.getOffboardingRecoveryUnscoped(ctx, caseCode, time.Now().UTC())
}

func offboardingOutstandingPredicate(caseAlias, assetAlias string) string {
	return assetAlias + `.user_uid=` + caseAlias + `.departed_employee_uid`
}

func (a *Adapter) getOffboardingRecovery(ctx context.Context, caseCode string, asOf time.Time, query url.Values) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	if access == "relation" {
		units, unitErr := assetsScopeUnits(query)
		if unitErr != nil {
			return nil, unitErr
		}
		allowed := false
		for _, unit := range units {
			if unit.DirectRelation && len(unit.DepartmentCodes) == 0 && len(unit.ProjectCodes) == 0 {
				allowed = true
			}
		}
		if !allowed {
			return nil, httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this record")
		}
		var id int64
		if scanErr := a.DB().QueryRowContext(ctx, `SELECT id FROM asset_offboarding_recovery_cases WHERE case_code=? AND status='active' AND recovery_responsible_uid=? LIMIT 1`, caseCode, actor).Scan(&id); scanErr == sql.ErrNoRows {
			return nil, notFound("离职资产回收事项不存在")
		} else if scanErr != nil {
			return nil, scanErr
		}
	}
	return a.getOffboardingRecoveryUnscoped(ctx, caseCode, asOf)
}

func (a *Adapter) getOffboardingRecoveryUnscoped(ctx context.Context, caseCode string, asOf time.Time) (map[string]any, error) {
	row, err := queryOne(ctx, a.DB(), `SELECT c.*, (SELECT COUNT(*) FROM asset_items ai WHERE ai.archived_at IS NULL AND ai.status NOT IN ('in_stock','scrapped','inactive','disposed','retired') AND `+offboardingOutstandingPredicate("c", "ai")+`) AS outstanding_count FROM asset_offboarding_recovery_cases c WHERE c.case_code=? LIMIT 1`, caseCode)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, notFound("离职资产回收事项不存在")
	}
	items, err := queryRows(ctx, a.DB(), `SELECT ai.id,ai.public_id,ai.asset_code,ai.asset_name,ai.asset_category,ai.asset_subtype,ai.status,ai.user_uid FROM asset_items ai JOIN asset_offboarding_recovery_cases c ON c.case_code=? WHERE ai.archived_at IS NULL AND ai.status NOT IN ('in_stock','scrapped','inactive','disposed','retired') AND `+offboardingOutstandingPredicate("c", "ai")+` ORDER BY ai.id`, caseCode)
	if err != nil {
		return nil, err
	}
	row["items"] = items
	return row, nil
}

func (a *Adapter) listOffboardingRecoveries(ctx context.Context, query url.Values) ([]map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	where := []string{"1=1"}
	args := []any{}
	if access == "relation" {
		units, unitErr := assetsScopeUnits(query)
		if unitErr != nil {
			return nil, unitErr
		}
		allowed := false
		for _, unit := range units {
			if unit.DirectRelation && len(unit.DepartmentCodes) == 0 && len(unit.ProjectCodes) == 0 {
				allowed = true
			}
		}
		if !allowed {
			return []map[string]any{}, nil
		}
		where = append(where, "c.status='active'", "c.recovery_responsible_uid=?")
		args = append(args, actor)
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "c.status=?")
		args = append(args, status)
	}
	return queryRows(ctx, a.DB(), `SELECT c.*, (SELECT COUNT(*) FROM asset_items ai WHERE ai.archived_at IS NULL AND ai.status NOT IN ('in_stock','scrapped','inactive','disposed','retired') AND `+offboardingOutstandingPredicate("c", "ai")+`) AS outstanding_count FROM asset_offboarding_recovery_cases c WHERE `+strings.Join(where, " AND ")+` ORDER BY c.recovery_due_at,c.id LIMIT 200`, args...)
}

func (a *Adapter) requireOffboardingRecoveryObjectAccess(ctx context.Context, query url.Values, caseCode string) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil || access == "all" {
		return err
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return err
	}
	allowed := false
	for _, unit := range units {
		if unit.DirectRelation && len(unit.DepartmentCodes) == 0 && len(unit.ProjectCodes) == 0 {
			allowed = true
		}
	}
	if !allowed {
		return httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this record")
	}
	var id int64
	err = a.DB().QueryRowContext(ctx, `SELECT id FROM asset_offboarding_recovery_cases WHERE case_code=? AND status='active' AND recovery_responsible_uid=? LIMIT 1`, caseCode, actor).Scan(&id)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this record")
	}
	return err
}

func queryOne(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sqlText string, args ...any) (map[string]any, error) {
	rows, err := queryRows(ctx, q, sqlText, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

func queryRows(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sqlText string, args ...any) ([]map[string]any, error) {
	rows, err := q.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := map[string]any{}
		for i, c := range cols {
			v := values[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			m[c] = v
		}
		items = append(items, m)
	}
	return items, rows.Err()
}
