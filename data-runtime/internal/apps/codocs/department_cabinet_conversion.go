package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func departmentCabinetConversionFacts(identity EnterpriseDepartmentCabinetIdentity, payload map[string]any, commit bool) (map[string]any, error) {
	if _, err := departmentCabinetInput(identity, "convert", payload); err != nil {
		return nil, err
	}
	allowed := []string{"uuid", "title", "folder_id"}
	if commit {
		allowed = append(allowed, "source_state", "content_sha256", "content_size")
	}
	if err := onlyDepartmentCabinetFields(payload, allowed...); err != nil {
		return nil, err
	}
	source, title := stringField(payload, "uuid"), stringField(payload, "title")
	if !departmentCabinetCode.MatchString(source) || title == "" || len([]rune(title)) > 255 {
		return nil, httperror.New(400, "department_cabinet_conversion_invalid", "Invalid conversion request")
	}
	folder, err := idField(payload, "folder_id")
	if err != nil {
		return nil, err
	}
	if commit {
		if !personalDocumentContentHash.MatchString(stringField(payload, "source_state")) || !personalDocumentContentHash.MatchString(stringField(payload, "content_sha256")) {
			return nil, httperror.New(400, "department_cabinet_conversion_invalid", "Invalid conversion content hash")
		}
		size, ok := payload["content_size"].(float64)
		if !ok || size < 0 || size > 10*1024*1024 || size != float64(int64(size)) {
			return nil, httperror.New(400, "department_cabinet_conversion_invalid", "Invalid conversion content size")
		}
	}
	intent := map[string]any{"uuid": source, "title": title, "folder_id": nullableInt64(folder)}
	raw, _ := json.Marshal(intent)
	digest := sha256.Sum256(raw)
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-cabinet.convert.v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Department, identity.Key}, "\x00")))
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	id := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	intent["source_uuid"], intent["uuid"], intent["owner_uid"], intent["dept_code"] = source, id, identity.Actor, identity.Department
	intent["target_prefix"] = "codocs/cabinet-conversions/" + id + "/" + hex.EncodeToString(digest[:]) + "/"
	return intent, nil
}

func checkDepartmentCabinetConversion(ctx context.Context, tx *sql.Tx, identity EnterpriseDepartmentCabinetIdentity, facts map[string]any) error {
	var owner, dept, path, ext string
	var size int64
	var status int
	var converted, updated sql.NullString
	var deleted sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT owner_uid,dept_code,oss_path,file_ext,file_size,status,deleted_at,converted_doc_uuid,updated_at FROM cabinet_files WHERE uuid=? AND project_code IS NULL LIMIT 1 FOR UPDATE`, facts["source_uuid"]).Scan(&owner, &dept, &path, &ext, &size, &status, &deleted, &converted, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(404, "department_cabinet_source_not_found", "Source file not found")
	}
	if err != nil {
		return err
	}
	if dept != identity.Department {
		return httperror.New(403, "department_cabinet_source_scope_denied", "Source file is outside department")
	}
	if status != 1 || deleted.Valid {
		return httperror.New(409, "department_cabinet_source_changed", "Source file is deleted")
	}
	if ext != "doc" && ext != "docx" {
		return httperror.New(400, "department_cabinet_conversion_unsupported", "File cannot be converted")
	}
	if size < 0 || size > 100*1024*1024 || !strings.HasPrefix(path, "codocs/departments/"+identity.Department+"/cabinet/") {
		return httperror.New(409, "department_cabinet_source_invalid", "Source file is invalid")
	}
	raw, _ := json.Marshal([]any{facts["source_uuid"], owner, dept, path, ext, size, status, converted, updated})
	state := sha256.Sum256(raw)
	facts["source_state"], facts["source_path"], facts["source_ext"], facts["source_size"] = hex.EncodeToString(state[:]), path, ext, size
	var targetOwner, targetDept, targetType, targetPath, targetTitle string
	var targetStatus int
	err = tx.QueryRowContext(ctx, `SELECT owner_uid,dept_code,doc_type,oss_path,title,status FROM documents WHERE uuid=? LIMIT 1 FOR UPDATE`, facts["uuid"]).Scan(&targetOwner, &targetDept, &targetType, &targetPath, &targetTitle, &targetStatus)
	if err == nil {
		if targetOwner != identity.Actor || targetDept != identity.Department || targetType != "department" {
			return httperror.New(403, "department_cabinet_conversion_target_scope_denied", "Target document is outside department")
		}
		if targetStatus == 0 || !strings.HasPrefix(targetPath, facts["target_prefix"].(string)) {
			return httperror.New(409, "department_cabinet_conversion_key_conflict", "Conversion target changed")
		}
		facts["replayed"], facts["title"], facts["oss_path"] = true, targetTitle, targetPath
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	folder, _ := facts["folder_id"].(int64)
	if folder > 0 {
		row, e := readFolderScope(ctx, tx, folder, true)
		if e != nil {
			return e
		}
		if row.Kind != "department" || row.Department.String != identity.Department || row.Project.Valid {
			return httperror.New(403, "department_cabinet_conversion_folder_scope_denied", "Target folder is outside department")
		}
	}
	if err := ensureDocumentTitleAvailableFrom(ctx, tx, facts["uuid"].(string), map[string]any{"owner_uid": identity.Actor, "doc_type": "department", "dept_code": identity.Department}, facts["title"].(string), facts["folder_id"]); err != nil {
		return err
	}
	facts["replayed"] = false
	return nil
}

func (a *Adapter) planEnterpriseDepartmentCabinetConversion(ctx context.Context, identity EnterpriseDepartmentCabinetIdentity, payload map[string]any, check EnterpriseDepartmentCabinetManagerCheck) (map[string]any, error) {
	facts, err := departmentCabinetConversionFacts(identity, payload, false)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := check(ctx, tx, identity.Actor, identity.Department); err != nil {
		return nil, err
	}
	if err := checkDepartmentCabinetConversion(ctx, tx, identity, facts); err != nil {
		return nil, err
	}
	return facts, nil
}

func (a *Adapter) convertEnterpriseDepartmentCabinet(ctx context.Context, identity EnterpriseDepartmentCabinetIdentity, payload map[string]any, check EnterpriseDepartmentCabinetManagerCheck) (map[string]any, error) {
	facts, err := departmentCabinetConversionFacts(identity, payload, true)
	if err != nil {
		return nil, err
	}
	input, err := departmentCabinetInput(identity, "convert", payload)
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
	if err := checkDepartmentCabinetConversion(ctx, tx, identity, facts); err != nil {
		return nil, err
	}
	if facts["replayed"] != true && facts["source_state"] != payload["source_state"] {
		return nil, httperror.New(409, "department_cabinet_source_changed", "Source file changed")
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if facts["replayed"] == true {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_cabinet_conversion_receipt_missing", "Conversion exists without this receipt")
		}
		path := facts["target_prefix"].(string) + facts["source_state"].(string) + "/" + stringField(payload, "content_sha256") + ".md"
		result, e := tx.ExecContext(ctx, `INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,dept_code,project_code,folder_id,content_size,status) VALUES (?,?,'department',?,?,?,NULL,?,?,1)`, facts["uuid"], facts["title"], path, identity.Actor, identity.Department, facts["folder_id"], payload["content_size"])
		if e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		id, e := result.LastInsertId()
		if e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		if e = upsertDocumentRelationTx(ctx, tx, documentRelationInput{DocumentID: id, DocumentUUID: facts["uuid"].(string), RelatedUID: identity.Actor, RelationType: "created_by_me", SourceType: "document", SourceID: strconv.FormatInt(id, 10), CanRead: true, CanEdit: true, Metadata: map[string]any{"docType": "department", "deptCode": identity.Department, "folderId": facts["folder_id"], "sourceApp": "codocs", "sourceBiz": facts["source_uuid"]}}); e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		if _, e = tx.ExecContext(ctx, `UPDATE cabinet_files SET converted_doc_uuid=?,updated_at=NOW() WHERE uuid=? AND dept_code=?`, facts["uuid"], facts["source_uuid"], identity.Department); e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		facts["oss_path"] = path
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: facts["uuid"].(string), HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_cabinet_conversion_key_conflict", "Conversion key was used for another request")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != facts["uuid"] {
		return nil, httperror.New(409, "department_cabinet_conversion_receipt_conflict", "Conversion receipt does not match document")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return facts, nil
}
