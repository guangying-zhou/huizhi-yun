package console

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	workflowapp "github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestWorkflowBreakglassMySQL(t *testing.T) {
	socket := os.Getenv("HZY_WORKFLOW_BREAKGLASS_TEST_SOCKET")
	if !strings.HasPrefix(socket, "/tmp/hzy-test-mysql-") {
		t.Skip("dedicated temporary MySQL required")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.ParseTime = "root", "unix", socket, true
	admin, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_workflow_breakglass_%d", time.Now().UnixNano())
	if _, err = admin.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE `" + name + "`")
	if _, err = admin.Exec("CREATE USER 'hzy_workflow_test'@'127.0.0.1' IDENTIFIED BY 'fixture-only'"); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP USER 'hzy_workflow_test'@'127.0.0.1'")
	if _, err = admin.Exec("GRANT ALL ON `" + name + "`.* TO 'hzy_workflow_test'@'127.0.0.1'"); err != nil {
		t.Fatal(err)
	}
	mc.DBName = name
	conn, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetMaxOpenConns(1)
	raw, err := os.ReadFile("../../../../console/docs/hzy_console_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables := map[string]bool{"auth_signing_keys": true, "service_client_grants": true, "service_clients": true,
		"service_client_credentials": true, "vault_secrets": true, "vault_secret_versions": true,
		"vault_access_logs": true, "operation_logs": true}
	if _, err = conn.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile("(?s)CREATE TABLE IF NOT EXISTS `([^`]+)`.*?;").FindAllStringSubmatch(string(raw), -1) {
		if tables[m[1]] {
			if _, err = conn.Exec(m[0]); err != nil {
				t.Fatal(m[1], err)
			}
		}
	}
	conn.Exec("SET FOREIGN_KEY_CHECKS=1")
	if _, err = conn.Exec("CREATE TABLE org_profiles(singleton_key BIGINT PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec("INSERT INTO org_profiles VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec("ALTER TABLE service_client_grants ADD COLUMN last_used_at DATETIME NULL"); err != nil {
		t.Fatal(err)
	}
	a := NewWithDB(config.ConsoleConfig{VaultMasterKey: "isolated-breakglass-vault-key"}, "C000001", conn)
	ctx := context.Background()
	base := WorkflowBreakglassApproval{CaseID: "incident-1", ApprovalID: "approval-prepare-1",
		ApprovalRecordID: "ticket-123", ApprovalFileSHA256: strings.Repeat("a", 64),
		OperatorID: "operator-1", TenantCode: "C000001", DeploymentCode: "C000001-test-workflow-local",
		EffectKind: "notification", EffectID: "71"}
	if _, err = conn.Exec(`CREATE TRIGGER reject_breakglass_audit BEFORE INSERT ON operation_logs
		FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit failure'`); err != nil {
		t.Fatal(err)
	}
	if err = a.PrepareWorkflowBreakglass(ctx, base); err == nil {
		t.Fatal("prepare accepted audit failure")
	}
	conn.Exec("DROP TRIGGER reject_breakglass_audit")
	var rolledBack int
	if err = conn.QueryRow("SELECT COUNT(*) FROM service_clients").Scan(&rolledBack); err != nil || rolledBack != 0 {
		t.Fatal("prepare did not roll back", rolledBack, err)
	}
	if err = a.PrepareWorkflowBreakglass(ctx, base); err != nil {
		t.Fatal(err)
	}
	maintenance, err := a.WorkflowMaintenanceDiagnostics(ctx)
	if err != nil || maintenance["activeOver15Minutes"] != false || maintenance["unrevokedCredentialCount"] != int64(0) {
		t.Fatal("prepared maintenance diagnostics invalid", maintenance, err)
	}
	var status string
	var grants int
	if err = conn.QueryRow("SELECT status FROM service_clients WHERE client_code='workflow.maintenance'").Scan(&status); err != nil || status != "disabled" {
		t.Fatal(status, err)
	}
	if err = conn.QueryRow("SELECT COUNT(*) FROM service_client_grants").Scan(&grants); err != nil || grants != 2 {
		t.Fatal(grants, err)
	}
	if err = a.PrepareWorkflowBreakglass(ctx, base); err == nil {
		t.Fatal("duplicate preparation accepted")
	}
	active := base
	active.ApprovalID = "approval-activate-1"
	active.ApprovalFileSHA256 = strings.Repeat("b", 64)
	if _, err = conn.Exec(`UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.audience','workflow')
		WHERE resource_code='data-runtime:workflow:delivery-recovery'`); err != nil {
		t.Fatal(err)
	}
	if _, err = a.ActivateWorkflowBreakglass(ctx, active, func(string, string) (func(), error) {
		t.Fatal("writer called for invalid grant")
		return nil, nil
	}); err == nil {
		t.Fatal("mismatched grant audience accepted")
	}
	if _, err = conn.Exec(`UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.audience','data-runtime')
		WHERE resource_code='data-runtime:workflow:delivery-recovery'`); err != nil {
		t.Fatal(err)
	}
	if _, err = a.ActivateWorkflowBreakglass(ctx, active, func(string, string) (func(), error) {
		return nil, errors.New("protected file unavailable")
	}); err == nil {
		t.Fatal("file failure accepted")
	}
	var vaultCount int
	if err = conn.QueryRow("SELECT COUNT(*) FROM vault_secrets").Scan(&vaultCount); err != nil || vaultCount != 0 {
		t.Fatal("failed file write left Vault data", vaultCount, err)
	}
	// An audit failure after the file was written must remove that file and
	// roll back every credential/Vault mutation.
	partialFile := filepath.Join(t.TempDir(), "partial.json")
	if _, err = conn.Exec(`CREATE TRIGGER reject_breakglass_activate BEFORE INSERT ON operation_logs
		FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = a.ActivateWorkflowBreakglass(ctx, active, func(string, string) (func(), error) {
		if writeErr := os.WriteFile(partialFile, []byte("fixture"), 0600); writeErr != nil {
			return nil, writeErr
		}
		return func() { _ = os.Remove(partialFile) }, nil
	}); err == nil {
		t.Fatal("mid-activate audit failure accepted")
	}
	conn.Exec("DROP TRIGGER reject_breakglass_activate")
	if _, err = os.Stat(partialFile); !os.IsNotExist(err) {
		t.Fatal("failed activation left secret file")
	}
	if err = conn.QueryRow("SELECT COUNT(*) FROM vault_secrets").Scan(&vaultCount); err != nil || vaultCount != 0 {
		t.Fatal("mid-activation failure left Vault data", vaultCount, err)
	}
	var clientID, secret string
	secretFile := filepath.Join(t.TempDir(), "credential.json")
	credentialID, err := a.ActivateWorkflowBreakglass(ctx, active, func(id, value string) (func(), error) {
		clientID, secret = id, value
		f, e := os.OpenFile(secretFile, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return nil, e
		}
		payload, _ := json.Marshal(map[string]string{"client_id": id, "client_secret": value})
		_, e = f.Write(payload)
		f.Close()
		return func() { os.Remove(secretFile) }, e
	})
	if err != nil || credentialID == 0 {
		t.Fatal(credentialID, err)
	}
	maintenance, err = a.WorkflowMaintenanceDiagnostics(ctx)
	if err != nil || maintenance["unrevokedCredentialCount"] != int64(1) {
		t.Fatal("active maintenance diagnostics invalid", maintenance, err)
	}
	if _, err = conn.Exec(`UPDATE service_clients SET updated_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 16 MINUTE)
		WHERE client_code='workflow.maintenance'`); err != nil {
		t.Fatal(err)
	}
	maintenance, err = a.WorkflowMaintenanceDiagnostics(ctx)
	if err != nil || maintenance["activeOver15Minutes"] != true {
		t.Fatal("stale active maintenance not detected", maintenance, err)
	}
	if info, e := os.Stat(secretFile); e != nil || info.Mode().Perm() != 0600 {
		t.Fatal("credential file not 0600", e)
	}
	credential := map[string]any{"clientId": clientID, "clientSecret": secret,
		"audience": "data-runtime", "scope": workflowRecoveryScope}
	used, err := a.ConsumeServiceClientCredential(ctx, credential)
	if err != nil || used["credentialId"] != credentialID || used["scope"] != workflowRecoveryScope {
		t.Fatal("credential exchange failed", err)
	}
	a.SetOIDCSigningIssuerSource(func() string { return "https://fixture.invalid" })
	issued, err := a.SignOIDCToken(ctx, map[string]any{"ttlSeconds": 300,
		"claims": map[string]any{"iss": "https://fixture.invalid", "sub": "client:workflow.maintenance",
			"aud": "data-runtime", "azp": clientID, "client_id": clientID,
			"scope": workflowRecoveryScope, "source_app": "workflow", "target_app": "data-runtime",
			"deployment": base.DeploymentCode, "token_use": "service",
			"hzy": map[string]any{"subjectType": "service", "credentialId": int64(credentialID)}},
	}, AuditMutationMeta{ActorID: "fixture-console-token-issuer"})
	if err != nil {
		t.Fatal("Runtime signing refused approved credential", err)
	}
	signed, ok := issued["token"].(string)
	if !ok || signed == "" {
		t.Fatal("Runtime did not issue token")
	}
	var publicJSON string
	if err = conn.QueryRow("SELECT public_jwk_json FROM auth_signing_keys WHERE status='current'").Scan(&publicJSON); err != nil {
		t.Fatal(err)
	}
	var publicJWK oidcSigningJWK
	if err = json.Unmarshal([]byte(publicJSON), &publicJWK); err != nil {
		t.Fatal(err)
	}
	publicBytes, err := base64.RawURLEncoding.DecodeString(publicJWK.X)
	if err != nil {
		t.Fatal(err)
	}
	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(signed, claims, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != "EdDSA" || token.Header["kid"] != publicJWK.Kid {
			return nil, errors.New("unexpected signer")
		}
		return ed25519.PublicKey(publicBytes), nil
	}, jwt.WithIssuer("https://fixture.invalid"), jwt.WithAudience("data-runtime"))
	if err != nil || !parsed.Valid || claims["scope"] != workflowRecoveryScope {
		t.Fatal("issued token claims invalid", err)
	}
	hzyClaims, ok := claims["hzy"].(map[string]any)
	if !ok || hzyClaims["clientCode"] != workflowMaintenanceClient ||
		int64(hzyClaims["credentialId"].(float64)) != int64(credentialID) {
		t.Fatal("issued token service identity invalid")
	}
	state, err := a.VerifyOIDCServiceTokenStateForAudience(ctx, map[string]any{
		"clientId": clientID, "credentialId": credentialID, "scope": workflowRecoveryScope,
	}, "data-runtime")
	if err != nil || state["active"] != true {
		t.Fatal("issued token state rejected", state, err)
	}
	// The credential accepted by the real Console consumer supplies the trusted
	// identity for the owning Workflow recovery handler in the same disposable DB.
	for _, statement := range []string{
		`CREATE TABLE flow_notification_outbox(id BIGINT PRIMARY KEY,idempotency_key VARCHAR(191),
			delivery_status VARCHAR(30),attempt_count INT,version_no INT,next_attempt_at DATETIME NULL,last_attempt_at DATETIME NULL,
			abandoned_at DATETIME NULL,updated_at DATETIME NULL)`,
		`CREATE TABLE flow_delivery_audit(id BIGINT AUTO_INCREMENT PRIMARY KEY,delivery_kind VARCHAR(30),effect_id BIGINT,
			event_code VARCHAR(30),prior_status VARCHAR(30),next_status VARCHAR(30),prior_version_no INT,
			next_version_no INT,attempt_count INT,actor_code VARCHAR(128),reason_code VARCHAR(64),
			tenant_code VARCHAR(64),deployment_code VARCHAR(128),credential_id BIGINT,request_id VARCHAR(128),
			recovery_reason VARCHAR(200))`,
		`INSERT INTO flow_notification_outbox(id,idempotency_key,delivery_status,attempt_count,version_no,updated_at)
			VALUES (71,'workflow:incident-1','abandoned',12,3,UTC_TIMESTAMP())`,
	} {
		if _, err = conn.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	var port int
	if err = conn.QueryRow("SELECT @@port").Scan(&port); err != nil {
		t.Fatal(err)
	}
	workflow, err := workflowapp.New(config.WorkflowConfig{DB: config.DBConfig{
		Host: "127.0.0.1", Port: port, User: "hzy_workflow_test", Password: "fixture-only", Database: name, ConnectionLimit: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	recovery := map[string]any{"hzy_runtime_tenant_code": claims["tenant"],
		"hzy_runtime_deployment_code":   claims["deployment"],
		"hzy_runtime_service_client_id": hzyClaims["clientCode"],
		"hzy_runtime_credential_id":     int64(hzyClaims["credentialId"].(float64)),
		"hzy_runtime_request_id":        "incident-1-recovery", "reason": "approved incident-1 recovery",
		"expectedVersion": int64(3)}
	if _, _, err = workflow.HandleRuntime(ctx, http.MethodPost,
		"/v1/workflow/delivery-effects/notification/71/recover", url.Values{}, recovery); err != nil {
		t.Fatal("approved recovery failed", err)
	}
	var recovered string
	if err = conn.QueryRow("SELECT delivery_status FROM flow_notification_outbox WHERE id=71").Scan(&recovered); err != nil || recovered != "pending" {
		t.Fatal("recovery status invalid", recovered, err)
	}
	var recoveryAudit int
	if err = conn.QueryRow(`SELECT COUNT(*) FROM flow_delivery_audit
		WHERE event_code='recover' AND effect_id=71 AND actor_code='workflow.maintenance'
		AND credential_id=? AND prior_version_no=3 AND next_version_no=4`, credentialID).Scan(&recoveryAudit); err != nil || recoveryAudit != 1 {
		t.Fatal("recovery audit missing", recoveryAudit, err)
	}
	retire := base
	retire.ApprovalID = "approval-retire-1"
	retire.ApprovalFileSHA256 = strings.Repeat("c", 64)
	if _, err = conn.Exec(`CREATE TRIGGER reject_breakglass_retire BEFORE INSERT ON operation_logs
		FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit failure'`); err != nil {
		t.Fatal(err)
	}
	if err = a.RetireWorkflowBreakglass(ctx, retire); err == nil {
		t.Fatal("retire accepted audit failure")
	}
	conn.Exec("DROP TRIGGER reject_breakglass_retire")
	if _, err = a.ConsumeServiceClientCredential(ctx, credential); err != nil {
		t.Fatal("failed retirement changed credential", err)
	}
	if err = a.RetireWorkflowBreakglass(ctx, retire); err != nil {
		t.Fatal(err)
	}
	if err = a.RetireWorkflowBreakglass(ctx, retire); err != nil {
		t.Fatal("retire is not idempotent", err)
	}
	maintenance, err = a.WorkflowMaintenanceDiagnostics(ctx)
	if err != nil || maintenance["activeOver15Minutes"] != false || maintenance["unrevokedCredentialCount"] != int64(0) {
		t.Fatal("retired maintenance diagnostics invalid", maintenance, err)
	}
	if _, err = a.ConsumeServiceClientCredential(ctx, credential); err == nil {
		t.Fatal("revoked credential exchanged again")
	} else {
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != http.StatusUnauthorized {
			t.Fatal("revoked credential did not return 401", err)
		}
	}
	state, err = a.VerifyOIDCServiceTokenStateForAudience(ctx, map[string]any{
		"clientId": clientID, "credentialId": credentialID,
		"scope": workflowRecoveryScope,
	}, "data-runtime")
	if err != nil || state["active"] != false {
		t.Fatal("revoked token remained active", state, err)
	}
	var auditCount int
	if err = conn.QueryRow(`SELECT COUNT(*) FROM operation_logs
		WHERE domain_code='service_client' AND target_key='workflow.maintenance'
		AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.caseId'))='incident-1'`).Scan(&auditCount); err != nil || auditCount != 3 {
		t.Fatal("missing stage audit", auditCount, err)
	}
	for stage, sha := range map[string]string{"prepare_workflow_breakglass": strings.Repeat("a", 64),
		"activate_workflow_breakglass": strings.Repeat("b", 64), "retire_workflow_breakglass": strings.Repeat("c", 64)} {
		var count int
		if err = conn.QueryRow(`SELECT COUNT(*) FROM operation_logs WHERE action=?
			AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.approvalRecordId'))='ticket-123'
			AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.approvalFileSha256'))=?`, stage, sha).Scan(&count); err != nil || count != 1 {
			t.Fatal("approval audit hash missing", stage, count, err)
		}
	}
	var vaultAudit int
	if err = conn.QueryRow(`SELECT COUNT(*) FROM vault_access_logs
		WHERE approval_code IN ('approval-activate-1','approval-retire-1')
		AND action IN ('create','deactivate')`).Scan(&vaultAudit); err != nil || vaultAudit != 2 {
		t.Fatal("missing Vault audit", vaultAudit, err)
	}
	second := base
	second.CaseID, second.ApprovalID = "incident-2", "approval-prepare-2"
	second.EffectID = "72"
	if err = a.PrepareWorkflowBreakglass(ctx, second); err != nil {
		t.Fatal("retired client could not prepare a new case", err)
	}
	if err = conn.QueryRow("SELECT COUNT(*) FROM service_client_grants").Scan(&grants); err != nil || grants != 2 {
		t.Fatal("second case duplicated grants", grants, err)
	}
	secondActivate := second
	secondActivate.ApprovalID = "approval-activate-2"
	if _, err = a.ActivateWorkflowBreakglass(ctx, secondActivate, func(string, string) (func(), error) {
		return nil, errors.New("fixture interrupted activation")
	}); err == nil {
		t.Fatal("interrupted activation accepted")
	}
	secondRetire := second
	secondRetire.ApprovalID = "approval-retire-2"
	if err = a.RetireWorkflowBreakglass(ctx, secondRetire); err != nil {
		t.Fatal("cannot clean interrupted activation", err)
	}
	if err = a.RetireWorkflowBreakglass(ctx, secondRetire); err != nil {
		t.Fatal("interrupted activation retire not idempotent", err)
	}
	_ = os.Remove(secretFile)
}
