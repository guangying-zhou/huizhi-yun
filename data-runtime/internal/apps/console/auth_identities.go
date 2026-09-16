package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type authIdentityRecord struct {
	ID               uint64
	UID              string
	ProviderCode     string
	ProviderSubject  string
	ProviderUsername sql.NullString
}

func (a *Adapter) ResolveOrBindAuthIdentity(
	ctx context.Context,
	body map[string]any,
	meta AuditMutationMeta,
) (map[string]any, error) {
	providerCode, err := requiredAuditCode(strings.ToLower(stringField(body["providerCode"])), "providerCode")
	if err != nil {
		return nil, err
	}
	providerSubject, err := requiredAuthString(body["providerSubject"], "provider_subject", 191)
	if err != nil {
		return nil, err
	}
	providerUsername := nullableLimitedString(body["providerUsername"], 191)
	email := nullableLimitedString(body["email"], 191)
	mobileTail4 := nullableLimitedString(body["mobileTail4"], 4)
	profileJSON, err := authIdentityProfileJSON(body["profile"])
	if err != nil {
		return nil, err
	}
	uidCandidates, err := authIdentityUIDCandidates(body["uidCandidates"], providerSubject)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"providerCode": providerCode, "providerSubject": providerSubject,
		"providerUsername": providerUsername, "email": email, "mobileTail4": mobileTail4,
		"uidCandidates": uidCandidates, "profile": json.RawMessage(profileJSON),
	}
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.identity.resolve_or_bind", meta.IdempotencyKey, meta.RequestID,
		meta.ActorType, meta.ActorID, payload,
	)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()

	var identityStatus sql.NullString
	var userStatus sql.NullString
	err = session.tx.QueryRowContext(ctx, `
		SELECT di.status,u.status
		FROM directory_identities di
		LEFT JOIN directory_users u ON u.uid=di.uid
		WHERE di.provider_code=? AND di.provider_subject=?
		LIMIT 1
	`, providerCode, providerSubject).Scan(&identityStatus, &userStatus)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if err == nil && (identityStatus.String != "active" || userStatus.String != "active") {
		return nil, httperror.New(http.StatusForbidden, "directory_identity_inactive", "Directory identity or user is inactive")
	}

	identity, err := findActiveAuthIdentity(ctx, session.tx, providerCode, providerSubject)
	if err != nil {
		return nil, err
	}
	if identity == nil {
		uid, err := resolveActiveAuthIdentityUser(ctx, session.tx, email, uidCandidates)
		if err != nil {
			return nil, err
		}
		existing, err := findAuthIdentityByUIDProvider(ctx, session.tx, uid, providerCode)
		if err != nil {
			return nil, err
		}
		if existing != nil && existing.ProviderSubject != providerSubject {
			return nil, httperror.New(http.StatusConflict, "directory_identity_provider_conflict", "Directory user already has a different identity for this provider")
		}
		if existing == nil {
			if _, err := session.tx.ExecContext(ctx, `
				INSERT INTO directory_identities (
					uid,provider_code,provider_subject,provider_username,email,mobile_tail4,
					profile_json,last_login_at,status,created_at,updated_at
				) VALUES (?,?,?,?,?,?,CAST(? AS JSON),UTC_TIMESTAMP(),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
				ON DUPLICATE KEY UPDATE
					uid=VALUES(uid),provider_username=VALUES(provider_username),
					email=VALUES(email),mobile_tail4=VALUES(mobile_tail4),
					profile_json=VALUES(profile_json),last_login_at=UTC_TIMESTAMP(),
					updated_at=UTC_TIMESTAMP()
			`, uid, providerCode, providerSubject, providerUsername, email, mobileTail4, profileJSON); err != nil {
				return nil, err
			}
		} else {
			if _, err := session.tx.ExecContext(ctx, `
				UPDATE directory_identities
				SET last_login_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
				WHERE id=?
			`, existing.ID); err != nil {
				return nil, err
			}
		}
		identity, err = findActiveAuthIdentity(ctx, session.tx, providerCode, providerSubject)
		if err != nil {
			return nil, err
		}
		if identity == nil {
			return nil, httperror.New(http.StatusInternalServerError, "directory_identity_bind_failed", "Directory identity could not be bound")
		}
	} else {
		if _, err := session.tx.ExecContext(ctx, `
			UPDATE directory_identities
			SET last_login_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
			WHERE id=?
		`, identity.ID); err != nil {
			return nil, err
		}
	}

	response := map[string]any{
		"identityId": identity.ID, "uid": identity.UID,
		"providerCode": identity.ProviderCode, "providerSubject": identity.ProviderSubject,
	}
	if err := a.finishMutation(
		ctx, session, "console", "auth.identity.resolve_or_bind", "directory_identity",
		authIdentityFingerprint(providerCode, providerSubject),
		map[string]any{"providerCode": providerCode, "uid": identity.UID},
		response,
	); err != nil {
		return nil, err
	}
	return response, nil
}

func findActiveAuthIdentity(
	ctx context.Context,
	tx *sql.Tx,
	providerCode string,
	providerSubject string,
) (*authIdentityRecord, error) {
	var record authIdentityRecord
	err := tx.QueryRowContext(ctx, `
		SELECT di.id,di.uid,di.provider_code,di.provider_subject,di.provider_username
		FROM directory_identities di
		INNER JOIN directory_users u ON u.uid=di.uid AND u.status='active'
		WHERE di.provider_code=? AND di.provider_subject=? AND di.status='active'
		LIMIT 1
	`, providerCode, providerSubject).Scan(
		&record.ID, &record.UID, &record.ProviderCode, &record.ProviderSubject, &record.ProviderUsername,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &record, err
}

func findAuthIdentityByUIDProvider(
	ctx context.Context,
	tx *sql.Tx,
	uid string,
	providerCode string,
) (*authIdentityRecord, error) {
	var record authIdentityRecord
	err := tx.QueryRowContext(ctx, `
		SELECT id,uid,provider_code,provider_subject,provider_username
		FROM directory_identities
		WHERE uid=? AND provider_code=? AND status='active'
		LIMIT 1
	`, uid, providerCode).Scan(
		&record.ID, &record.UID, &record.ProviderCode, &record.ProviderSubject, &record.ProviderUsername,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &record, err
}

func resolveActiveAuthIdentityUser(
	ctx context.Context,
	tx *sql.Tx,
	email *string,
	uidCandidates []string,
) (string, error) {
	if email != nil {
		var uid string
		err := tx.QueryRowContext(ctx, `
			SELECT uid FROM directory_users
			WHERE LOWER(email)=LOWER(?) AND status='active'
			ORDER BY id ASC LIMIT 1
		`, *email).Scan(&uid)
		if err == nil {
			return uid, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	for _, candidate := range uidCandidates {
		var uid string
		err := tx.QueryRowContext(ctx, `
			SELECT uid FROM directory_users
			WHERE uid=? AND status='active'
			LIMIT 1
		`, candidate).Scan(&uid)
		if err == nil {
			return uid, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
	}
	return "", httperror.New(http.StatusForbidden, "directory_identity_user_not_found", "No active directory user matches the external identity")
}

func authIdentityProfileJSON(value any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	profile, ok := value.(map[string]any)
	if !ok {
		return "", httperror.New(http.StatusBadRequest, "directory_identity_profile_invalid", "profile must be an object")
	}
	encoded, err := json.Marshal(profile)
	if err != nil || len(encoded) > 16*1024 {
		return "", httperror.New(http.StatusBadRequest, "directory_identity_profile_invalid", "profile is invalid or too large")
	}
	return string(encoded), nil
}

func authIdentityUIDCandidates(value any, providerSubject string) ([]string, error) {
	raw, ok := value.([]any)
	if value != nil && !ok {
		return nil, httperror.New(http.StatusBadRequest, "directory_identity_candidates_invalid", "uidCandidates must be an array")
	}
	candidates := make([]string, 0, len(raw)+2)
	seen := map[string]bool{}
	add := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || len(candidate) > 64 || seen[candidate] {
			return
		}
		seen[candidate] = true
		candidates = append(candidates, candidate)
	}
	for _, item := range raw {
		if item == nil {
			continue
		}
		add(fmt.Sprint(item))
		if len(candidates) > 10 {
			return nil, httperror.New(http.StatusBadRequest, "directory_identity_candidates_invalid", "uidCandidates accepts at most 10 values")
		}
	}
	add(providerSubject)
	add(strings.ToLower(providerSubject))
	return candidates, nil
}

func authIdentityFingerprint(providerCode string, providerSubject string) string {
	digest := sha256.Sum256([]byte(providerCode + "\x00" + providerSubject))
	return providerCode + ":sha256_" + hex.EncodeToString(digest[:8])
}
