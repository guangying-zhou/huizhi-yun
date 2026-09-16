package console

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type vaultCipherPayload struct {
	Version int    `json:"v"`
	Alg     string `json:"alg"`
	IV      string `json:"iv"`
	Tag     string `json:"tag"`
	Data    string `json:"data"`
}

var vaultEnvRefPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type vaultMaterial struct {
	CiphertextBlob   []byte
	BackendSecretRef any
	ContentHash      string
	EncryptionScheme any
	KeyFingerprint   any
	MaskedPreview    any
}

func (a *Adapter) vaultKey() ([]byte, error) {
	a.vaultKeyMu.RLock()
	configured := strings.TrimSpace(a.vaultMasterKey)
	a.vaultKeyMu.RUnlock()
	if configured == "" {
		return nil, httperror.New(500, "console_vault_key_unavailable", "Console Runtime Vault master key is not configured")
	}
	return normalizeVaultMasterKey(configured), nil
}

func (a *Adapter) encryptVaultPlaintext(plaintext string) (vaultMaterial, error) {
	key, err := a.vaultKey()
	if err != nil {
		return vaultMaterial{}, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return vaultMaterial{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return vaultMaterial{}, err
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(iv); err != nil {
		return vaultMaterial{}, err
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	tagSize := gcm.Overhead()
	payload := vaultCipherPayload{
		Version: 1,
		Alg:     "aes-256-gcm",
		IV:      base64.RawURLEncoding.EncodeToString(iv),
		Tag:     base64.RawURLEncoding.EncodeToString(sealed[len(sealed)-tagSize:]),
		Data:    base64.RawURLEncoding.EncodeToString(sealed[:len(sealed)-tagSize]),
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return vaultMaterial{}, err
	}
	fingerprint := sha256.Sum256(key)
	return vaultMaterial{
		CiphertextBlob:   blob,
		BackendSecretRef: nil,
		ContentHash:      vaultContentHash(plaintext),
		EncryptionScheme: "aes256-gcm",
		KeyFingerprint:   hex.EncodeToString(fingerprint[:])[:32],
		MaskedPreview:    maskVaultValue(plaintext),
	}, nil
}

func (a *Adapter) decryptVaultPlaintext(ciphertext []byte) (string, error) {
	var payload vaultCipherPayload
	if err := json.Unmarshal(ciphertext, &payload); err != nil ||
		payload.Version != 1 || payload.Alg != "aes-256-gcm" {
		return "", httperror.New(500, "console_vault_payload_unsupported", "Unsupported Vault encryption payload")
	}
	key, err := a.vaultKey()
	if err != nil {
		return "", err
	}
	iv, err := base64.RawURLEncoding.DecodeString(payload.IV)
	if err != nil {
		return "", err
	}
	data, err := base64.RawURLEncoding.DecodeString(payload.Data)
	if err != nil {
		return "", err
	}
	tag, err := base64.RawURLEncoding.DecodeString(payload.Tag)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	plaintext, err := gcm.Open(nil, iv, append(data, tag...), nil)
	if err != nil {
		return "", httperror.New(409, "console_vault_decrypt_failed", "Vault material cannot be decrypted with the configured customer key")
	}
	return string(plaintext), nil
}

func normalizeVaultMaterial(storageBackend string, material map[string]any, adapter *Adapter) (vaultMaterial, error) {
	plaintext := strings.TrimSpace(fmt.Sprint(material["plaintext"]))
	if material["plaintext"] == nil || plaintext == "<nil>" {
		plaintext = ""
	}
	backendRef := strings.TrimSpace(fmt.Sprint(material["backendSecretRef"]))
	if material["backendSecretRef"] == nil || backendRef == "<nil>" {
		backendRef = ""
	}
	if storageBackend == "db_encrypted" {
		if plaintext == "" {
			return vaultMaterial{}, httperror.New(400, "console_vault_plaintext_required", "material.plaintext is required for db_encrypted")
		}
		return adapter.encryptVaultPlaintext(plaintext)
	}
	if backendRef == "" {
		return vaultMaterial{}, httperror.New(400, "console_vault_backend_ref_required", "material.backendSecretRef is required")
	}
	if storageBackend == "env_ref" && !vaultEnvRefPattern.MatchString(backendRef) {
		return vaultMaterial{}, httperror.New(400, "console_vault_env_ref_invalid", "env_ref must be an environment variable name")
	}
	return vaultMaterial{
		CiphertextBlob:   nil,
		BackendSecretRef: backendRef,
		ContentHash:      vaultContentHash(backendRef),
		EncryptionScheme: "external_ref",
		KeyFingerprint:   nil,
		MaskedPreview:    storageBackend + ":" + fmt.Sprint(maskVaultValue(backendRef)),
	}, nil
}

func (a *Adapter) resolveVaultMaterial(storageBackend string, ciphertext []byte, backendRef string, contentHash string) (string, error) {
	var value string
	var err error
	if len(ciphertext) > 0 {
		value, err = a.decryptVaultPlaintext(ciphertext)
	} else {
		value, err = resolveVaultBackend(storageBackend, backendRef)
	}
	if err != nil {
		return "", err
	}
	if !vaultContentHashMatches(contentHash, value) &&
		!(backendRef != "" && vaultContentHashMatches(contentHash, backendRef)) {
		return "", httperror.New(409, "console_vault_content_mismatch", "Vault content hash mismatch")
	}
	return value, nil
}

func resolveVaultBackend(storageBackend string, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", httperror.New(409, "console_vault_backend_ref_empty", "Vault backend reference is empty")
	}
	if storageBackend == "env_ref" {
		value := strings.TrimSpace(os.Getenv(ref))
		if value == "" {
			return "", httperror.New(409, "console_vault_env_unavailable", "Environment-backed Vault material is unavailable")
		}
		return value, nil
	}
	path := ref
	if strings.HasPrefix(path, "file://") {
		path = strings.TrimPrefix(path, "file://")
	}
	if storageBackend == "docker_secret" && !filepath.IsAbs(path) {
		path = filepath.Join("/run/secrets", path)
	}
	if !filepath.IsAbs(path) {
		return "", httperror.New(409, "console_vault_file_ref_invalid", "File-backed Vault material requires an absolute path")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(content), "\r\n"), nil
}

func vaultContentHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return "sha256_" + hex.EncodeToString(digest[:])
}

func vaultContentHashMatches(stored string, value string) bool {
	if stored == "" {
		return true
	}
	digest := sha256.Sum256([]byte(value))
	return stored == "sha256_"+hex.EncodeToString(digest[:]) ||
		stored == hex.EncodeToString(digest[:])
}

func maskVaultValue(value string) any {
	if value == "" {
		return nil
	}
	if len(value) <= 8 {
		return "********"
	}
	return value[:4] + "****" + value[len(value)-4:]
}
