package directory

import (
	"context"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var connectorEnrollmentJTI = regexp.MustCompile(`^[a-fA-F0-9-]{36}$`)
var connectorCapability = regexp.MustCompile(`^[a-z][a-z0-9.-]{1,63}$`)

type signedConnectorEnrollment struct {
	SchemaVersion string          `json:"schemaVersion"`
	Payload       json.RawMessage `json:"payload"`
	Signature     string          `json:"signature"`
	Kid           string          `json:"kid"`
	Alg           string          `json:"alg"`
}

type connectorEnrollmentPayload struct {
	JTI            string `json:"jti"`
	TenantCode     string `json:"tenantCode"`
	DeploymentCode string `json:"deploymentCode"`
	RuntimeCode    string `json:"runtimeCode"`
	IssuedAt       string `json:"issuedAt"`
	ExpiresAt      string `json:"expiresAt"`
}

func (a *Adapter) RedeemConnectorEnrollment(
	ctx context.Context,
	body map[string]any,
	expectedTenant string,
	expectedDeployment string,
	signingKeyID string,
	signingPublicKey string,
) (result map[string]any, err error) {
	tokenText := strings.TrimSpace(fmt.Sprint(body["enrollmentToken"]))
	if body["enrollmentToken"] == nil || tokenText == "" || tokenText == "<nil>" {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_enrollment_token_required", "Directory Connector enrollment token is required")
	}
	var token signedConnectorEnrollment
	if err = json.Unmarshal([]byte(tokenText), &token); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_enrollment_token_invalid", "Directory Connector enrollment token is invalid")
	}
	if token.SchemaVersion != "directory-connector-enrollment.v1" ||
		token.Alg != "Ed25519" || token.Kid == "" || token.Signature == "" ||
		len(token.Payload) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_enrollment_token_invalid", "Directory Connector enrollment token is invalid")
	}
	if strings.TrimSpace(signingKeyID) == "" || strings.TrimSpace(signingPublicKey) == "" {
		return nil, httperror.New(http.StatusServiceUnavailable, "directory_connector_enrollment_signing_key_unavailable", "Tenant Runtime Platform signing key is not configured")
	}
	if token.Kid != strings.TrimSpace(signingKeyID) {
		return nil, httperror.New(http.StatusForbidden, "directory_connector_enrollment_kid_mismatch", "Directory Connector enrollment signing key does not match this Runtime")
	}
	publicKey, keyErr := parseConnectorEnrollmentSigningKey(signingPublicKey)
	if keyErr != nil {
		return nil, keyErr
	}
	signature, decodeErr := base64.RawURLEncoding.DecodeString(token.Signature)
	if decodeErr != nil || !ed25519.Verify(publicKey, token.Payload, signature) {
		return nil, httperror.New(http.StatusForbidden, "directory_connector_enrollment_signature_invalid", "Directory Connector enrollment signature is invalid")
	}
	var payload connectorEnrollmentPayload
	if err = json.Unmarshal(token.Payload, &payload); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_enrollment_payload_invalid", "Directory Connector enrollment payload is invalid")
	}
	now := time.Now().UTC()
	issuedAt, issuedErr := time.Parse(time.RFC3339, strings.TrimSpace(payload.IssuedAt))
	expiresAt, expiryErr := time.Parse(time.RFC3339, strings.TrimSpace(payload.ExpiresAt))
	if issuedErr != nil || expiryErr != nil || expiresAt.Before(now) {
		return nil, httperror.New(http.StatusGone, "directory_connector_enrollment_expired", "Directory Connector enrollment token has expired")
	}
	if issuedAt.After(now.Add(5*time.Minute)) || !expiresAt.After(issuedAt) ||
		expiresAt.Sub(issuedAt) > 24*time.Hour {
		return nil, httperror.New(http.StatusForbidden, "directory_connector_enrollment_time_invalid", "Directory Connector enrollment validity window is invalid")
	}
	expectedTenant = strings.TrimSpace(expectedTenant)
	expectedDeployment = strings.TrimSpace(expectedDeployment)
	if payload.TenantCode != expectedTenant || payload.DeploymentCode != expectedDeployment {
		return nil, httperror.New(http.StatusForbidden, "directory_connector_enrollment_binding_mismatch", "Directory Connector enrollment binding does not match this Runtime")
	}
	if !connectorEnrollmentJTI.MatchString(payload.JTI) {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_enrollment_jti_invalid", "Directory Connector enrollment jti is invalid")
	}
	publicKeyPEM, err := validateEnrolledConnectorPublicKey(body["publicKeyPem"])
	if err != nil {
		return nil, err
	}
	version := strings.TrimSpace(fmt.Sprint(body["version"]))
	if body["version"] == nil || version == "<nil>" {
		version = ""
	}
	if len(version) > 64 {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_version_invalid", "Directory Connector version is invalid")
	}
	capabilities, err := normalizeConnectorCapabilities(body["capabilities"])
	if err != nil {
		return nil, err
	}
	capabilitiesJSON, err := json.Marshal(capabilities)
	if err != nil {
		return nil, err
	}
	connectorID := "directory-connector." + expectedDeployment
	if len(connectorID) > 100 {
		connectorID = connectorID[:100]
	}

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	enrollment, err := tx.ExecContext(ctx, `INSERT IGNORE INTO directory_connector_enrollments (
		enrollment_jti,tenant_code,deployment_code,status,expires_at,redeemed_at,created_at,updated_at
	) VALUES (?,?,?,'redeemed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		payload.JTI, expectedTenant, expectedDeployment, expiresAt.UTC())
	if err != nil {
		return nil, err
	}
	affected, err := enrollment.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "directory_connector_enrollment_replayed", "Directory Connector enrollment token was already redeemed")
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO directory_connectors (
		connector_id,tenant_code,deployment_code,public_key_pem,capabilities_json,
		agent_version,status,last_seen_at,created_at,updated_at
	) VALUES (?,?,?,?,CAST(? AS JSON),?,'active',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
	ON DUPLICATE KEY UPDATE
		tenant_code=VALUES(tenant_code),deployment_code=VALUES(deployment_code),
		public_key_pem=VALUES(public_key_pem),capabilities_json=VALUES(capabilities_json),
		agent_version=VALUES(agent_version),status='active',
		last_seen_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)`,
		connectorID, expectedTenant, expectedDeployment, publicKeyPEM,
		string(capabilitiesJSON), nullableConnectorEnrollmentText(version)); err != nil {
		return nil, err
	}
	detail, err := json.Marshal(map[string]any{
		"enrollmentJti": payload.JTI, "tenantCode": expectedTenant,
		"deploymentCode": expectedDeployment, "runtimeCode": payload.RuntimeCode,
		"capabilities": capabilities,
	})
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO operation_logs (
		domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at
	) VALUES ('directory','enroll_connector','directory_connector',?,'system',
		'platform-enrollment',NULL,CAST(? AS JSON),UTC_TIMESTAMP())`,
		connectorID, string(detail)); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"connectorId": connectorID, "tenantCode": expectedTenant,
		"deploymentCode": expectedDeployment,
		"transport":      "tenant-runtime-loopback-signature",
	}, nil
}

func parseConnectorEnrollmentSigningKey(value string) (ed25519.PublicKey, error) {
	block, _ := pem.Decode([]byte(strings.ReplaceAll(value, `\n`, "\n")))
	if block == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "directory_connector_enrollment_signing_key_invalid", "Tenant Runtime Platform signing key is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsed.(ed25519.PublicKey)
	if err != nil || !ok {
		return nil, httperror.New(http.StatusServiceUnavailable, "directory_connector_enrollment_signing_key_invalid", "Tenant Runtime Platform signing key is invalid")
	}
	return publicKey, nil
}

func validateEnrolledConnectorPublicKey(value any) (string, error) {
	publicKeyPEM := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || publicKeyPEM == "" || publicKeyPEM == "<nil>" {
		return "", httperror.New(http.StatusBadRequest, "directory_connector_public_key_required", "Directory Connector public key is required")
	}
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return "", httperror.New(http.StatusBadRequest, "directory_connector_public_key_invalid", "Directory Connector public key is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsed.(*rsa.PublicKey)
	if err != nil || !ok || publicKey.N.BitLen() < 3072 {
		return "", httperror.New(http.StatusBadRequest, "directory_connector_public_key_invalid", "Directory Connector requires an RSA key of at least 3072 bits")
	}
	return publicKeyPEM, nil
}

func normalizeConnectorCapabilities(value any) ([]string, error) {
	raw, ok := value.([]any)
	if value == nil {
		return []string{}, nil
	}
	if !ok || len(raw) > 32 {
		return nil, httperror.New(http.StatusBadRequest, "directory_connector_capabilities_invalid", "Directory Connector capabilities are invalid")
	}
	capabilities := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		capability := strings.TrimSpace(fmt.Sprint(item))
		if !connectorCapability.MatchString(capability) {
			return nil, httperror.New(http.StatusBadRequest, "directory_connector_capabilities_invalid", "Directory Connector capabilities are invalid")
		}
		if !seen[capability] {
			seen[capability] = true
			capabilities = append(capabilities, capability)
		}
	}
	return capabilities, nil
}

func nullableConnectorEnrollmentText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
