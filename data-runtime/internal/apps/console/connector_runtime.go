package console

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const connectorRuntimeEnrollmentTTL = 15 * time.Minute

var connectorRuntimeEnrollmentCode = regexp.MustCompile(`^hzy_cre_[A-Za-z0-9_-]{32,}$`)
var connectorRuntimeCapability = regexp.MustCompile(`^[a-z0-9.-]+@v[0-9]+$`)

type ConnectorRuntimeMutationMeta struct {
	IdempotencyKey string
	RequestID      string
	ActorID        string
}

func (a *Adapter) ConnectorRuntimeMetadata(
	ctx context.Context,
	deploymentCode string,
) (map[string]any, error) {
	deploymentCode = strings.TrimSpace(deploymentCode)
	if deploymentCode == "" {
		return nil, httperror.New(http.StatusForbidden, "connector_runtime_deployment_required", "Console deployment binding is required")
	}
	var connectorID, status string
	var version, lastSeen, lastHeartbeat, startedAt, metricsJSON sql.NullString
	var heartbeatStale int
	err := a.db.QueryRowContext(ctx, `SELECT connector_id,agent_version,status,
		DATE_FORMAT(last_seen_at,'%Y-%m-%dT%H:%i:%s.%fZ'),
		DATE_FORMAT(last_heartbeat_at,'%Y-%m-%dT%H:%i:%s.%fZ'),
		DATE_FORMAT(runtime_started_at,'%Y-%m-%dT%H:%i:%s.%fZ'),
		CAST(metrics_json AS CHAR),
		CASE WHEN status='active' AND last_heartbeat_at IS NOT NULL
		 AND TIMESTAMPDIFF(SECOND,last_heartbeat_at,UTC_TIMESTAMP(3)) > 180
		 THEN 1 ELSE 0 END
		FROM connector_runtime_instances
		WHERE tenant_code=? AND deployment_code=? LIMIT 1`,
		a.tenant, deploymentCode,
	).Scan(&connectorID, &version, &status, &lastSeen, &lastHeartbeat, &startedAt, &metricsJSON, &heartbeatStale)
	if errors.Is(err, sql.ErrNoRows) {
		return map[string]any{"connector": nil}, nil
	}
	if err != nil {
		return nil, err
	}
	var metrics any
	if metricsJSON.Valid {
		var parsed map[string]any
		if json.Unmarshal([]byte(metricsJSON.String), &parsed) == nil {
			metrics = parsed
		}
	}
	return map[string]any{"connector": map[string]any{
		"connectorId":      connectorID,
		"version":          nullableStringValue(version),
		"status":           status,
		"lastSeenAt":       nullableStringValue(lastSeen),
		"lastHeartbeatAt":  nullableStringValue(lastHeartbeat),
		"runtimeStartedAt": nullableStringValue(startedAt),
		"heartbeatStale":   heartbeatStale == 1,
		"metrics":          metrics,
	}}, nil
}

func (a *Adapter) IssueConnectorRuntimeEnrollment(
	ctx context.Context,
	deploymentCode string,
	meta ConnectorRuntimeMutationMeta,
) (map[string]any, error) {
	deploymentCode = strings.TrimSpace(deploymentCode)
	if deploymentCode == "" {
		return nil, httperror.New(http.StatusForbidden, "connector_runtime_deployment_required", "Console deployment binding is required")
	}
	payload := map[string]any{"deploymentCode": deploymentCode}
	session, replay, err := a.beginMutation(
		ctx, "connector-runtime.enrollment.issue", meta.IdempotencyKey,
		meta.RequestID, meta.ActorID, payload,
	)
	if err != nil {
		return nil, err
	}
	if replay != nil {
		return nil, httperror.New(
			http.StatusConflict,
			"connector_runtime_enrollment_secret_not_replayable",
			"Enrollment code is returned once; generate a new command with a new Idempotency-Key",
		)
	}
	defer session.tx.Rollback()

	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return nil, err
	}
	code := "hzy_cre_" + base64.RawURLEncoding.EncodeToString(randomBytes)
	digest := sha256.Sum256([]byte(code))
	enrollmentID := uuid.NewString()
	expiresAt := time.Now().UTC().Add(connectorRuntimeEnrollmentTTL)
	if _, err := session.tx.ExecContext(ctx, `UPDATE connector_runtime_enrollments
		SET status='revoked',updated_at=UTC_TIMESTAMP(3)
		WHERE tenant_code=? AND deployment_code=? AND status='issued'`,
		a.tenant, deploymentCode); err != nil {
		return nil, err
	}
	if _, err := session.tx.ExecContext(ctx, `INSERT INTO connector_runtime_enrollments (
		enrollment_id,enrollment_token_sha256,tenant_code,deployment_code,status,
		expires_at,created_at,updated_at
	) VALUES (?,?,?,?,'issued',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		enrollmentID, hex.EncodeToString(digest[:]), a.tenant, deploymentCode, expiresAt); err != nil {
		return nil, err
	}
	safeResponse := map[string]any{"code": 0, "data": map[string]any{
		"enrollmentId":        enrollmentID,
		"enrollmentCodeLast4": code[len(code)-4:],
		"expiresAt":           expiresAt.Format(time.RFC3339Nano),
	}}
	if err := a.finishMutation(
		ctx, session, "connector_runtime", "issue_enrollment",
		"connector_runtime_enrollment", enrollmentID,
		map[string]any{
			"deploymentCode":      deploymentCode,
			"enrollmentCodeLast4": code[len(code)-4:],
			"expiresAt":           expiresAt.Format(time.RFC3339Nano),
		},
		safeResponse,
	); err != nil {
		return nil, err
	}
	return map[string]any{
		"enrollmentId":        enrollmentID,
		"enrollmentCode":      code,
		"enrollmentCodeLast4": code[len(code)-4:],
		"expiresAt":           expiresAt.Format(time.RFC3339Nano),
	}, nil
}

func (a *Adapter) RedeemConnectorRuntimeEnrollment(
	ctx context.Context,
	deploymentCode string,
	body map[string]any,
) (result map[string]any, err error) {
	code := strings.TrimSpace(fmt.Sprint(body["enrollmentCode"]))
	if !connectorRuntimeEnrollmentCode.MatchString(code) {
		return nil, httperror.New(http.StatusBadRequest, "connector_runtime_enrollment_invalid", "Connector Runtime enrollment code is invalid")
	}
	publicKeyPEM, publicKey, err := validateConnectorRuntimePublicKey(body["publicKeyPem"])
	if err != nil {
		return nil, err
	}
	version := boundedConnectorRuntimeText(body["version"], 64)
	capabilities, err := normalizeConnectorRuntimeCapabilities(body["capabilities"])
	if err != nil {
		return nil, err
	}
	capabilitiesJSON, err := json.Marshal(capabilities)
	if err != nil {
		return nil, err
	}
	clientSecretBytes := make([]byte, 32)
	clientIDBytes := make([]byte, 18)
	if _, err = rand.Read(clientSecretBytes); err != nil {
		return nil, err
	}
	if _, err = rand.Read(clientIDBytes); err != nil {
		return nil, err
	}
	clientSecret := "hzy_cr_" + base64.RawURLEncoding.EncodeToString(clientSecretBytes)
	ciphertext, err := rsa.EncryptOAEP(
		sha256.New(), rand.Reader, publicKey, []byte(clientSecret),
		[]byte("hzy-connector-runtime-enrollment.v1"),
	)
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "connector_runtime_encryption_failed", "Connector Runtime public key cannot encrypt the issued credential")
	}
	clientID := "conn_" + base64.RawURLEncoding.EncodeToString(clientIDBytes)
	connectorID := truncateConnectorRuntimeText("connector-runtime."+deploymentCode, 128)
	clientCode := truncateConnectorRuntimeText(connectorID, 100)
	secretCode := truncateConnectorRuntimeText("svc."+clientCode+".client_secret", 191)
	secretRef := "hzybase://vault/" + secretCode
	secretDigest := sha256.Sum256([]byte(clientSecret))
	secretHash := "sha256_" + hex.EncodeToString(secretDigest[:])
	codeDigest := sha256.Sum256([]byte(code))

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var enrollmentID, tenantCode, boundDeployment, status string
	var expiresAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT enrollment_id,tenant_code,deployment_code,status,expires_at
		FROM connector_runtime_enrollments
		WHERE enrollment_token_sha256=? LIMIT 1 FOR UPDATE`,
		hex.EncodeToString(codeDigest[:]),
	).Scan(&enrollmentID, &tenantCode, &boundDeployment, &status, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "connector_runtime_enrollment_not_found", "Connector Runtime enrollment was not found")
	}
	if err != nil {
		return nil, err
	}
	if status != "issued" {
		return nil, httperror.New(http.StatusConflict, "connector_runtime_enrollment_redeemed", "Connector Runtime enrollment was already redeemed")
	}
	if !expiresAt.After(time.Now().UTC()) {
		return nil, httperror.New(http.StatusGone, "connector_runtime_enrollment_expired", "Connector Runtime enrollment has expired")
	}
	if tenantCode != a.tenant || boundDeployment != deploymentCode {
		return nil, httperror.New(http.StatusForbidden, "connector_runtime_enrollment_binding_mismatch", "Connector Runtime enrollment binding mismatch")
	}
	if _, err = tx.ExecContext(ctx, `UPDATE connector_runtime_enrollments
		SET status='redeemed',redeemed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE enrollment_id=? AND status='issued'`, enrollmentID); err != nil {
		return nil, err
	}
	if err = upsertConnectorRuntimeServiceIdentity(
		ctx, tx, a.tenant, deploymentCode, clientCode, clientID,
		secretCode, secretRef, secretHash, clientSecret,
	); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO connector_runtime_instances (
		connector_id,tenant_code,deployment_code,public_key_pem,capabilities_json,
		agent_version,status,last_seen_at,created_at,updated_at
	) VALUES (?,?,?,?,CAST(? AS JSON),?,'active',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
	ON DUPLICATE KEY UPDATE connector_id=VALUES(connector_id),
		public_key_pem=VALUES(public_key_pem),capabilities_json=VALUES(capabilities_json),
		agent_version=VALUES(agent_version),status='active',revoked_at=NULL,
		last_seen_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)`,
		connectorID, a.tenant, deploymentCode, publicKeyPEM,
		string(capabilitiesJSON), nullableText(version)); err != nil {
		return nil, err
	}
	auditDetail, err := json.Marshal(map[string]any{
		"tenantCode":     a.tenant,
		"deploymentCode": deploymentCode,
		"enrollmentId":   enrollmentID,
		"capabilities":   capabilities,
	})
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO operation_logs (
		domain_code,action,target_type,target_key,actor_type,actor_id,detail_json,created_at
	) VALUES ('connector_runtime','redeem_enrollment','connector_runtime',?,
		'service',?,CAST(? AS JSON),UTC_TIMESTAMP())`,
		connectorID, clientCode, string(auditDetail)); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"clientId":              clientID,
		"encryptedClientSecret": base64.StdEncoding.EncodeToString(ciphertext),
		"connectorId":           connectorID,
		"tenantCode":            a.tenant,
		"deploymentCode":        deploymentCode,
		"audience":              "console",
		"scope":                 "integration_config:view credential_vault:resolve console:connector-runtime:heartbeat console:directory-profiles:sync",
	}, nil
}

func (a *Adapter) RecordConnectorRuntimeHeartbeat(
	ctx context.Context,
	deploymentCode string,
	body map[string]any,
) (map[string]any, error) {
	connectorID := boundedConnectorRuntimeText(body["connectorId"], 128)
	verifiedClientCode := boundedConnectorRuntimeText(body["verifiedClientCode"], 100)
	version := boundedConnectorRuntimeText(body["version"], 64)
	startedAtText := strings.TrimSpace(fmt.Sprint(body["startedAt"]))
	startedAt, err := time.Parse(time.RFC3339, startedAtText)
	if err != nil || connectorID == "" || version == "" {
		return nil, httperror.New(http.StatusBadRequest, "connector_runtime_heartbeat_invalid", "Connector Runtime heartbeat is invalid")
	}
	if verifiedClientCode == "" || verifiedClientCode != truncateConnectorRuntimeText(connectorID, 100) {
		return nil, httperror.New(http.StatusForbidden, "connector_runtime_heartbeat_identity_mismatch", "Connector Runtime heartbeat identity mismatch")
	}
	capabilities, err := normalizeConnectorRuntimeCapabilities(body["capabilities"])
	if err != nil {
		return nil, err
	}
	capabilitiesJSON, _ := json.Marshal(capabilities)
	metrics := normalizeConnectorRuntimeMetrics(body["metrics"])
	metricsJSON, _ := json.Marshal(metrics)

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var status string
	err = tx.QueryRowContext(ctx, `SELECT status FROM connector_runtime_instances
		WHERE connector_id=? AND tenant_code=? AND deployment_code=?
		LIMIT 1 FOR UPDATE`, connectorID, a.tenant, deploymentCode).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "connector_runtime_not_registered", "Connector Runtime instance is not registered")
	}
	if err != nil {
		return nil, err
	}
	if status == "active" {
		if _, err := tx.ExecContext(ctx, `UPDATE connector_runtime_instances
			SET agent_version=?,capabilities_json=CAST(? AS JSON),metrics_json=CAST(? AS JSON),
				runtime_started_at=?,last_heartbeat_at=UTC_TIMESTAMP(3),
				last_seen_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
			WHERE connector_id=? AND status='active'`,
			version, string(capabilitiesJSON), string(metricsJSON), startedAt.UTC(), connectorID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"status": status, "nextHeartbeatSeconds": 60}, nil
}

func (a *Adapter) RevokeConnectorRuntime(
	ctx context.Context,
	deploymentCode string,
	meta ConnectorRuntimeMutationMeta,
) (map[string]any, error) {
	payload := map[string]any{"deploymentCode": deploymentCode}
	session, replay, err := a.beginMutation(
		ctx, "connector-runtime.revoke", meta.IdempotencyKey,
		meta.RequestID, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()
	var connectorID, status string
	err = session.tx.QueryRowContext(ctx, `SELECT connector_id,status
		FROM connector_runtime_instances
		WHERE tenant_code=? AND deployment_code=? LIMIT 1 FOR UPDATE`,
		a.tenant, deploymentCode).Scan(&connectorID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "connector_runtime_not_registered", "Connector Runtime instance is not registered")
	}
	if err != nil {
		return nil, err
	}
	clientCode := truncateConnectorRuntimeText(connectorID, 100)
	statements := []struct {
		query string
		args  []any
	}{
		{`UPDATE connector_runtime_instances SET status='revoked',
			revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3)),updated_at=UTC_TIMESTAMP(3)
			WHERE connector_id=?`, []any{connectorID}},
		{`UPDATE connector_runtime_enrollments SET status='revoked',updated_at=UTC_TIMESTAMP(3)
			WHERE tenant_code=? AND deployment_code=? AND status='issued'`, []any{a.tenant, deploymentCode}},
		{`UPDATE service_client_credentials c INNER JOIN service_clients s
			ON s.id=c.service_client_id SET c.status='retired'
			WHERE s.client_code=? AND c.status='active'`, []any{clientCode}},
		{`UPDATE service_client_grants g INNER JOIN service_clients s
			ON s.id=g.service_client_id SET g.status='revoked',g.updated_at=UTC_TIMESTAMP()
			WHERE s.client_code=? AND g.status='active'`, []any{clientCode}},
		{`UPDATE service_clients SET status='inactive',current_credential_id=NULL,
			updated_at=UTC_TIMESTAMP() WHERE client_code=?`, []any{clientCode}},
	}
	for _, statement := range statements {
		if _, err := session.tx.ExecContext(ctx, statement.query, statement.args...); err != nil {
			return nil, err
		}
	}
	response := map[string]any{"code": 0, "data": map[string]any{
		"connectorId": connectorID,
		"status":      "revoked",
	}}
	if err := a.finishMutation(
		ctx, session, "connector_runtime", "revoke", "connector_runtime",
		connectorID, map[string]any{"deploymentCode": deploymentCode, "previousStatus": status}, response,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func upsertConnectorRuntimeServiceIdentity(
	ctx context.Context,
	tx *sql.Tx,
	tenantCode string,
	deploymentCode string,
	clientCode string,
	clientID string,
	secretCode string,
	secretRef string,
	secretHash string,
	clientSecret string,
) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO service_clients (
		client_code,client_name,client_type,app_code,description,status,created_at,updated_at
	) VALUES (?,'Enterprise Connector Runtime','supporting_service','connector-runtime',
		'Tenant fixed-egress connector identity','active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
	ON DUPLICATE KEY UPDATE client_name=VALUES(client_name),client_type=VALUES(client_type),
		app_code=VALUES(app_code),description=VALUES(description),status='active',
		updated_at=UTC_TIMESTAMP()`, clientCode); err != nil {
		return err
	}
	var serviceClientID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM service_clients
		WHERE client_code=? LIMIT 1 FOR UPDATE`, clientCode).Scan(&serviceClientID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO vault_secrets (
		secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,
		storage_backend,reveal_policy,masked_preview,status,created_by,created_at,updated_at
	) VALUES (?,?,'Connector Runtime Client Secret','client_secret','service',
		'service_client',?,'db_encrypted','never',?,'active','system',UTC_TIMESTAMP(),UTC_TIMESTAMP())
	ON DUPLICATE KEY UPDATE owner_key=VALUES(owner_key),storage_backend='db_encrypted',
		reveal_policy='never',masked_preview=VALUES(masked_preview),status='active',
		updated_at=UTC_TIMESTAMP()`,
		secretCode, secretRef, clientCode, "****"+clientSecret[len(clientSecret)-4:]); err != nil {
		return err
	}
	var secretID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM vault_secrets
		WHERE secret_code=? LIMIT 1 FOR UPDATE`, secretCode).Scan(&secretID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE vault_secret_versions SET status='retired',
		retired_at=COALESCE(retired_at,UTC_TIMESTAMP())
		WHERE secret_id=? AND status='active'`, secretID); err != nil {
		return err
	}
	var nextSecretVersion int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_no),0)+1
		FROM vault_secret_versions WHERE secret_id=? FOR UPDATE`, secretID).Scan(&nextSecretVersion); err != nil {
		return err
	}
	versionResult, err := tx.ExecContext(ctx, `INSERT INTO vault_secret_versions (
		secret_id,version_no,backend_secret_ref,content_hash,encryption_scheme,
		status,activated_at,created_by,created_at
	) VALUES (?,?,'hash-only',?,'sha256-only','active',UTC_TIMESTAMP(),'system',UTC_TIMESTAMP())`,
		secretID, nextSecretVersion, secretHash)
	if err != nil {
		return err
	}
	secretVersionID, err := versionResult.LastInsertId()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE vault_secrets SET current_version_id=?,
		last_rotated_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE id=?`,
		secretVersionID, secretID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE service_client_credentials SET status='retired'
		WHERE service_client_id=? AND status='active'`, serviceClientID); err != nil {
		return err
	}
	var nextCredentialVersion int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_no),0)+1
		FROM service_client_credentials WHERE service_client_id=? FOR UPDATE`,
		serviceClientID).Scan(&nextCredentialVersion); err != nil {
		return err
	}
	credentialResult, err := tx.ExecContext(ctx, `INSERT INTO service_client_credentials (
		service_client_id,client_id,version_no,secret_id,issued_at,status
	) VALUES (?,?,?,?,UTC_TIMESTAMP(),'active')`,
		serviceClientID, clientID, nextCredentialVersion, secretID)
	if err != nil {
		return err
	}
	credentialID, err := credentialResult.LastInsertId()
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE service_clients SET current_credential_id=?,
		updated_at=UTC_TIMESTAMP() WHERE id=?`, credentialID, serviceClientID); err != nil {
		return err
	}
	grants := []struct {
		resource string
		action   string
		usage    []string
	}{
		{"integration_config", "view", nil},
		{"credential_vault", "resolve", []string{"integration"}},
		{"console:connector-runtime", "heartbeat", nil},
		{"console:directory-profiles", "sync", nil},
	}
	for _, grant := range grants {
		scope := map[string]any{
			"source":           "connector-runtime-enrollment",
			"purpose":          "typed-enterprise-connector",
			"tenantCode":       tenantCode,
			"deploymentCode":   deploymentCode,
			"integrationCodes": []string{"wecom.default", "dingtalk.default", "dingtalk.identity"},
		}
		if len(grant.usage) > 0 {
			scope["usageTypes"] = grant.usage
		}
		scopeJSON, err := json.Marshal(scope)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO service_client_grants (
			service_client_id,resource_code,action,scope_json,status,created_at,updated_at
		) VALUES (?,?,?,CAST(? AS JSON),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',
			updated_at=UTC_TIMESTAMP()`,
			serviceClientID, grant.resource, grant.action, string(scopeJSON)); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE service_client_grants
		SET status='revoked',updated_at=UTC_TIMESTAMP()
		WHERE service_client_id=? AND resource_code='connector_runtime'
		 AND action='heartbeat' AND status='active'`, serviceClientID); err != nil {
		return err
	}
	return nil
}

func validateConnectorRuntimePublicKey(value any) (string, *rsa.PublicKey, error) {
	publicKeyPEM := strings.TrimSpace(fmt.Sprint(value))
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return "", nil, httperror.New(http.StatusBadRequest, "connector_runtime_public_key_invalid", "Connector Runtime public key is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsed.(*rsa.PublicKey)
	if err != nil || !ok || publicKey.N.BitLen() < 3072 {
		return "", nil, httperror.New(http.StatusBadRequest, "connector_runtime_public_key_invalid", "Connector Runtime requires an RSA key of at least 3072 bits")
	}
	return publicKeyPEM, publicKey, nil
}

func normalizeConnectorRuntimeCapabilities(value any) ([]string, error) {
	raw, ok := value.([]any)
	if value == nil {
		return []string{}, nil
	}
	if !ok || len(raw) > 64 {
		return nil, httperror.New(http.StatusBadRequest, "connector_runtime_capabilities_invalid", "Connector Runtime capabilities are invalid")
	}
	result := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		capability := strings.TrimSpace(fmt.Sprint(item))
		if !connectorRuntimeCapability.MatchString(capability) {
			return nil, httperror.New(http.StatusBadRequest, "connector_runtime_capabilities_invalid", "Connector Runtime capabilities are invalid")
		}
		if !seen[capability] {
			seen[capability] = true
			result = append(result, capability)
		}
	}
	return result, nil
}

func normalizeConnectorRuntimeMetrics(value any) map[string]any {
	input, _ := value.(map[string]any)
	return map[string]any{
		"available":     input["available"] == true,
		"databaseBytes": boundedConnectorRuntimeCount(input["databaseBytes"]),
		"deliveries": boundedConnectorRuntimeCounts(
			input["deliveries"], []string{"processing", "succeeded", "failed", "partial_unknown"},
		),
		"peopleJobs": boundedConnectorRuntimeCounts(
			input["peopleJobs"], []string{"pending", "running", "success", "failed"},
		),
	}
}

func boundedConnectorRuntimeCounts(value any, allowed []string) map[string]int64 {
	input, _ := value.(map[string]any)
	result := map[string]int64{}
	for _, key := range allowed {
		result[key] = boundedConnectorRuntimeCount(input[key])
	}
	return result
}

func boundedConnectorRuntimeCount(value any) int64 {
	var count int64
	switch typed := value.(type) {
	case float64:
		count = int64(typed)
	case int:
		count = int64(typed)
	case int64:
		count = typed
	default:
		return 0
	}
	if count < 0 || count > 100_000_000 {
		return 0
	}
	return count
}

func boundedConnectorRuntimeText(value any, maximum int) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "<nil>" {
		return ""
	}
	return truncateConnectorRuntimeText(text, maximum)
}

func truncateConnectorRuntimeText(value string, maximum int) string {
	if len(value) <= maximum {
		return value
	}
	return value[:maximum]
}

func nullableStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}
