package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var enterpriseCompanyCategories = map[string]bool{
	"rules": true, "notices": true, "legal": true, "culture": true,
	"tech-specs": true, "knowledge": true, "templates": true,
}

func enterpriseCompanyObjectPath(value string, directory bool) bool {
	if len(value) > 800 || !strings.HasPrefix(value, "codocs/company/") || strings.ContainsAny(value, "\\\x00\r\n\t") {
		return false
	}
	segments := strings.Split(value, "/")
	if directory {
		if !strings.HasSuffix(value, "/") || len(segments) < 5 {
			return false
		}
		segments = segments[:len(segments)-1]
	} else if len(segments) < 4 || strings.HasSuffix(value, "/") {
		return false
	}
	if len(segments) < 4 || segments[0] != "codocs" || segments[1] != "company" || !enterpriseCompanyCategories[segments[2]] {
		return false
	}
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	for _, char := range value {
		if char < 32 || char == 127 {
			return false
		}
	}
	return true
}

func enterpriseCompanyMutationCommand(action string, body map[string]any) (map[string]any, error) {
	id := stringValue(body["operationId"])
	if parsed, err := uuid.Parse(id); err != nil || parsed.String() != id {
		return nil, httperror.New(400, "invalid_asset_operation", "Valid operation ID required")
	}
	invalid := func() (map[string]any, error) {
		return nil, httperror.New(400, "invalid_asset_mutation", "Invalid company asset mutation")
	}
	command := map[string]any{"operationId": id, "action": action}
	switch action {
	case "mkdir", "delete-directory":
		path := stringValue(body["path"])
		if !enterpriseCompanyObjectPath(path, true) {
			return invalid()
		}
		command["path"] = path
	case "move", "archive":
		source, target := stringValue(body["sourcePath"]), stringValue(body["targetPath"])
		companySource := enterpriseCompanyObjectPath(source, false)
		departmentArchive := action == "archive" && validPublishedAssetPath(source) && strings.HasPrefix(source, "codocs/departments/")
		if (!companySource && !departmentArchive) || source == target {
			return invalid()
		}
		if action == "move" {
			if !enterpriseCompanyObjectPath(target, false) || strings.Split(source, "/")[2] != strings.Split(target, "/")[2] {
				return invalid()
			}
		} else {
			expected := strings.Replace(source, "codocs/company/", "codocs/archives/company/", 1)
			if departmentArchive {
				expected = strings.Replace(source, "codocs/departments/", "codocs/archives/departments/", 1)
			}
			if target != expected {
				return invalid()
			}
		}
		command["sourcePath"], command["targetPath"] = source, target
	default:
		return invalid()
	}
	return command, nil
}

// Prepare and complete are separate committed receipts because OSS cannot join
// the SQL transaction. The Host verifies OSS object ownership and source state
// between the two phases. Neither phase mutates storage from Runtime.
func (a *Adapter) EnterpriseCompanyAssetMutation(ctx context.Context, identity EnterpriseCompanyCommandIdentity, action, phase string, body map[string]any) (map[string]any, error) {
	if phase != "prepare" && phase != "complete" {
		return nil, httperror.New(400, "invalid_asset_mutation_phase", "Invalid mutation phase")
	}
	command, err := enterpriseCompanyMutationCommand(action, body)
	if err != nil {
		return nil, err
	}
	if phase == "complete" {
		if stringValue(body["evidence"]) != "verified" {
			return nil, httperror.New(400, "asset_evidence_required", "Verified storage evidence required")
		}
		command["evidence"] = "verified"
	}
	id := command["operationId"].(string)
	prepareOperation := "enterprise.codocs.company-asset." + action + ".prepare.v1"
	prepareCommand := make(map[string]any, len(command))
	for key, value := range command {
		if key != "evidence" {
			prepareCommand[key] = value
		}
	}
	prepareInput, err := enterpriseCompanyReceiptInput(identity, prepareOperation, "company-asset-mutation.v1", prepareCommand)
	if err != nil {
		return nil, err
	}
	result, err := a.enterpriseCompanyReceipt(ctx, identity, "enterprise.codocs.company-asset."+action+"."+phase+".v1", "company-asset-mutation.v1", command,
		func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
			if phase == "complete" {
				var storedID string
				err := tx.QueryRowContext(ctx, `SELECT target_biz_code FROM service_command_receipt
					WHERE tenant_code=? AND source_deployment_code=? AND deployment_code=?
					AND source_app='enterprise' AND target_app='codocs' AND operation_code=?
					AND idempotency_key=? AND command_sha256=? AND original_actor_uid=? AND status='succeeded' FOR UPDATE`,
					identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, prepareOperation,
					prepareInput.IdempotencyKey, prepareInput.CommandSHA256, identity.Actor).Scan(&storedID)
				if err == sql.ErrNoRows {
					return io.ReceiptBusinessResult{}, httperror.New(409, "asset_mutation_prepare_missing", "Mutation prepare receipt unavailable")
				}
				if err != nil {
					return io.ReceiptBusinessResult{}, err
				}
				if storedID != id {
					return io.ReceiptBusinessResult{}, httperror.New(409, "asset_mutation_prepare_conflict", "Mutation prepare receipt changed")
				}
			}
			return io.ReceiptBusinessResult{TargetBizType: "company_asset_mutation", TargetBizCode: id, HTTPStatus: http.StatusOK}, nil
		})
	if err != nil {
		return nil, err
	}
	if result.TargetBizCode != id {
		return nil, httperror.New(409, "asset_mutation_receipt_conflict", "Mutation receipt conflicts with request")
	}
	return map[string]any{"operationId": id, "action": action, "phase": phase, "replayed": result.Existing}, nil
}
