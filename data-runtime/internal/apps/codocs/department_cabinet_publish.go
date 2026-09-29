package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var departmentCabinetPublishCategories = map[string]bool{"rules": true, "notices": true, "culture": true, "legal": true, "tech-specs": true, "knowledge": true, "templates": true}

// The service-command receipt is the durable publication record. Its target
// binds the exact company OSS key, source file, actor and intent in one SQL
// transaction after the Host has verified the conditional OSS copy.
func (a *Adapter) publishEnterpriseDepartmentCabinet(ctx context.Context, identity EnterpriseDepartmentCabinetIdentity, payload map[string]any, check EnterpriseDepartmentCabinetManagerCheck) (map[string]any, error) {
	if err := onlyDepartmentCabinetFields(payload, "uuid", "category", "source_etag", "target_etag"); err != nil {
		return nil, err
	}
	uuid, category := stringField(payload, "uuid"), stringField(payload, "category")
	if !departmentCabinetCode.MatchString(uuid) || !departmentCabinetPublishCategories[category] || stringField(payload, "source_etag") == "" || stringField(payload, "target_etag") == "" {
		return nil, httperror.New(400, "department_cabinet_publish_invalid", "Invalid publication evidence")
	}
	if strings.ContainsAny(stringField(payload, "source_etag")+stringField(payload, "target_etag"), "\r\n\x00") || len(stringField(payload, "source_etag")) > 200 || len(stringField(payload, "target_etag")) > 200 {
		return nil, httperror.New(400, "department_cabinet_publish_invalid", "Invalid publication evidence")
	}
	input, err := departmentCabinetInput(identity, "publish-record", payload)
	if err != nil {
		return nil, err
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := check(ctx, tx, identity.Actor, identity.Department); err != nil {
		return nil, err
	}
	var ext, path string
	var status int
	var deleted sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT file_ext,oss_path,status,deleted_at FROM cabinet_files WHERE uuid=? AND dept_code=? AND project_code IS NULL FOR UPDATE`, uuid, identity.Department).Scan(&ext, &path, &status, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(404, "cabinet_not_found", "Source file not found")
	}
	if err != nil {
		return nil, err
	}
	if ext != "pdf" || status != 1 || deleted.Valid || !strings.HasPrefix(path, "codocs/departments/"+identity.Department+"/cabinet/") {
		return nil, httperror.New(409, "department_cabinet_publish_source_changed", "Source PDF is unavailable")
	}
	target := "codocs/company/" + category + "/" + uuid + ".pdf"
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(context.Context, *sql.Tx, json.RawMessage) (io.ReceiptBusinessResult, error) {
		return io.ReceiptBusinessResult{TargetBizType: "company-asset-pdf", TargetBizCode: target, HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_cabinet_publish_key_conflict", "Publication key was used for another PDF")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != target {
		return nil, httperror.New(409, "department_cabinet_publish_receipt_conflict", "Publication receipt does not match target")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"targetPath": target}, nil
}
