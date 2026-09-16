package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var requiredTables = schemaRequiredTables()

type Adapter struct {
	db             *sql.DB
	dbName         string
	tenant         string
	vaultMasterKey string
	vaultKeyMu     sync.RWMutex
	ownsDB         bool
}

func normalizeVaultMasterKey(value string) []byte {
	configured := strings.TrimSpace(value)
	if decoded, err := base64.StdEncoding.DecodeString(configured); err == nil && len(decoded) >= 32 {
		return decoded[:32]
	}
	if decoded, err := hex.DecodeString(configured); err == nil && len(decoded) >= 32 {
		return decoded[:32]
	}
	digest := sha256.Sum256([]byte(configured))
	return digest[:]
}

func VaultMasterKeyFingerprint(value string) string {
	digest := sha256.Sum256(normalizeVaultMasterKey(value))
	return "sha256:" + hex.EncodeToString(digest[:])[:32]
}

func (a *Adapter) VaultMasterKeyConfigured() bool {
	a.vaultKeyMu.RLock()
	defer a.vaultKeyMu.RUnlock()
	return strings.TrimSpace(a.vaultMasterKey) != ""
}

func (a *Adapter) InstallVaultMasterKey(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", httperror.New(http.StatusBadRequest, "console_vault_key_required", "Console Vault master key is required")
	}
	fingerprint := VaultMasterKeyFingerprint(value)
	a.vaultKeyMu.Lock()
	defer a.vaultKeyMu.Unlock()
	if configured := strings.TrimSpace(a.vaultMasterKey); configured != "" {
		if VaultMasterKeyFingerprint(configured) != fingerprint {
			return "", httperror.New(http.StatusConflict, "console_vault_key_conflict", "Console Vault master key is already configured with different key material")
		}
		return fingerprint, nil
	}
	a.vaultMasterKey = value
	return fingerprint, nil
}

type SchemaStatus struct {
	App                string            `json:"app"`
	Database           string            `json:"database"`
	Status             string            `json:"status"`
	SchemaRevision     string            `json:"schemaRevision"`
	CheckedTables      []string          `json:"checkedTables"`
	CheckedColumns     int               `json:"checkedColumns"`
	CheckedIndexes     int               `json:"checkedIndexes"`
	CheckedConstraints int               `json:"checkedConstraints"`
	MissingTables      []string          `json:"missingTables"`
	MissingColumns     []SchemaObjectGap `json:"missingColumns"`
	MissingIndexes     []SchemaObjectGap `json:"missingIndexes"`
	MissingConstraints []SchemaObjectGap `json:"missingConstraints"`
}

type SchemaObjectGap struct {
	Table string `json:"table"`
	Name  string `json:"name"`
}

type Profile struct {
	TenantCode              string  `json:"tenantCode"`
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
	Status                  string  `json:"status"`
	Revision                uint64  `json:"revision"`
	UpdatedAt               string  `json:"updatedAt"`
}

func New(cfg config.ConsoleConfig, tenant string) (*Adapter, error) {
	conn, err := db.Open(cfg.DB)
	if err != nil {
		return nil, err
	}
	return newAdapter(cfg, tenant, conn, true), nil
}

// NewWithDB lets the Directory and Console adapters share the one connection
// pool that owns hzy_console. The caller remains responsible for closing it.
func NewWithDB(cfg config.ConsoleConfig, tenant string, conn *sql.DB) *Adapter {
	return newAdapter(cfg, tenant, conn, false)
}

func newAdapter(cfg config.ConsoleConfig, tenant string, conn *sql.DB, ownsDB bool) *Adapter {
	return &Adapter{
		db:             conn,
		dbName:         strings.TrimSpace(cfg.DB.Database),
		tenant:         strings.TrimSpace(tenant),
		vaultMasterKey: strings.TrimSpace(cfg.VaultMasterKey),
		ownsDB:         ownsDB,
	}
}

func (a *Adapter) DB() *sql.DB {
	return a.db
}

func (a *Adapter) Ping(ctx context.Context) error {
	return a.db.PingContext(ctx)
}

func (a *Adapter) Close() error {
	if !a.ownsDB {
		return nil
	}
	return a.db.Close()
}

func (a *Adapter) Profile(ctx context.Context) (map[string]any, error) {
	var profile Profile
	var orgShortName, displayName, legalName sql.NullString
	var unifiedSocialCreditCode, logoPath, websiteURL, industryCode sql.NullString
	var contactName, contactEmail, contactMobile, addressText sql.NullString
	var updatedAt time.Time

	err := a.db.QueryRowContext(ctx, `
		SELECT tenant_code,org_name,org_short_name,display_name,legal_name,
			unified_social_credit_code,logo_path,website_url,industry_code,
			country_code,timezone,locale,currency_code,contact_name,contact_email,
			contact_mobile,address_text,status,revision,updated_at
		FROM org_profiles
		WHERE singleton_key=1
		LIMIT 1
	`).Scan(
		&profile.TenantCode,
		&profile.OrgName,
		&orgShortName,
		&displayName,
		&legalName,
		&unifiedSocialCreditCode,
		&logoPath,
		&websiteURL,
		&industryCode,
		&profile.CountryCode,
		&profile.Timezone,
		&profile.Locale,
		&profile.CurrencyCode,
		&contactName,
		&contactEmail,
		&contactMobile,
		&addressText,
		&profile.Status,
		&profile.Revision,
		&updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusServiceUnavailable, "console_profile_unavailable", "Console tenant profile is not initialized")
	}
	if err != nil {
		return nil, err
	}
	if a.tenant == "" || profile.TenantCode != a.tenant {
		return nil, httperror.New(http.StatusForbidden, "console_tenant_binding_mismatch", "Console database tenant does not match this runtime")
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

	return map[string]any{"code": 0, "data": profile}, nil
}

func (a *Adapter) SchemaStatus(ctx context.Context) (SchemaStatus, error) {
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(requiredTables)), ",")
	args := make([]any, len(requiredTables))
	for index, table := range requiredTables {
		args[index] = table
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT TABLE_NAME
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return SchemaStatus{}, err
	}
	defer rows.Close()

	existing := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return SchemaStatus{}, err
		}
		existing[table] = true
	}
	if err := rows.Err(); err != nil {
		return SchemaStatus{}, err
	}

	missing := make([]string, 0, len(requiredTables))
	for _, table := range requiredTables {
		if !existing[table] {
			missing = append(missing, table)
		}
	}

	columns, err := a.schemaObjects(ctx, "COLUMNS", "COLUMN_NAME")
	if err != nil {
		return SchemaStatus{}, err
	}
	indexes, err := a.schemaObjects(ctx, "STATISTICS", "INDEX_NAME")
	if err != nil {
		return SchemaStatus{}, err
	}
	constraints, err := a.schemaObjects(ctx, "TABLE_CONSTRAINTS", "CONSTRAINT_NAME")
	if err != nil {
		return SchemaStatus{}, err
	}
	missingColumns := make([]SchemaObjectGap, 0)
	missingIndexes := make([]SchemaObjectGap, 0)
	missingConstraints := make([]SchemaObjectGap, 0)
	checkedColumns := 0
	checkedIndexes := 0
	checkedConstraints := 0
	for _, table := range requiredTables {
		definition := consoleSchemaManifest.Tables[table]
		checkedColumns += len(definition.Columns)
		checkedIndexes += len(definition.Indexes)
		checkedConstraints += len(definition.Constraints)
		for _, column := range definition.Columns {
			if !columns[table][column] {
				missingColumns = append(missingColumns, SchemaObjectGap{Table: table, Name: column})
			}
		}
		for _, index := range definition.Indexes {
			if !indexes[table][index] {
				missingIndexes = append(missingIndexes, SchemaObjectGap{Table: table, Name: index})
			}
		}
		for _, constraint := range definition.Constraints {
			if !constraints[table][constraint] {
				missingConstraints = append(missingConstraints, SchemaObjectGap{Table: table, Name: constraint})
			}
		}
	}

	status := "ok"
	if len(missing) > 0 || len(missingColumns) > 0 || len(missingIndexes) > 0 || len(missingConstraints) > 0 {
		status = "schema_mismatch"
	}
	return SchemaStatus{
		App:                "console",
		Database:           a.dbName,
		Status:             status,
		SchemaRevision:     consoleSchemaManifest.SchemaRevision,
		CheckedTables:      append([]string(nil), requiredTables...),
		CheckedColumns:     checkedColumns,
		CheckedIndexes:     checkedIndexes,
		CheckedConstraints: checkedConstraints,
		MissingTables:      missing,
		MissingColumns:     missingColumns,
		MissingIndexes:     missingIndexes,
		MissingConstraints: missingConstraints,
	}, nil
}

func (a *Adapter) schemaObjects(ctx context.Context, source, objectColumn string) (map[string]map[string]bool, error) {
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(requiredTables)), ",")
	args := make([]any, len(requiredTables))
	for index, table := range requiredTables {
		args[index] = table
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT TABLE_NAME,`+objectColumn+`
		FROM information_schema.`+source+`
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	objects := map[string]map[string]bool{}
	for rows.Next() {
		var table, name string
		if err := rows.Scan(&table, &name); err != nil {
			return nil, err
		}
		if objects[table] == nil {
			objects[table] = map[string]bool{}
		}
		objects[table][name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return objects, nil
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	text := value.String
	return &text
}
