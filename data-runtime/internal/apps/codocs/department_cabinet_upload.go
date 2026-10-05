package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func departmentCabinetUploadFacts(identity EnterpriseDepartmentCabinetIdentity, payload map[string]any) (map[string]any, error) {
	if _, err := departmentCabinetInput(identity, "upload", payload); err != nil {
		return nil, err
	}
	if err := ValidatePersonalCabinetUpload(payload); err != nil {
		return nil, err
	}
	var folder int64
	if value := payload["folder_id"]; value != nil {
		folder = int64(value.(float64))
	}
	request := map[string]any{"original_name": payload["original_name"], "file_ext": payload["file_ext"], "file_size": payload["file_size"], "content_sha256": payload["content_sha256"], "folder_id": nullableInt64(folder)}
	raw, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(raw)
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-cabinet.upload.v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Department, identity.Key}, "\x00")))
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	request["uuid"], request["owner_uid"], request["dept_code"] = uuid, identity.Actor, identity.Department
	request["filename"] = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, payload["original_name"].(string))
	request["oss_path"] = "codocs/departments/" + identity.Department + "/cabinet/" + uuid + "/" + hex.EncodeToString(digest[:]) + "." + payload["file_ext"].(string)
	return request, nil
}

func checkDepartmentCabinetUpload(ctx context.Context, tx *sql.Tx, facts map[string]any, department string) (int64, error) {
	if folder, ok := facts["folder_id"].(int64); ok && folder > 0 {
		if err := checkDepartmentCabinetFolder(ctx, tx, department, folder); err != nil {
			return 0, err
		}
	}
	var id, size int64
	var owner, dept, path, name, ext string
	var status int
	var folder sql.NullInt64
	var deleted sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT id,owner_uid,dept_code,oss_path,original_name,file_ext,file_size,folder_id,status,deleted_at FROM cabinet_files WHERE uuid=? LIMIT 1 FOR UPDATE`, facts["uuid"]).Scan(&id, &owner, &dept, &path, &name, &ext, &size, &folder, &status, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if owner != facts["owner_uid"] || dept != department {
		return 0, httperror.New(403, "department_cabinet_upload_scope_denied", "Upload is outside department")
	}
	expectedFolder, _ := facts["folder_id"].(int64)
	if status != 1 || deleted.Valid || path != facts["oss_path"] || name != facts["original_name"] || ext != facts["file_ext"] || size != int64(facts["file_size"].(float64)) || folder.Int64 != expectedFolder {
		return 0, httperror.New(409, "department_cabinet_upload_key_conflict", "Upload key refers to a changed file")
	}
	return id, nil
}

func (a *Adapter) planEnterpriseDepartmentCabinetUpload(ctx context.Context, identity EnterpriseDepartmentCabinetIdentity, payload map[string]any, check EnterpriseDepartmentCabinetManagerCheck) (map[string]any, error) {
	facts, err := departmentCabinetUploadFacts(identity, payload)
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
	if _, err := checkDepartmentCabinetUpload(ctx, tx, facts, identity.Department); err != nil {
		return nil, err
	}
	return facts, nil
}

func (a *Adapter) commitEnterpriseDepartmentCabinetUpload(ctx context.Context, identity EnterpriseDepartmentCabinetIdentity, payload map[string]any, check EnterpriseDepartmentCabinetManagerCheck) (map[string]any, error) {
	facts, err := departmentCabinetUploadFacts(identity, payload)
	if err != nil {
		return nil, err
	}
	input, err := departmentCabinetInput(identity, "upload", payload)
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
	id, err := checkDepartmentCabinetUpload(ctx, tx, facts, identity.Department)
	if err != nil {
		return nil, err
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if id == 0 {
			result, e := tx.ExecContext(ctx, `INSERT INTO cabinet_files(uuid,filename,original_name,file_ext,file_size,oss_path,owner_uid,dept_code,project_code,folder_id,status) VALUES (?,?,?,?,?,?,?,?,NULL,?,1)`, facts["uuid"], facts["filename"], facts["original_name"], facts["file_ext"], facts["file_size"], facts["oss_path"], identity.Actor, identity.Department, facts["folder_id"])
			if e != nil {
				return io.ReceiptBusinessResult{}, e
			}
			id, e = result.LastInsertId()
			if e != nil {
				return io.ReceiptBusinessResult{}, e
			}
		}
		return io.ReceiptBusinessResult{TargetBizType: "department-cabinet-file", TargetBizCode: facts["uuid"].(string), HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_cabinet_upload_key_conflict", "Upload key was used for another file")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != facts["uuid"] {
		return nil, httperror.New(409, "department_cabinet_upload_receipt_conflict", "Upload receipt does not match file")
	}
	if id == 0 {
		id, err = checkDepartmentCabinetUpload(ctx, tx, facts, identity.Department)
		if err != nil || id == 0 {
			return nil, httperror.New(409, "department_cabinet_upload_result_unavailable", "Uploaded file is unavailable")
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	facts["id"] = id
	return facts, nil
}
