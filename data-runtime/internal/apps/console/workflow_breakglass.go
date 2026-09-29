package console

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"
)

const workflowMaintenanceClient = "workflow.maintenance"
const workflowRecoveryScope = "workflow:delivery-recovery:execute"

var workflowBreakglassCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`)
var workflowBreakglassEffectID = regexp.MustCompile(`^[1-9][0-9]{0,18}$`)
var workflowBreakglassSHA256 = regexp.MustCompile(`^[a-f0-9]{64}$`)

// WorkflowBreakglassApproval is an externally approved operation, not an
// authorization decision. The offline command must bind it to its protected
// configuration and reviewed database before calling these methods.
type WorkflowBreakglassApproval struct {
	CaseID             string
	ApprovalID         string
	ApprovalRecordID   string
	ApprovalFileSHA256 string
	OperatorID         string
	TenantCode         string
	DeploymentCode     string
	EffectKind         string
	EffectID           string
}

func (a *Adapter) checkWorkflowBreakglass(in WorkflowBreakglassApproval) error {
	if !workflowBreakglassCode.MatchString(in.CaseID) ||
		!workflowBreakglassCode.MatchString(in.ApprovalID) ||
		!workflowBreakglassCode.MatchString(in.ApprovalRecordID) ||
		!workflowBreakglassSHA256.MatchString(in.ApprovalFileSHA256) ||
		!workflowBreakglassCode.MatchString(in.OperatorID) ||
		!workflowBreakglassCode.MatchString(in.TenantCode) ||
		!workflowBreakglassCode.MatchString(in.DeploymentCode) ||
		(in.EffectKind != "notification" && in.EffectKind != "actionable" && in.EffectKind != "callback") ||
		!workflowBreakglassEffectID.MatchString(in.EffectID) ||
		in.TenantCode != a.tenant {
		return errors.New("workflow breakglass approval binding invalid")
	}
	return nil
}

func workflowBreakglassAudit(ctx context.Context, tx *sql.Tx, stage string, in WorkflowBreakglassApproval, credentialID uint64) error {
	detail, err := json.Marshal(map[string]any{
		"caseId": in.CaseID, "approvalId": in.ApprovalID,
		"approvalRecordId": in.ApprovalRecordID, "approvalFileSha256": in.ApprovalFileSHA256,
		"tenantCode": in.TenantCode, "deploymentCode": in.DeploymentCode,
		"effectKind": in.EffectKind, "effectId": in.EffectID,
		"credentialId": credentialID,
	})
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO operation_logs
		(domain_code,action,target_type,target_key,actor_type,actor_id,detail_json,created_at)
		VALUES ('service_client',?,'service_client',?,'human',?,CAST(? AS JSON),UTC_TIMESTAMP())`,
		stage, workflowMaintenanceClient, in.OperatorID, string(detail))
	return err
}

func workflowBreakglassPriorStage(ctx context.Context, tx *sql.Tx, stage string, in WorkflowBreakglassApproval) error {
	var count int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM operation_logs
		WHERE domain_code='service_client' AND action=? AND target_type='service_client'
		AND target_key=? AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.caseId'))=?
		AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.tenantCode'))=?
		AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.deploymentCode'))=?
		AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.effectKind'))=?
		AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.effectId'))=?`,
		stage, workflowMaintenanceClient, in.CaseID, in.TenantCode, in.DeploymentCode,
		in.EffectKind, in.EffectID).Scan(&count)
	if err != nil {
		return err
	}
	if count != 1 {
		return errors.New("workflow breakglass prior stage missing or ambiguous")
	}
	return nil
}

func workflowBreakglassExactGrants(ctx context.Context, tx *sql.Tx, clientID uint64, in WorkflowBreakglassApproval) error {
	var matching, total int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_client_grants
		WHERE service_client_id=? AND status='active' AND action='execute'
		AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.source'))='seed:v2.30'
		AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.purpose'))='workflow-controlled-delivery-recovery'
		AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.tenantCode'))=?
		AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.deploymentCode'))=?
		AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.semanticScope'))=?
		AND ((resource_code='data-runtime:workflow:delivery-recovery' AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.audience'))='data-runtime')
		 OR (resource_code='tenant-runtime:workflow:delivery-recovery' AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.audience'))='tenant-runtime'))`,
		clientID, in.TenantCode, in.DeploymentCode, workflowRecoveryScope).Scan(&matching); err != nil {
		return err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_client_grants WHERE service_client_id=?`, clientID).Scan(&total); err != nil {
		return err
	}
	if matching != 2 || total != 2 {
		return errors.New("workflow maintenance exact grants missing or unexpected")
	}
	return nil
}

// PrepareWorkflowBreakglass creates the disabled client and both v2.30 grants
// in one transaction. Existing client/grant rows are never repaired here.
func (a *Adapter) PrepareWorkflowBreakglass(ctx context.Context, in WorkflowBreakglassApproval) error {
	if err := a.checkWorkflowBreakglass(in); err != nil {
		return err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var prior int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM operation_logs
		WHERE domain_code='service_client' AND action='prepare_workflow_breakglass'
		AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.caseId'))=?`, in.CaseID).Scan(&prior); err != nil || prior != 0 {
		return errors.New("workflow breakglass case already prepared")
	}
	var id uint64
	var status, app string
	var current sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT id,status,app_code,current_credential_id FROM service_clients
		WHERE client_code=? FOR UPDATE`, workflowMaintenanceClient).Scan(&id, &status, &app, &current)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == sql.ErrNoRows {
		result, insertErr := tx.ExecContext(ctx, `INSERT INTO service_clients
			(client_code,client_name,client_type,app_code,description,status)
			VALUES (?,'Workflow breakglass recovery','supporting_service','workflow',?,'disabled')`,
			workflowMaintenanceClient, "approval="+in.ApprovalID)
		if insertErr != nil {
			return insertErr
		}
		insertedID, insertErr := result.LastInsertId()
		if insertErr != nil {
			return insertErr
		}
		id = uint64(insertedID)
		for _, audience := range []string{"data-runtime", "tenant-runtime"} {
			_, insertErr = tx.ExecContext(ctx, `INSERT INTO service_client_grants
			(service_client_id,resource_code,action,scope_json,status)
			VALUES (?,?,'execute',JSON_OBJECT('source','seed:v2.30',
			'purpose','workflow-controlled-delivery-recovery','tenantCode',?,
			'deploymentCode',?,'audience',?,'semanticScope',?),'active')`,
				id, audience+":workflow:delivery-recovery", in.TenantCode,
				in.DeploymentCode, audience, workflowRecoveryScope)
			if insertErr != nil {
				return insertErr
			}
		}
	} else if status != "disabled" || app != "workflow" || current.Valid {
		return errors.New("workflow maintenance client is not disabled without credential")
	} else {
		var lastStage string
		if err = tx.QueryRowContext(ctx, `SELECT action FROM operation_logs
			WHERE domain_code='service_client' AND target_key=?
			AND action IN ('prepare_workflow_breakglass','activate_workflow_breakglass','retire_workflow_breakglass')
			ORDER BY id DESC LIMIT 1`, workflowMaintenanceClient).Scan(&lastStage); err != nil || lastStage != "retire_workflow_breakglass" {
			return errors.New("prior workflow breakglass case is not retired")
		}
		if err = workflowBreakglassExactGrants(ctx, tx, id, in); err != nil {
			return err
		}
	}
	if err = workflowBreakglassAudit(ctx, tx, "prepare_workflow_breakglass", in, 0); err != nil {
		return err
	}
	return tx.Commit()
}

// ActivateWorkflowBreakglass creates a short-lived Vault-backed credential.
// writeSecret must atomically create a 0600 file and return a cleanup callback.
// It is called before commit; failures roll the database back and remove the file.
func (a *Adapter) ActivateWorkflowBreakglass(ctx context.Context, in WorkflowBreakglassApproval,
	writeSecret func(clientID, secret string) (func(), error)) (uint64, error) {
	if err := a.checkWorkflowBreakglass(in); err != nil {
		return 0, err
	}
	if writeSecret == nil {
		return 0, errors.New("protected secret file writer required")
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var id uint64
	var status string
	var current sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT id,status,current_credential_id FROM service_clients
		WHERE client_code=? AND app_code='workflow' FOR UPDATE`, workflowMaintenanceClient).Scan(&id, &status, &current)
	if err != nil || status != "disabled" || current.Valid {
		return 0, errors.New("workflow maintenance client is not disabled without credential")
	}
	if err = workflowBreakglassPriorStage(ctx, tx, "prepare_workflow_breakglass", in); err != nil {
		return 0, err
	}
	if err = workflowBreakglassExactGrants(ctx, tx, id, in); err != nil {
		return 0, err
	}
	secretBytes := make([]byte, 32)
	if _, err = rand.Read(secretBytes); err != nil {
		return 0, err
	}
	secret := "hzy_workflow_breakglass_" + base64.RawURLEncoding.EncodeToString(secretBytes)
	material, err := a.encryptVaultPlaintext(secret)
	if err != nil {
		return 0, err
	}
	clientID := fmt.Sprintf("workflow.maintenance.%s", in.CaseID)
	secretCode := fmt.Sprintf("svc.workflow.maintenance.%s", in.CaseID)
	if len(clientID) > 128 || len(secretCode) > 128 || !vaultSecretCodePattern.MatchString(secretCode) {
		return 0, errors.New("workflow breakglass case identifier too long")
	}
	insert, err := tx.ExecContext(ctx, `INSERT INTO vault_secrets
		(secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,
		storage_backend,reveal_policy,masked_preview,expires_at,status,created_by)
		VALUES (?,?,'Workflow breakglass credential','client_secret','service','service_client',?,
		'db_encrypted','never',?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),'active',?)`,
		secretCode, "hzybase://vault/"+secretCode, workflowMaintenanceClient, material.MaskedPreview, in.OperatorID)
	if err != nil {
		return 0, err
	}
	secretID, err := insert.LastInsertId()
	if err != nil {
		return 0, err
	}
	insert, err = tx.ExecContext(ctx, `INSERT INTO vault_secret_versions
		(secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,status,created_by)
		VALUES (?,1,?,?,?,?,'active',?)`, secretID, material.CiphertextBlob,
		material.ContentHash, material.EncryptionScheme, material.KeyFingerprint, in.OperatorID)
	if err != nil {
		return 0, err
	}
	versionID, err := insert.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE vault_secrets SET current_version_id=?,last_rotated_at=UTC_TIMESTAMP() WHERE id=?`, versionID, secretID); err != nil {
		return 0, err
	}
	var nextVersion int
	if err = tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_no),0)+1 FROM service_client_credentials WHERE service_client_id=?`, id).Scan(&nextVersion); err != nil {
		return 0, err
	}
	insert, err = tx.ExecContext(ctx, `INSERT INTO service_client_credentials
		(service_client_id,client_id,version_no,secret_id,expires_at,status)
		VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),'active')`, id, clientID, nextVersion, secretID)
	if err != nil {
		return 0, err
	}
	credentialID, err := insert.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE service_clients SET status='active',current_credential_id=? WHERE id=?`, credentialID, id); err != nil {
		return 0, err
	}
	if err = insertVaultAccessLog(ctx, tx, secretID, versionID, "create", VaultAccessMeta{
		ActorType: "human", ActorID: in.OperatorID, AppCode: "workflow", Reason: in.CaseID,
		ApprovalCode: in.ApprovalID,
	}, "success"); err != nil {
		return 0, err
	}
	cleanup, err := writeSecret(clientID, secret)
	if err != nil {
		return 0, err
	}
	if cleanup == nil {
		return 0, errors.New("protected secret writer omitted cleanup")
	}
	if err = workflowBreakglassAudit(ctx, tx, "activate_workflow_breakglass", in, uint64(credentialID)); err != nil {
		cleanup()
		return 0, err
	}
	if err = tx.Commit(); err != nil {
		cleanup()
		return 0, err
	}
	return uint64(credentialID), nil
}

// RetireWorkflowBreakglass invalidates both the credential and its Vault key.
// Existing service tokens fail Runtime's live credential-state check afterward.
func (a *Adapter) RetireWorkflowBreakglass(ctx context.Context, in WorkflowBreakglassApproval) error {
	if err := a.checkWorkflowBreakglass(in); err != nil {
		return err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var id uint64
	var status string
	var current sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT id,status,current_credential_id FROM service_clients
		WHERE client_code=? AND app_code='workflow' FOR UPDATE`, workflowMaintenanceClient).
		Scan(&id, &status, &current); err != nil {
		return err
	}
	if err = workflowBreakglassPriorStage(ctx, tx, "prepare_workflow_breakglass", in); err != nil {
		return err
	}
	var retired int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM operation_logs WHERE domain_code='service_client'
		AND action='retire_workflow_breakglass' AND target_key=?
		AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.caseId'))=?`, workflowMaintenanceClient, in.CaseID).Scan(&retired); err != nil {
		return err
	}
	clientID := "workflow.maintenance." + in.CaseID
	var credentialID, secretID, versionID sql.NullInt64
	var credentialStatus, secretStatus, versionStatus sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT c.id,c.status,c.secret_id,k.status,v.id,v.status
		FROM service_client_credentials c
		JOIN vault_secrets k ON k.id=c.secret_id
		LEFT JOIN vault_secret_versions v ON v.id=k.current_version_id AND v.secret_id=k.id
		WHERE c.service_client_id=? AND c.client_id=? FOR UPDATE`, id, clientID).
		Scan(&credentialID, &credentialStatus, &secretID, &secretStatus, &versionID, &versionStatus)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if current.Valid && (!credentialID.Valid || current.Int64 != credentialID.Int64) {
		return errors.New("workflow maintenance current credential belongs to another case")
	}
	if retired != 0 {
		if retired != 1 || status != "disabled" || current.Valid ||
			(credentialID.Valid && credentialStatus.String != "revoked") ||
			(secretID.Valid && secretStatus.String != "inactive") ||
			(versionID.Valid && versionStatus.String != "retired") {
			return errors.New("workflow maintenance retirement state inconsistent")
		}
		return tx.Commit()
	}
	if credentialID.Valid {
		if _, err = tx.ExecContext(ctx, `UPDATE service_client_credentials SET status='revoked',expires_at=UTC_TIMESTAMP()
			WHERE id=? AND status<>'revoked'`, credentialID.Int64); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE service_clients SET status='disabled',current_credential_id=NULL WHERE id=?`, id); err != nil {
		return err
	}
	if versionID.Valid {
		if _, err = tx.ExecContext(ctx, `UPDATE vault_secret_versions SET status='retired',retired_at=UTC_TIMESTAMP()
			WHERE id=? AND status<>'retired'`, versionID.Int64); err != nil {
			return err
		}
	}
	if secretID.Valid {
		if _, err = tx.ExecContext(ctx, `UPDATE vault_secrets SET status='inactive' WHERE id=?`, secretID.Int64); err != nil {
			return err
		}
		if versionID.Valid {
			if err = insertVaultAccessLog(ctx, tx, secretID.Int64, versionID.Int64, "deactivate", VaultAccessMeta{
				ActorType: "human", ActorID: in.OperatorID, AppCode: "workflow", Reason: in.CaseID,
				ApprovalCode: in.ApprovalID,
			}, "success"); err != nil {
				return err
			}
		}
	}
	var auditedCredential uint64
	if credentialID.Valid {
		auditedCredential = uint64(credentialID.Int64)
	}
	if err = workflowBreakglassAudit(ctx, tx, "retire_workflow_breakglass", in, auditedCredential); err != nil {
		return err
	}
	return tx.Commit()
}

// WorkflowMaintenanceDiagnostics is a metadata-only view for the trusted
// Workflow delivery status endpoint. It never returns credential material.
func (a *Adapter) WorkflowMaintenanceDiagnostics(ctx context.Context) (map[string]any, error) {
	var status sql.NullString
	var activeSeconds sql.NullInt64
	var unrevoked int64
	err := a.db.QueryRowContext(ctx, `SELECT sc.status,
		CASE WHEN sc.status='active' THEN TIMESTAMPDIFF(SECOND,sc.updated_at,UTC_TIMESTAMP()) ELSE 0 END,
		(SELECT COUNT(*) FROM service_client_credentials c WHERE c.service_client_id=sc.id AND c.status<>'revoked')
		FROM service_clients sc WHERE sc.client_code=? AND sc.app_code='workflow'`,
		workflowMaintenanceClient).Scan(&status, &activeSeconds, &unrevoked)
	if err == sql.ErrNoRows {
		return map[string]any{"activeOver15Minutes": false, "unrevokedCredentialCount": int64(0)}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"activeOver15Minutes":      status.String == "active" && activeSeconds.Int64 > int64((15*time.Minute).Seconds()),
		"unrevokedCredentialCount": unrevoked,
	}, nil
}
