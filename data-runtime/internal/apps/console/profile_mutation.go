package console

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const profileUpdateOperation = "console.profile.update"

var mutationIdempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}$`)
var newMutationReceiptID = randomUUID

type UpdateProfileInput struct {
	Body           map[string]any
	IdempotencyKey string
	RequestID      string
	ActorID        string
}

type profileMutation struct {
	ExpectedRevision        uint64  `json:"expectedRevision"`
	OrgName                 string  `json:"orgName"`
	OrgShortName            *string `json:"orgShortName"`
	DisplayName             *string `json:"displayName"`
	LegalName               *string `json:"legalName"`
	UnifiedSocialCreditCode *string `json:"unifiedSocialCreditCode"`
	LogoPath                *string `json:"logoPath"`
	WebsiteURL              *string `json:"websiteUrl"`
	IndustryCode            *string `json:"industryCode"`
	CountryCode             string  `json:"countryCode"`
	Timezone                string  `json:"timezone"`
	Locale                  string  `json:"locale"`
	CurrencyCode            string  `json:"currencyCode"`
	ContactName             *string `json:"contactName"`
	ContactEmail            *string `json:"contactEmail"`
	ContactMobile           *string `json:"contactMobile"`
	AddressText             *string `json:"addressText"`
}

type mutationReceipt struct {
	ReceiptID   string
	RequestHash string
	Status      string
	ResultJSON  sql.NullString
}

var profileMutationFields = map[string]bool{
	"expectedRevision":        true,
	"orgName":                 true,
	"orgShortName":            true,
	"displayName":             true,
	"legalName":               true,
	"unifiedSocialCreditCode": true,
	"logoPath":                true,
	"websiteUrl":              true,
	"industryCode":            true,
	"countryCode":             true,
	"timezone":                true,
	"locale":                  true,
	"currencyCode":            true,
	"contactName":             true,
	"contactEmail":            true,
	"contactMobile":           true,
	"addressText":             true,
}

func (a *Adapter) UpdateProfile(ctx context.Context, input UpdateProfileInput) (map[string]any, error) {
	idempotencyKey := strings.TrimSpace(input.IdempotencyKey)
	if !mutationIdempotencyKeyPattern.MatchString(idempotencyKey) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_idempotency_key", "Idempotency-Key must be 1-191 safe ASCII characters")
	}
	actorID := strings.TrimSpace(input.ActorID)
	if actorID == "" || len(actorID) > 128 {
		return nil, httperror.New(http.StatusForbidden, "trusted_console_actor_required", "A trusted Console user actor is required")
	}
	requestID := strings.TrimSpace(input.RequestID)
	if len(requestID) > 64 {
		requestID = requestID[:64]
	}

	mutation, err := parseProfileMutation(input.Body)
	if err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(mutation)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(canonical)
	requestHash := hex.EncodeToString(hash[:])
	receiptID, err := newMutationReceiptID()
	if err != nil {
		return nil, err
	}

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO console_mutation_receipts (
			receipt_id,tenant_code,operation_code,idempotency_key,request_sha256,
			status,actor_type,actor_id,request_id,created_at,updated_at
		) VALUES (?, ?, ?, ?, ?, 'processing', 'human', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
		ON DUPLICATE KEY UPDATE receipt_id=console_mutation_receipts.receipt_id
	`, receiptID, a.tenant, profileUpdateOperation, idempotencyKey, requestHash, actorID, nullableText(requestID)); err != nil {
		return nil, err
	}

	var receipt mutationReceipt
	if err := tx.QueryRowContext(ctx, `
		SELECT receipt_id,request_sha256,status,result_json
		FROM console_mutation_receipts
		WHERE tenant_code=? AND operation_code=? AND idempotency_key=?
		FOR UPDATE
	`, a.tenant, profileUpdateOperation, idempotencyKey).Scan(
		&receipt.ReceiptID,
		&receipt.RequestHash,
		&receipt.Status,
		&receipt.ResultJSON,
	); err != nil {
		return nil, err
	}
	if receipt.RequestHash != requestHash {
		return nil, httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "Idempotency-Key was already used with a different profile update")
	}
	if receipt.Status == "succeeded" {
		var replay map[string]any
		if !receipt.ResultJSON.Valid || json.Unmarshal([]byte(receipt.ResultJSON.String), &replay) != nil {
			return nil, httperror.New(http.StatusConflict, "idempotency_receipt_invalid", "Stored mutation receipt cannot be replayed")
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		replay["replayed"] = true
		return replay, nil
	}
	if receipt.ReceiptID != receiptID {
		return nil, httperror.New(http.StatusConflict, "mutation_in_progress", "A profile update with this Idempotency-Key is still processing")
	}

	currentTenant, currentRevision, err := lockCurrentProfile(ctx, tx)
	if err != nil {
		return nil, err
	}
	if a.tenant == "" || currentTenant != a.tenant {
		return nil, httperror.New(http.StatusForbidden, "console_tenant_binding_mismatch", "Console database tenant does not match this runtime")
	}
	if currentRevision != mutation.ExpectedRevision {
		return nil, httperror.New(http.StatusConflict, "profile_revision_conflict", "Enterprise profile has changed; reload it before saving")
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE org_profiles
		SET org_name=?,org_short_name=?,display_name=?,legal_name=?,
			unified_social_credit_code=?,logo_path=?,website_url=?,industry_code=?,
			country_code=?,timezone=?,locale=?,currency_code=?,contact_name=?,
			contact_email=?,contact_mobile=?,address_text=?,
			revision=revision+1,updated_at=UTC_TIMESTAMP(3)
		WHERE singleton_key=1 AND tenant_code=? AND revision=?
	`, mutation.OrgName, mutation.OrgShortName, mutation.DisplayName, mutation.LegalName,
		mutation.UnifiedSocialCreditCode, mutation.LogoPath, mutation.WebsiteURL, mutation.IndustryCode,
		mutation.CountryCode, mutation.Timezone, mutation.Locale, mutation.CurrencyCode, mutation.ContactName,
		mutation.ContactEmail, mutation.ContactMobile, mutation.AddressText,
		a.tenant, mutation.ExpectedRevision)
	if err != nil {
		return nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusConflict, "profile_revision_conflict", "Enterprise profile has changed; reload it before saving")
	}

	profile, err := loadProfileTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	detail, err := json.Marshal(map[string]any{
		"receiptId":        receiptID,
		"previousRevision": mutation.ExpectedRevision,
		"revision":         profile.Revision,
		"fields": []string{
			"orgName", "orgShortName", "displayName", "legalName", "unifiedSocialCreditCode",
			"logoPath", "websiteUrl", "industryCode", "countryCode", "timezone", "locale",
			"currencyCode", "contactName", "contactEmail", "contactMobile", "addressText",
		},
	})
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO operation_logs (
			domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at
		) VALUES ('tenant_profile','update','org_profile',?,'human',?,?,?,UTC_TIMESTAMP())
	`, a.tenant, actorID, nullableText(requestID), detail); err != nil {
		return nil, err
	}

	response := map[string]any{"code": 0, "data": profile, "replayed": false}
	responseJSON, err := json.Marshal(response)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE console_mutation_receipts
		SET status='succeeded',result_json=?,response_http_status=200,
			completed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE receipt_id=? AND status='processing'
	`, responseJSON, receiptID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return response, nil
}

func parseProfileMutation(body map[string]any) (profileMutation, error) {
	for key := range body {
		if !profileMutationFields[key] {
			return profileMutation{}, httperror.New(http.StatusBadRequest, "profile_field_not_writable", "Profile field is not writable: "+key)
		}
	}

	expectedRevision, ok := uint64Value(body["expectedRevision"])
	if !ok || expectedRevision == 0 {
		return profileMutation{}, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a positive integer")
	}
	mutation := profileMutation{
		ExpectedRevision:        expectedRevision,
		OrgName:                 requiredString(body, "orgName"),
		OrgShortName:            optionalString(body, "orgShortName"),
		DisplayName:             optionalString(body, "displayName"),
		LegalName:               optionalString(body, "legalName"),
		UnifiedSocialCreditCode: optionalString(body, "unifiedSocialCreditCode"),
		LogoPath:                optionalString(body, "logoPath"),
		WebsiteURL:              optionalString(body, "websiteUrl"),
		IndustryCode:            optionalString(body, "industryCode"),
		CountryCode:             requiredString(body, "countryCode"),
		Timezone:                requiredString(body, "timezone"),
		Locale:                  requiredString(body, "locale"),
		CurrencyCode:            requiredString(body, "currencyCode"),
		ContactName:             optionalString(body, "contactName"),
		ContactEmail:            optionalString(body, "contactEmail"),
		ContactMobile:           optionalString(body, "contactMobile"),
		AddressText:             optionalString(body, "addressText"),
	}
	for field, value := range map[string]string{
		"orgName":      mutation.OrgName,
		"countryCode":  mutation.CountryCode,
		"timezone":     mutation.Timezone,
		"locale":       mutation.Locale,
		"currencyCode": mutation.CurrencyCode,
	} {
		if value == "" {
			return profileMutation{}, httperror.New(http.StatusBadRequest, "profile_field_required", field+" is required")
		}
	}
	if len(mutation.OrgName) > 255 || len(mutation.CountryCode) > 8 || len(mutation.Timezone) > 64 || len(mutation.Locale) > 32 || len(mutation.CurrencyCode) > 16 {
		return profileMutation{}, httperror.New(http.StatusBadRequest, "profile_field_too_long", "One or more profile fields exceed their maximum length")
	}
	for _, value := range []struct {
		Value *string
		Max   int
	}{
		{mutation.OrgShortName, 128}, {mutation.DisplayName, 255}, {mutation.LegalName, 255},
		{mutation.UnifiedSocialCreditCode, 64}, {mutation.LogoPath, 500}, {mutation.WebsiteURL, 255},
		{mutation.IndustryCode, 64}, {mutation.ContactName, 128}, {mutation.ContactEmail, 255},
		{mutation.ContactMobile, 64}, {mutation.AddressText, 500},
	} {
		if value.Value != nil && len(*value.Value) > value.Max {
			return profileMutation{}, httperror.New(http.StatusBadRequest, "profile_field_too_long", "One or more profile fields exceed their maximum length")
		}
	}
	return mutation, nil
}

func lockCurrentProfile(ctx context.Context, tx *sql.Tx) (string, uint64, error) {
	var tenant string
	var revision uint64
	err := tx.QueryRowContext(ctx, `
		SELECT tenant_code,revision
		FROM org_profiles
		WHERE singleton_key=1
		LIMIT 1
		FOR UPDATE
	`).Scan(&tenant, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, httperror.New(http.StatusServiceUnavailable, "console_profile_unavailable", "Console tenant profile is not initialized")
	}
	return tenant, revision, err
}

func loadProfileTx(ctx context.Context, tx *sql.Tx) (Profile, error) {
	var profile Profile
	var orgShortName, displayName, legalName sql.NullString
	var unifiedSocialCreditCode, logoPath, websiteURL, industryCode sql.NullString
	var contactName, contactEmail, contactMobile, addressText sql.NullString
	var updatedAt time.Time
	err := tx.QueryRowContext(ctx, `
		SELECT tenant_code,org_name,org_short_name,display_name,legal_name,
			unified_social_credit_code,logo_path,website_url,industry_code,
			country_code,timezone,locale,currency_code,contact_name,contact_email,
			contact_mobile,address_text,status,revision,updated_at
		FROM org_profiles
		WHERE singleton_key=1
		LIMIT 1
	`).Scan(
		&profile.TenantCode, &profile.OrgName, &orgShortName, &displayName, &legalName,
		&unifiedSocialCreditCode, &logoPath, &websiteURL, &industryCode,
		&profile.CountryCode, &profile.Timezone, &profile.Locale, &profile.CurrencyCode,
		&contactName, &contactEmail, &contactMobile, &addressText,
		&profile.Status, &profile.Revision, &updatedAt,
	)
	if err != nil {
		return Profile{}, err
	}
	profile.OrgShortName = nullableString(orgShortName)
	profile.DisplayName = nullableString(displayName)
	profile.LegalName = nullableString(legalName)
	profile.UnifiedSocialCreditCode = nullableString(unifiedSocialCreditCode)
	profile.LogoPath = nullableString(logoPath)
	profile.WebsiteURL = nullableString(websiteURL)
	profile.IndustryCode = nullableString(industryCode)
	profile.ContactName = nullableString(contactName)
	profile.ContactEmail = nullableString(contactEmail)
	profile.ContactMobile = nullableString(contactMobile)
	profile.AddressText = nullableString(addressText)
	profile.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return profile, nil
}

func requiredString(body map[string]any, key string) string {
	value, ok := body[key].(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(value)
}

func optionalString(body map[string]any, key string) *string {
	value, ok := body[key]
	if !ok || value == nil {
		return nil
	}
	text, ok := value.(string)
	if !ok {
		return nil
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	return &text
}

func uint64Value(value any) (uint64, bool) {
	switch candidate := value.(type) {
	case float64:
		if candidate <= 0 || candidate != float64(uint64(candidate)) {
			return 0, false
		}
		return uint64(candidate), true
	case int:
		if candidate <= 0 {
			return 0, false
		}
		return uint64(candidate), true
	case uint64:
		return candidate, candidate > 0
	default:
		return 0, false
	}
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func randomUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}
