package console

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
)

// InitialServiceCredential creates no client or grant and never rotates/reactivates.
// Callers must authenticate the local administrative operation and bind the database.
// Secret material stays inside the owning Console adapter.
type InitialServiceCredential struct {
	ClientCode string
	AppCode    string
	ActorID    string
}
type InitialServiceCredentialResult struct {
	Created       bool   `json:"created"`
	CredentialID  uint64 `json:"credentialId"`
	VaultVerified bool   `json:"vaultVerified"`
}

func (a *Adapter) EnsureInitialServiceCredential(ctx context.Context, in InitialServiceCredential) (InitialServiceCredentialResult, error) {
	var out InitialServiceCredentialResult
	if in.ClientCode == "" || in.AppCode == "" || in.ActorID == "" || len(in.ClientCode) > 100 {
		return out, errors.New("initial credential identity required")
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var id uint64
	var app, status string
	var current sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT id,app_code,status,current_credential_id FROM service_clients WHERE client_code=? FOR UPDATE`, in.ClientCode).Scan(&id, &app, &status, &current); err != nil {
		return out, err
	}
	if app != in.AppCode || status != "active" {
		return out, errors.New("service identity inactive or mismatched")
	}
	if current.Valid {
		out, err = a.verifyInitialServiceCredential(ctx, tx, in)
		return out, err
	}
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM service_client_credentials WHERE service_client_id=? OR client_id=?`, id, in.ClientCode).Scan(&count); err != nil {
		return out, err
	}
	if count != 0 {
		return out, errors.New("existing credential cannot be repaired by initial enrollment")
	}
	secretCode := "svc." + in.ClientCode + ".client_secret"
	if !vaultSecretCodePattern.MatchString(secretCode) {
		return out, errors.New("invalid secret identifier")
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM vault_secrets WHERE secret_code=? OR (owner_type='service_client' AND owner_key=?)`, secretCode, in.ClientCode).Scan(&count); err != nil {
		return out, err
	}
	if count != 0 {
		return out, errors.New("existing vault ownership cannot be repaired by initial enrollment")
	}
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return out, err
	}
	material, err := a.encryptVaultPlaintext("hzy_service_" + base64.RawURLEncoding.EncodeToString(raw))
	if err != nil {
		return out, err
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO vault_secrets(secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,storage_backend,reveal_policy,masked_preview,status,created_by) VALUES(?,?,'Initial service credential','client_secret','service','service_client',?,'db_encrypted','never',?,'active',?)`, secretCode, "hzybase://vault/"+secretCode, in.ClientCode, material.MaskedPreview, in.ActorID)
	if err != nil {
		return out, err
	}
	sid, err := result.LastInsertId()
	if err != nil {
		return out, err
	}
	result, err = tx.ExecContext(ctx, `INSERT INTO vault_secret_versions(secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,status,activated_at,created_by) VALUES(?,1,?,?,?,?,'active',UTC_TIMESTAMP(),?)`, sid, material.CiphertextBlob, material.ContentHash, material.EncryptionScheme, material.KeyFingerprint, in.ActorID)
	if err != nil {
		return out, err
	}
	vid, err := result.LastInsertId()
	if err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE vault_secrets SET current_version_id=?,last_rotated_at=UTC_TIMESTAMP() WHERE id=?`, vid, sid); err != nil {
		return out, err
	}
	result, err = tx.ExecContext(ctx, `INSERT INTO service_client_credentials(service_client_id,client_id,version_no,secret_id,issued_at,status) VALUES(?,?,1,?,UTC_TIMESTAMP(),'active')`, id, in.ClientCode, sid)
	if err != nil {
		return out, err
	}
	cid, err := result.LastInsertId()
	if err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE service_clients SET current_credential_id=?,updated_at=UTC_TIMESTAMP() WHERE id=?`, cid, id); err != nil {
		return out, err
	}
	if err = insertVaultAccessLog(ctx, tx, sid, vid, "create", VaultAccessMeta{ActorType: "system", ActorID: in.ActorID, AppCode: in.AppCode, Reason: "initial service credential enrollment"}, "success"); err != nil {
		return out, err
	}
	out, err = a.verifyInitialServiceCredential(ctx, tx, in)
	if err != nil {
		return out, err
	}
	out.Created = true
	return out, tx.Commit()
}

// VerifyInitialServiceCredential performs only SELECTs; no last-used/audit mutation.
func (a *Adapter) VerifyInitialServiceCredential(ctx context.Context, in InitialServiceCredential) (InitialServiceCredentialResult, error) {
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return InitialServiceCredentialResult{}, err
	}
	defer tx.Rollback()
	out, err := a.verifyInitialServiceCredential(ctx, tx, in)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (a *Adapter) verifyInitialServiceCredential(ctx context.Context, tx *sql.Tx, in InitialServiceCredential) (InitialServiceCredentialResult, error) {
	var out InitialServiceCredentialResult
	var ciphertext []byte
	var hash string
	err := tx.QueryRowContext(ctx, `SELECT c.id,v.ciphertext_blob,v.content_hash FROM service_clients s JOIN service_client_credentials c ON c.id=s.current_credential_id AND c.service_client_id=s.id JOIN vault_secrets k ON k.id=c.secret_id JOIN vault_secret_versions v ON v.id=k.current_version_id AND v.secret_id=k.id WHERE s.client_code=? AND s.app_code=? AND s.status='active' AND c.client_id=? AND c.status='active' AND (c.expires_at IS NULL OR c.expires_at>UTC_TIMESTAMP()) AND k.owner_type='service_client' AND k.owner_key=s.client_code AND k.usage_type='service' AND k.secret_type='client_secret' AND k.storage_backend='db_encrypted' AND k.reveal_policy='never' AND k.status='active' AND (k.expires_at IS NULL OR k.expires_at>UTC_TIMESTAMP()) AND v.status='active' AND v.encryption_scheme='aes256-gcm'`, in.ClientCode, in.AppCode, in.ClientCode).Scan(&out.CredentialID, &ciphertext, &hash)
	if err != nil {
		return out, err
	}
	plaintext, err := a.decryptVaultPlaintext(ciphertext)
	if err != nil {
		return out, err
	}
	if plaintext == "" || subtle.ConstantTimeCompare([]byte(vaultContentHash(plaintext)), []byte(hash)) != 1 {
		return out, errors.New("vault material integrity failed")
	}
	out.VaultVerified = true
	return out, nil
}
