package console

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func completeProfileMutationBody(revision uint64) map[string]any {
	return map[string]any{
		"expectedRevision":        revision,
		"orgName":                 "Wiztek",
		"orgShortName":            "Wiztek",
		"displayName":             "Wiztek",
		"legalName":               nil,
		"unifiedSocialCreditCode": nil,
		"logoPath":                "/logo.svg",
		"websiteUrl":              "https://wiztek.example",
		"industryCode":            "software",
		"countryCode":             "CN",
		"timezone":                "Asia/Shanghai",
		"locale":                  "zh-CN",
		"currencyCode":            "CNY",
		"contactName":             "Admin",
		"contactEmail":            "admin@example.test",
		"contactMobile":           nil,
		"addressText":             "Shanghai",
	}
}

func TestProfileReturnsWhitelistedFieldsForEnrolledTenant(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	updatedAt := time.Date(2026, 7, 17, 10, 11, 12, 0, time.UTC)
	mock.ExpectQuery("SELECT tenant_code,org_name,org_short_name,display_name,legal_name").
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_code", "org_name", "org_short_name", "display_name", "legal_name",
			"unified_social_credit_code", "logo_path", "website_url", "industry_code",
			"country_code", "timezone", "locale", "currency_code", "contact_name",
			"contact_email", "contact_mobile", "address_text", "status", "revision", "updated_at",
		}).AddRow(
			"C000001", "Wiztek", "Wiztek", "Wiztek", nil,
			nil, "/logo.svg", "https://wiztek.example", "software",
			"CN", "Asia/Shanghai", "zh-CN", "CNY", "Admin",
			"admin@example.test", nil, "Shanghai", "active", 3, updatedAt,
		))

	adapter := NewWithDB(config.ConsoleConfig{DB: config.DBConfig{Database: "hzy_console"}}, "C000001", database)
	result, err := adapter.Profile(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	profile, ok := result["data"].(Profile)
	if !ok {
		t.Fatalf("unexpected result: %#v", result)
	}
	if profile.TenantCode != "C000001" || profile.OrgName != "Wiztek" || profile.Revision != 3 || profile.UpdatedAt != "2026-07-17T10:11:12Z" {
		t.Fatalf("unexpected profile: %#v", profile)
	}
	if profile.ContactMobile != nil || profile.LogoPath == nil || *profile.LogoPath != "/logo.svg" {
		t.Fatalf("unexpected nullable fields: %#v", profile)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProfileRejectsDatabaseTenantMismatch(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mock.ExpectQuery("SELECT tenant_code,org_name,org_short_name,display_name,legal_name").
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_code", "org_name", "org_short_name", "display_name", "legal_name",
			"unified_social_credit_code", "logo_path", "website_url", "industry_code",
			"country_code", "timezone", "locale", "currency_code", "contact_name",
			"contact_email", "contact_mobile", "address_text", "status", "revision", "updated_at",
		}).AddRow(
			"C999999", "Other tenant", nil, nil, nil,
			nil, nil, nil, nil, "CN", "Asia/Shanghai", "zh-CN", "CNY",
			nil, nil, nil, nil, "active", 1, time.Now().UTC(),
		))

	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	_, err = adapter.Profile(context.Background())
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "console_tenant_binding_mismatch" {
		t.Fatalf("unexpected error: %T %v", err, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaManifestCoversEveryConsoleRuntimeDomain(t *testing.T) {
	required := map[string]bool{}
	for _, table := range requiredTables {
		required[table] = true
	}
	for _, table := range []string{
		"org_profiles",
		"console_mutation_receipts",
		"directory_lifecycle_scope_versions",
		"service_command_receipt",
		"integration_operation",
		"integration_operation_attempt",
		"console_platform_lifecycle_actionables",
		"directory_departments",
		"directory_users",
		"directory_user_departments",
		"directory_projects",
		"directory_project_members",
		"directory_identities",
		"directory_sync_jobs",
		"directory_sync_events",
		"directory_subject_exports",
		"local_sessions",
		"auth_signing_keys",
		"local_presence_heartbeats",
		"runtime_clipboards",
		"vault_secret_versions",
		"integration_credentials",
		"service_client_credentials",
		"portal_actionable_projections",
		"portal_notification_deliveries",
		"operation_logs",
	} {
		if !required[table] {
			t.Fatalf("Console Runtime schema manifest is missing %q", table)
		}
	}
	if required["console_runtime_cache"] {
		t.Fatal("retired Console database cache must not be a Runtime schema dependency")
	}
}

func TestSchemaStatusValidatesTablesColumnsAndIndexes(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	tableRows := sqlmock.NewRows([]string{"TABLE_NAME"})
	columnRows := sqlmock.NewRows([]string{"TABLE_NAME", "COLUMN_NAME"})
	indexRows := sqlmock.NewRows([]string{"TABLE_NAME", "INDEX_NAME"})
	constraintRows := sqlmock.NewRows([]string{"TABLE_NAME", "CONSTRAINT_NAME"})
	for _, table := range requiredTables {
		tableRows.AddRow(table)
		for _, column := range consoleSchemaManifest.Tables[table].Columns {
			columnRows.AddRow(table, column)
		}
		for _, index := range consoleSchemaManifest.Tables[table].Indexes {
			indexRows.AddRow(table, index)
		}
		for _, constraint := range consoleSchemaManifest.Tables[table].Constraints {
			constraintRows.AddRow(table, constraint)
		}
	}
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLES`).WillReturnRows(tableRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.COLUMNS`).WillReturnRows(columnRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.STATISTICS`).WillReturnRows(indexRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLE_CONSTRAINTS`).WillReturnRows(constraintRows)

	adapter := NewWithDB(config.ConsoleConfig{DB: config.DBConfig{Database: "hzy_console"}}, "C000001", database)
	status, err := adapter.SchemaStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "ok" || len(status.MissingTables) != 0 ||
		len(status.MissingColumns) != 0 || len(status.MissingIndexes) != 0 ||
		len(status.MissingConstraints) != 0 {
		t.Fatalf("unexpected schema status: %#v", status)
	}
	if status.SchemaRevision != consoleSchemaManifest.SchemaRevision ||
		status.CheckedTables[0] == "" || status.CheckedColumns == 0 ||
		status.CheckedIndexes == 0 || status.CheckedConstraints == 0 {
		t.Fatalf("schema evidence is incomplete: %#v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaStatusRejectsMissingColumnAndIndex(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	tableRows := sqlmock.NewRows([]string{"TABLE_NAME"})
	columnRows := sqlmock.NewRows([]string{"TABLE_NAME", "COLUMN_NAME"})
	indexRows := sqlmock.NewRows([]string{"TABLE_NAME", "INDEX_NAME"})
	constraintRows := sqlmock.NewRows([]string{"TABLE_NAME", "CONSTRAINT_NAME"})
	for _, table := range requiredTables {
		tableRows.AddRow(table)
		for _, column := range consoleSchemaManifest.Tables[table].Columns {
			if table != "org_profiles" || column != "tenant_code" {
				columnRows.AddRow(table, column)
			}
		}
		for _, index := range consoleSchemaManifest.Tables[table].Indexes {
			if table != "console_mutation_receipts" || index != "uk_console_mutation_receipt_identity" {
				indexRows.AddRow(table, index)
			}
		}
		for _, constraint := range consoleSchemaManifest.Tables[table].Constraints {
			if table != "org_profiles" || constraint != "ck_org_profiles_singleton_key" {
				constraintRows.AddRow(table, constraint)
			}
		}
	}
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLES`).WillReturnRows(tableRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.COLUMNS`).WillReturnRows(columnRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.STATISTICS`).WillReturnRows(indexRows)
	mock.ExpectQuery(`(?s)FROM information_schema\.TABLE_CONSTRAINTS`).WillReturnRows(constraintRows)

	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	status, err := adapter.SchemaStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "schema_mismatch" ||
		len(status.MissingColumns) != 1 || status.MissingColumns[0] != (SchemaObjectGap{Table: "org_profiles", Name: "tenant_code"}) ||
		len(status.MissingIndexes) != 1 || status.MissingIndexes[0] != (SchemaObjectGap{Table: "console_mutation_receipts", Name: "uk_console_mutation_receipt_identity"}) ||
		len(status.MissingConstraints) != 1 || status.MissingConstraints[0] != (SchemaObjectGap{Table: "org_profiles", Name: "ck_org_profiles_singleton_key"}) {
		t.Fatalf("unexpected schema gaps: %#v", status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateProfileCommitsCASReceiptAndAuditTogether(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	originalIDGenerator := newMutationReceiptID
	newMutationReceiptID = func() (string, error) {
		return "11111111-1111-4111-8111-111111111111", nil
	}
	t.Cleanup(func() { newMutationReceiptID = originalIDGenerator })

	body := completeProfileMutationBody(3)
	mutation, err := parseProfileMutation(body)
	if err != nil {
		t.Fatal(err)
	}
	canonical, _ := json.Marshal(mutation)
	hash := sha256Hex(canonical)
	updatedAt := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO console_mutation_receipts").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT receipt_id,request_sha256,status,result_json").
		WillReturnRows(sqlmock.NewRows([]string{
			"receipt_id", "request_sha256", "status", "result_json",
		}).AddRow("11111111-1111-4111-8111-111111111111", hash, "processing", nil))
	mock.ExpectQuery("SELECT tenant_code,revision").
		WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "revision"}).AddRow("C000001", 3))
	mock.ExpectExec("UPDATE org_profiles").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT tenant_code,org_name,org_short_name,display_name,legal_name").
		WillReturnRows(sqlmock.NewRows([]string{
			"tenant_code", "org_name", "org_short_name", "display_name", "legal_name",
			"unified_social_credit_code", "logo_path", "website_url", "industry_code",
			"country_code", "timezone", "locale", "currency_code", "contact_name",
			"contact_email", "contact_mobile", "address_text", "status", "revision", "updated_at",
		}).AddRow(
			"C000001", "Wiztek", "Wiztek", "Wiztek", nil,
			nil, "/logo.svg", "https://wiztek.example", "software",
			"CN", "Asia/Shanghai", "zh-CN", "CNY", "Admin",
			"admin@example.test", nil, "Shanghai", "active", 4, updatedAt,
		))
	mock.ExpectExec("INSERT INTO operation_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE console_mutation_receipts").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	response, err := adapter.UpdateProfile(context.Background(), UpdateProfileInput{
		Body:           body,
		IdempotencyKey: "org-profile:test-1",
		RequestID:      "request-1",
		ActorID:        "U1001",
	})
	if err != nil {
		t.Fatal(err)
	}
	profile, ok := response["data"].(Profile)
	if !ok || profile.Revision != 4 || response["replayed"] != false {
		t.Fatalf("unexpected response: %#v", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateProfileRejectsTenantAndStatusOverrides(t *testing.T) {
	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", nil)
	for _, forbidden := range []string{"tenantCode", "singletonKey", "status", "revision"} {
		body := completeProfileMutationBody(1)
		body[forbidden] = "override"
		_, err := adapter.UpdateProfile(context.Background(), UpdateProfileInput{
			Body:           body,
			IdempotencyKey: "org-profile:forbidden",
			ActorID:        "U1001",
		})
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Code != "profile_field_not_writable" {
			t.Fatalf("%s error=%T %v", forbidden, err, err)
		}
	}
}

func TestUpdateManagedSettingUsesCASReceiptAndAuditForNonUISetting(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	originalIDGenerator := newMutationReceiptID
	newMutationReceiptID = func() (string, error) {
		return "22222222-2222-4222-8222-222222222222", nil
	}
	t.Cleanup(func() { newMutationReceiptID = originalIDGenerator })

	payload := struct {
		SettingKey       string `json:"settingKey"`
		ScopeKey         string `json:"scopeKey"`
		ExpectedRevision uint64 `json:"expectedRevision"`
		Value            any    `json:"value"`
	}{
		SettingKey:       "connector.notificationsEnabled",
		ScopeKey:         tenantSettingScope,
		ExpectedRevision: 2,
		Value:            true,
	}
	canonical, _ := json.Marshal(payload)
	hash := sha256Hex(canonical)
	updatedAt := time.Date(2026, 7, 17, 18, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO console_mutation_receipts").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT receipt_id,request_sha256,status,result_json").
		WillReturnRows(sqlmock.NewRows([]string{
			"receipt_id", "request_sha256", "status", "result_json",
		}).AddRow("22222222-2222-4222-8222-222222222222", hash, "processing", nil))
	mock.ExpectQuery("FROM setting_catalogs").
		WithArgs("connector.notificationsEnabled").
		WillReturnRows(sqlmock.NewRows([]string{
			"setting_key", "setting_name", "value_type", "scope_type", "category",
			"default_value_json", "validator_json", "is_required", "editable_in_ui",
			"description", "status", "updated_at",
		}).AddRow(
			"connector.notificationsEnabled", "Connector notifications", "boolean", "tenant", "connector",
			[]byte("false"), nil, false, false, nil, "active", updatedAt,
		))
	mock.ExpectQuery("SELECT revision FROM setting_values").
		WithArgs("connector.notificationsEnabled", tenantSettingScope).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(2))
	mock.ExpectExec("UPDATE setting_values").
		WithArgs([]byte("true"), "managed", "U1001", "connector.notificationsEnabled", tenantSettingScope, uint64(2)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT c.setting_key,c.setting_name,c.value_type,c.category").
		WithArgs(tenantSettingScope, "connector.notificationsEnabled").
		WillReturnRows(sqlmock.NewRows([]string{
			"setting_key", "setting_name", "value_type", "category", "default_value_json",
			"editable_in_ui", "description", "value_json", "source", "updated_by", "updated_at", "revision",
		}).AddRow(
			"connector.notificationsEnabled", "Connector notifications", "boolean", "connector", []byte("false"),
			false, nil, []byte("true"), "managed", "U1001", updatedAt, 3,
		))
	mock.ExpectExec("INSERT INTO operation_logs").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE console_mutation_receipts").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	response, err := adapter.UpdateManagedSetting(context.Background(), payload.SettingKey, map[string]any{
		"scopeKey":         payload.ScopeKey,
		"expectedRevision": payload.ExpectedRevision,
		"value":            payload.Value,
	}, MutationMeta{
		IdempotencyKey: "managed-setting:test-1",
		RequestID:      "request-2",
		ActorID:        "U1001",
	})
	if err != nil {
		t.Fatal(err)
	}
	item, ok := response["data"].(settingValue)
	if !ok || item.Revision != 3 || item.Source != "managed" || response["replayed"] != false {
		t.Fatalf("unexpected response: %#v", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func sha256Hex(value []byte) string {
	hash := sha256.Sum256(value)
	return hex.EncodeToString(hash[:])
}

func TestAuditDetailRecursivelyRedactsSensitiveFields(t *testing.T) {
	detail, err := sanitizeAuditDetail(map[string]any{
		"operation":   "connection.test",
		"accessToken": "plain-token",
		"nested": map[string]any{
			"client_secret": "plain-secret",
			"safe":          "visible",
		},
		"items": []any{
			map[string]any{"password": "plain-password", "status": "failed"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if detail["accessToken"] != "[REDACTED]" {
		t.Fatalf("access token was not redacted: %#v", detail)
	}
	nested := detail["nested"].(map[string]any)
	if nested["client_secret"] != "[REDACTED]" || nested["safe"] != "visible" {
		t.Fatalf("nested detail was not sanitized correctly: %#v", nested)
	}
	items := detail["items"].([]any)
	item := items[0].(map[string]any)
	if item["password"] != "[REDACTED]" || item["status"] != "failed" {
		t.Fatalf("array detail was not sanitized correctly: %#v", item)
	}
}

func TestLoginAuditWhereSeparatesEnterpriseOAuthProviders(t *testing.T) {
	for _, provider := range []string{"wecom", "dingtalk"} {
		where, args, err := loginLogWhere(url.Values{"login_type": []string{provider}})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(where, "l.auth_provider=?") || len(args) != 2 || args[0] != provider || args[1] != provider {
			t.Fatalf("%s where=%q args=%#v", provider, where, args)
		}
	}
	where, args, err := loginLogWhere(url.Values{"login_type": []string{"oauth"}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "NOT IN ('wecom','dingtalk')") || len(args) != 0 {
		t.Fatalf("oauth where=%q args=%#v", where, args)
	}
}

func TestOperationAuditWhereUsesBoundedPaginationAndLifecycleAllowlist(t *testing.T) {
	where, args, err := operationLogWhere(url.Values{
		"uid":          []string{"U1001"},
		"action_group": []string{"lifecycle_authorization"},
	}, "l")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(where, "l.target_key LIKE ?") || !strings.Contains(where, "l.action IN") {
		t.Fatalf("where=%q", where)
	}
	if len(args) != 3+len(lifecycleAuditActions) {
		t.Fatalf("unexpected args: %#v", args)
	}
	page, pageSize, offset := auditPage(url.Values{
		"page":     []string{"3"},
		"pageSize": []string{"500"},
	})
	if page != 3 || pageSize != 100 || offset != 200 {
		t.Fatalf("page=%d pageSize=%d offset=%d", page, pageSize, offset)
	}
}

func TestUserNotificationsAreBoundToTrustedUIDAndReturnSafeProjection(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	createdAt := time.Date(2026, 7, 17, 15, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT r.id,n.notification_id,n.source_app_code").
		WithArgs("U1001", 21).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "notification_id", "source_app_code", "category", "severity",
			"created_at", "expires_at", "read_at", "archived_at", "pinned_at",
		}).AddRow(9, "N-001", "workflow", "approval", "warning", createdAt, nil, nil, nil, nil))

	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	response, err := adapter.UserNotifications(context.Background(), "U1001", url.Values{})
	if err != nil {
		t.Fatal(err)
	}
	data := response["data"].(map[string]any)
	items := data["items"].([]map[string]any)
	if len(items) != 1 || items[0]["notificationId"] != "N-001" || items[0]["displayLabel"] != "待处理审批通知" {
		t.Fatalf("unexpected response: %#v", response)
	}
	recipient := items[0]["recipient"].(map[string]any)
	if recipient["isRead"] != false || recipient["isArchived"] != false {
		t.Fatalf("unexpected recipient projection: %#v", recipient)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestNotificationInputsFailClosed(t *testing.T) {
	if _, err := validNotificationUID(""); err == nil {
		t.Fatal("empty uid must fail")
	}
	if clause := notificationStatusSQL("archived"); clause != "r.archived_at IS NOT NULL" {
		t.Fatalf("unexpected archived clause: %s", clause)
	}
	database, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := NewWithDB(config.ConsoleConfig{}, "C000001", database)
	_, err = adapter.UserNotifications(context.Background(), "U1001", url.Values{"status": []string{"forged"}})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "notification_status_invalid" {
		t.Fatalf("unexpected error: %T %v", err, err)
	}
}
