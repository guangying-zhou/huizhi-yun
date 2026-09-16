package server

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var consoleVaultBootstrapJTI = regexp.MustCompile(`^[a-fA-F0-9-]{36}$`)

type consoleVaultBootstrapPayload struct {
	JTI                       string `json:"jti"`
	TenantCode                string `json:"tenantCode"`
	DeploymentCode            string `json:"deploymentCode"`
	RuntimeCode               string `json:"runtimeCode"`
	VaultMasterKey            string `json:"vaultMasterKey"`
	VaultMasterKeyFingerprint string `json:"vaultMasterKeyFingerprint"`
	IssuedAt                  string `json:"issuedAt"`
	ExpiresAt                 string `json:"expiresAt"`
}

func (s *Server) bootstrapConsoleVaultMasterKey(body map[string]any) (map[string]any, error) {
	adapter, err := s.requireConsole()
	if err != nil {
		return nil, err
	}
	s.vaultBootstrapMu.Lock()
	defer s.vaultBootstrapMu.Unlock()

	schemaVersion := strings.TrimSpace(stringValue(body["schemaVersion"]))
	payloadEncoded := strings.TrimSpace(stringValue(body["payload"]))
	signatureEncoded := strings.TrimSpace(stringValue(body["signature"]))
	kid := strings.TrimSpace(stringValue(body["kid"]))
	alg := strings.TrimSpace(stringValue(body["alg"]))
	if schemaVersion != "console-vault-bootstrap.v1" || payloadEncoded == "" ||
		signatureEncoded == "" || kid == "" || alg != "Ed25519" {
		return nil, httperror.New(http.StatusBadRequest, "console_vault_bootstrap_envelope_invalid", "Console Vault bootstrap envelope is invalid")
	}
	if kid != strings.TrimSpace(s.cfg.Control.PlatformSigningKeyID) {
		return nil, httperror.New(http.StatusForbidden, "console_vault_bootstrap_kid_mismatch", "Console Vault bootstrap signing key does not match this Runtime")
	}
	publicKey, err := parseConsoleVaultBootstrapPublicKey(s.cfg.Control.PlatformSigningPublicKey)
	if err != nil {
		return nil, err
	}
	payloadBytes, decodeErr := base64.RawURLEncoding.DecodeString(payloadEncoded)
	signature, signatureErr := base64.RawURLEncoding.DecodeString(signatureEncoded)
	if decodeErr != nil || signatureErr != nil || !ed25519.Verify(publicKey, payloadBytes, signature) {
		return nil, httperror.New(http.StatusForbidden, "console_vault_bootstrap_signature_invalid", "Console Vault bootstrap signature is invalid")
	}

	var payload consoleVaultBootstrapPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "console_vault_bootstrap_payload_invalid", "Console Vault bootstrap payload is invalid")
	}
	now := time.Now().UTC()
	issuedAt, issuedErr := time.Parse(time.RFC3339, strings.TrimSpace(payload.IssuedAt))
	expiresAt, expiryErr := time.Parse(time.RFC3339, strings.TrimSpace(payload.ExpiresAt))
	if issuedErr != nil || expiryErr != nil || expiresAt.Before(now) {
		return nil, httperror.New(http.StatusGone, "console_vault_bootstrap_expired", "Console Vault bootstrap envelope has expired")
	}
	if issuedAt.After(now.Add(2*time.Minute)) || !expiresAt.After(issuedAt) ||
		expiresAt.Sub(issuedAt) > 15*time.Minute {
		return nil, httperror.New(http.StatusForbidden, "console_vault_bootstrap_time_invalid", "Console Vault bootstrap validity window is invalid")
	}
	if !consoleVaultBootstrapJTI.MatchString(payload.JTI) {
		return nil, httperror.New(http.StatusBadRequest, "console_vault_bootstrap_jti_invalid", "Console Vault bootstrap jti is invalid")
	}
	if strings.TrimSpace(payload.TenantCode) != strings.TrimSpace(s.cfg.Tenant) ||
		strings.TrimSpace(payload.DeploymentCode) != strings.TrimSpace(s.cfg.DeploymentForApp("console")) ||
		strings.TrimSpace(payload.RuntimeCode) != strings.TrimSpace(s.cfg.Control.RuntimeCode) {
		return nil, httperror.New(http.StatusForbidden, "console_vault_bootstrap_binding_mismatch", "Console Vault bootstrap binding does not match this Runtime")
	}
	key := strings.TrimSpace(payload.VaultMasterKey)
	if key == "" {
		return nil, httperror.New(http.StatusBadRequest, "console_vault_bootstrap_key_required", "Console Vault master key is required")
	}
	fingerprint := consoleapp.VaultMasterKeyFingerprint(key)
	if fingerprint != strings.TrimSpace(payload.VaultMasterKeyFingerprint) {
		return nil, httperror.New(http.StatusForbidden, "console_vault_bootstrap_fingerprint_mismatch", "Console Vault bootstrap key fingerprint does not match")
	}

	alreadyConfigured := adapter.VaultMasterKeyConfigured()
	installedFingerprint, err := adapter.InstallVaultMasterKey(key)
	if err != nil {
		return nil, err
	}
	if err := writeConsoleVaultMasterKeyOnce(s.cfg.Apps.Console.VaultMasterKeyFile, key, installedFingerprint); err != nil {
		return nil, err
	}
	status := "imported"
	if alreadyConfigured {
		status = "already_present"
	}
	return map[string]any{
		"status":                    status,
		"tenantCode":                s.cfg.Tenant,
		"deploymentCode":            s.cfg.DeploymentForApp("console"),
		"runtimeCode":               s.cfg.Control.RuntimeCode,
		"vaultMasterKeyFingerprint": installedFingerprint,
	}, nil
}

func parseConsoleVaultBootstrapPublicKey(value string) (ed25519.PublicKey, error) {
	block, _ := pem.Decode([]byte(strings.ReplaceAll(strings.TrimSpace(value), `\n`, "\n")))
	if block == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_vault_bootstrap_signing_key_invalid", "Tenant Runtime Platform signing key is invalid")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	publicKey, ok := parsed.(ed25519.PublicKey)
	if err != nil || !ok {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_vault_bootstrap_signing_key_invalid", "Tenant Runtime Platform signing key is invalid")
	}
	return publicKey, nil
}

func writeConsoleVaultMasterKeyOnce(path string, key string, fingerprint string) error {
	path = strings.TrimSpace(path)
	if path == "" || !filepath.IsAbs(path) {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_path_invalid", "Console Vault master key file path is invalid")
	}
	if content, err := os.ReadFile(path); err == nil {
		if consoleapp.VaultMasterKeyFingerprint(strings.TrimSpace(string(content))) != fingerprint {
			return httperror.New(http.StatusConflict, "console_vault_bootstrap_file_conflict", "Console Vault master key file already contains different key material")
		}
		return nil
	} else if !os.IsNotExist(err) {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_unreadable", "Console Vault master key file cannot be read")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key directory cannot be prepared")
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".console-vault-master-key-*")
	if err != nil {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key file cannot be prepared")
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0600); err != nil {
		_ = temporary.Close()
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key file cannot be secured")
	}
	if _, err := temporary.WriteString(strings.TrimSpace(key) + "\n"); err != nil {
		_ = temporary.Close()
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key file cannot be written")
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key file cannot be synchronized")
	}
	if err := temporary.Close(); err != nil {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key file cannot be closed")
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key file cannot be installed")
	}
	if err := os.Chmod(path, 0600); err != nil {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key file cannot be secured")
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key directory cannot be opened")
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return httperror.New(http.StatusInternalServerError, "console_vault_bootstrap_file_failed", "Console Vault master key directory cannot be synchronized")
	}
	return nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}
