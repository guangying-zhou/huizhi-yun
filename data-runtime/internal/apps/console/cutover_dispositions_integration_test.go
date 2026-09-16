package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// This opt-in test is intended for an isolated restored Console database. It
// proves the real MySQL DDL, API transaction, verifier query and stale-source
// fail-closed behavior together.
func TestCutoverDispositionIntegrationAgainstRestoredDatabase(t *testing.T) {
	if os.Getenv("HZY_CONSOLE_CUTOVER_INTEGRATION") != "1" {
		t.Skip("set HZY_CONSOLE_CUTOVER_INTEGRATION=1 for restored-database verification")
	}
	port, err := strconv.Atoi(os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PORT"))
	if err != nil || port <= 0 {
		t.Fatal("HZY_CONSOLE_INTEGRATION_DB_PORT is invalid")
	}
	adapter, err := New(config.ConsoleConfig{
		DB: config.DBConfig{
			Host:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_HOST"),
			Port:            port,
			User:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_USER"),
			Password:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PASSWORD"),
			Database:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_NAME"),
			ConnectionLimit: 2,
		},
	}, os.Getenv("HZY_CONSOLE_INTEGRATION_TENANT"))
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()
	ctx := context.Background()
	schema, err := adapter.SchemaStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if schema.Status != "ok" {
		t.Fatalf("restored database schema is incomplete: %#v", schema)
	}
	list, err := adapter.CutoverDispositionCandidates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	candidates, ok := list["candidates"].([]cutoverDispositionCandidate)
	if !ok {
		t.Fatalf("unexpected candidate response: %#v", list)
	}
	var selected cutoverDispositionCandidate
	found := false
	for _, candidate := range candidates {
		if candidate.Category == cutoverDispositionNotification {
			selected, found = candidate, true
			break
		}
	}
	if !found {
		t.Skip("restored database has no failed notification candidate")
	}
	var failedMetric cutoverCountSpec
	for _, metric := range cutoverMetrics() {
		if metric.code == "failed_notification_deliveries" {
			failedMetric = metric
			break
		}
	}
	before, err := adapter.queryCutoverCount(ctx, failedMetric)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().UTC().Format("20060102T150405.000000000")
	result, err := adapter.ApplyCutoverDispositions(ctx, map[string]any{
		"changeReference": "RESTORE-VERIFY-" + stamp,
		"dispositions": []any{map[string]any{
			"category":                  selected.Category,
			"subjectKey":                selected.SubjectKey,
			"expectedSourceFingerprint": selected.SourceFingerprint,
			"reasonCode":                "historical-terminal",
			"reason":                    "Isolated restore verification of fingerprint-bound cutover disposition.",
		}},
	}, AuditMutationMeta{
		IdempotencyKey: "restore-verify-" + stamp,
		RequestID:      "restore-verify-" + stamp,
		ActorType:      "system",
		ActorID:        "cutover-restore-verifier",
		SourceApp:      "console",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["count"] != 1 {
		t.Fatalf("unexpected disposition result: %#v", result)
	}
	afterDisposition, err := adapter.queryCutoverCount(ctx, failedMetric)
	if err != nil {
		t.Fatal(err)
	}
	if afterDisposition != before-1 {
		t.Fatalf("effective disposition count mismatch: before=%d after=%d", before, afterDisposition)
	}
	if _, err := adapter.db.ExecContext(ctx, `
		UPDATE portal_notification_deliveries
		SET updated_at=DATE_ADD(updated_at,INTERVAL 1 SECOND)
		WHERE id=?
	`, selected.SubjectKey); err != nil {
		t.Fatal(err)
	}
	afterSourceChange, err := adapter.queryCutoverCount(ctx, failedMetric)
	if err != nil {
		t.Fatal(err)
	}
	if afterSourceChange != before {
		t.Fatalf(
			"changed source must automatically re-block: before=%d changed=%d subject=%s",
			before,
			afterSourceChange,
			selected.SubjectKey,
		)
	}
	refreshed, err := adapter.CutoverDispositionCandidates(ctx)
	if err != nil {
		t.Fatal(err)
	}
	refreshedCandidates, _ := refreshed["candidates"].([]cutoverDispositionCandidate)
	for _, candidate := range refreshedCandidates {
		if candidate.Category == selected.Category && candidate.SubjectKey == selected.SubjectKey {
			if candidate.DispositionStatus != "stale" {
				t.Fatalf("changed source disposition must be stale: %#v", candidate)
			}
			return
		}
	}
	t.Fatal(fmt.Sprintf("changed source candidate %s disappeared", selected.SubjectKey))
}

func TestCutoverServiceClientRetirementIntegrationAgainstRestoredDatabase(t *testing.T) {
	if os.Getenv("HZY_CONSOLE_CUTOVER_INTEGRATION") != "1" {
		t.Skip("set HZY_CONSOLE_CUTOVER_INTEGRATION=1 for restored-database verification")
	}
	port, err := strconv.Atoi(os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PORT"))
	if err != nil || port <= 0 {
		t.Fatal("HZY_CONSOLE_INTEGRATION_DB_PORT is invalid")
	}
	adapter, err := New(config.ConsoleConfig{
		DB: config.DBConfig{
			Host:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_HOST"),
			Port:            port,
			User:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_USER"),
			Password:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PASSWORD"),
			Database:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_NAME"),
			ConnectionLimit: 2,
		},
	}, os.Getenv("HZY_CONSOLE_INTEGRATION_TENANT"))
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()
	ctx := context.Background()
	var fingerprint string
	err = adapter.db.QueryRowContext(ctx, `
		SELECT `+serviceClientCutoverFingerprintSQL+`
		FROM service_clients sc
		LEFT JOIN service_client_credentials scc
		  ON scc.id=sc.current_credential_id AND scc.service_client_id=sc.id
		LEFT JOIN vault_secrets vs ON vs.id=scc.secret_id
		LEFT JOIN vault_secret_versions vsv
		  ON vsv.id=vs.current_version_id AND vsv.secret_id=vs.id
		WHERE sc.id=8 AND sc.status='active' AND sc.current_credential_id IS NULL
	`).Scan(&fingerprint)
	if err != nil {
		t.Skipf("restored database has no active legacy service client 8: %v", err)
	}
	stamp := time.Now().UTC().Format("20060102T150405.000000000")
	result, err := adapter.RetireLegacyCutoverServiceClient(ctx, "8", map[string]any{
		"changeReference":           "RESTORE-RETIRE-" + stamp,
		"expectedSourceFingerprint": fingerprint,
		"reasonCode":                "legacy-retired",
		"reason":                    "Isolated restore verification of grant-complete legacy identity retirement.",
	}, AuditMutationMeta{
		IdempotencyKey: "restore-retire-" + stamp,
		RequestID:      "restore-retire-" + stamp,
		ActorType:      "system",
		ActorID:        "cutover-restore-verifier",
		SourceApp:      "console",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result["status"] != "inactive" || result["replacementClientCode"] != "aims.runtime" {
		t.Fatalf("unexpected service client retirement: %#v", result)
	}
	var status string
	if err := adapter.db.QueryRowContext(ctx, `SELECT status FROM service_clients WHERE id=8`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "inactive" {
		t.Fatalf("legacy service client was not retired: %s", status)
	}
}

// This test deliberately binds an isolated restored database to a different
// Runtime tenant. Reading even the singleton organization profile must fail
// before the adapter can return tenant data.
func TestRestoredDatabaseRejectsWrongTenantBinding(t *testing.T) {
	if os.Getenv("HZY_CONSOLE_CUTOVER_INTEGRATION") != "1" {
		t.Skip("set HZY_CONSOLE_CUTOVER_INTEGRATION=1 for restored-database verification")
	}
	port, err := strconv.Atoi(os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PORT"))
	if err != nil || port <= 0 {
		t.Fatal("HZY_CONSOLE_INTEGRATION_DB_PORT is invalid")
	}
	configuredTenant := strings.TrimSpace(os.Getenv("HZY_CONSOLE_INTEGRATION_TENANT"))
	if configuredTenant == "" {
		t.Fatal("HZY_CONSOLE_INTEGRATION_TENANT is required")
	}
	adapter, err := New(config.ConsoleConfig{
		DB: config.DBConfig{
			Host:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_HOST"),
			Port:            port,
			User:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_USER"),
			Password:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PASSWORD"),
			Database:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_NAME"),
			ConnectionLimit: 2,
		},
	}, configuredTenant+"-WRONG")
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()

	_, err = adapter.Profile(context.Background())
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) ||
		httpErr.Status != http.StatusForbidden ||
		httpErr.Code != "console_tenant_binding_mismatch" {
		t.Fatalf("wrong Runtime tenant must fail closed: %T %v", err, err)
	}
}

// This opt-in test uses two independent restored Console databases. It proves
// that identical tenant-local identifiers and an identical idempotency key can
// be accepted once by each tenant without sharing a receipt or mutation state.
func TestRestoredDatabasesIsolateIdenticalTenantLocalKeys(t *testing.T) {
	if os.Getenv("HZY_CONSOLE_DUAL_TENANT_INTEGRATION") != "1" {
		t.Skip("set HZY_CONSOLE_DUAL_TENANT_INTEGRATION=1 for dual-database tenant isolation verification")
	}
	port, err := strconv.Atoi(os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PORT"))
	if err != nil || port <= 0 {
		t.Fatal("HZY_CONSOLE_INTEGRATION_DB_PORT is invalid")
	}
	tenantA := strings.TrimSpace(os.Getenv("HZY_CONSOLE_INTEGRATION_TENANT_A"))
	tenantB := strings.TrimSpace(os.Getenv("HZY_CONSOLE_INTEGRATION_TENANT_B"))
	databaseA := strings.TrimSpace(os.Getenv("HZY_CONSOLE_INTEGRATION_DB_NAME_A"))
	databaseB := strings.TrimSpace(os.Getenv("HZY_CONSOLE_INTEGRATION_DB_NAME_B"))
	if tenantA == "" || tenantB == "" || tenantA == tenantB {
		t.Fatal("two distinct integration tenants are required")
	}
	if databaseA == "" || databaseB == "" || databaseA == databaseB {
		t.Fatal("two distinct integration databases are required")
	}

	newAdapter := func(database, tenant string) *Adapter {
		t.Helper()
		adapter, err := New(config.ConsoleConfig{
			DB: config.DBConfig{
				Host:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_HOST"),
				Port:            port,
				User:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_USER"),
				Password:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PASSWORD"),
				Database:        database,
				ConnectionLimit: 2,
			},
		}, tenant)
		if err != nil {
			t.Fatal(err)
		}
		return adapter
	}
	adapterA := newAdapter(databaseA, tenantA)
	defer adapterA.Close()
	adapterB := newAdapter(databaseB, tenantB)
	defer adapterB.Close()
	ctx := context.Background()

	profileA, err := adapterA.Profile(ctx)
	if err != nil {
		t.Fatal(err)
	}
	profileB, err := adapterB.Profile(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if profileTenantCode(t, profileA) != tenantA || profileTenantCode(t, profileB) != tenantB {
		t.Fatalf("profiles are not bound to the expected tenants: A=%#v B=%#v", profileA, profileB)
	}

	var uidA, uidB, departmentA, departmentB string
	if err := adapterA.db.QueryRowContext(ctx, `
		SELECT uid FROM directory_users WHERE status='active' ORDER BY id LIMIT 1
	`).Scan(&uidA); err != nil {
		t.Fatal(err)
	}
	if err := adapterB.db.QueryRowContext(ctx, `
		SELECT uid FROM directory_users WHERE status='active' ORDER BY id LIMIT 1
	`).Scan(&uidB); err != nil {
		t.Fatal(err)
	}
	if err := adapterA.db.QueryRowContext(ctx, `
		SELECT dept_code
		FROM directory_departments
		WHERE status='active' AND org_type='department'
		ORDER BY id LIMIT 1
	`).Scan(&departmentA); err != nil {
		t.Fatal(err)
	}
	if err := adapterB.db.QueryRowContext(ctx, `
		SELECT dept_code
		FROM directory_departments
		WHERE status='active' AND org_type='department'
		ORDER BY id LIMIT 1
	`).Scan(&departmentB); err != nil {
		t.Fatal(err)
	}
	if uidA == "" || uidA != uidB || departmentA == "" || departmentA != departmentB {
		t.Fatalf(
			"cloned tenants must expose identical tenant-local keys: uidA=%q uidB=%q deptA=%q deptB=%q",
			uidA,
			uidB,
			departmentA,
			departmentB,
		)
	}

	revisionA := profileRevision(t, profileA)
	revisionB := profileRevision(t, profileB)
	if revisionA != revisionB {
		t.Fatalf("cloned profiles must start at the same revision: A=%d B=%d", revisionA, revisionB)
	}
	idempotencyKey := "dual-tenant-identical-key"
	input := func(revision uint64) UpdateProfileInput {
		return UpdateProfileInput{
			Body:           completeProfileMutationBody(revision),
			IdempotencyKey: idempotencyKey,
			RequestID:      "dual-tenant-isolation",
			ActorID:        uidA,
		}
	}
	firstA, err := adapterA.UpdateProfile(ctx, input(revisionA))
	if err != nil {
		t.Fatal(err)
	}
	firstB, err := adapterB.UpdateProfile(ctx, input(revisionB))
	if err != nil {
		t.Fatal(err)
	}
	if firstA["replayed"] != false || firstB["replayed"] != false {
		t.Fatalf("first mutation in each tenant must be accepted independently: A=%#v B=%#v", firstA, firstB)
	}
	replayA, err := adapterA.UpdateProfile(ctx, input(revisionA))
	if err != nil {
		t.Fatal(err)
	}
	replayB, err := adapterB.UpdateProfile(ctx, input(revisionB))
	if err != nil {
		t.Fatal(err)
	}
	if replayA["replayed"] != true || replayB["replayed"] != true {
		t.Fatalf("each tenant must replay only its own receipt: A=%#v B=%#v", replayA, replayB)
	}

	var receiptA, receiptB string
	var countA, countB int
	if err := adapterA.db.QueryRowContext(ctx, `
		SELECT COUNT(*),MIN(receipt_id)
		FROM console_mutation_receipts
		WHERE tenant_code=? AND operation_code=? AND idempotency_key=?
	`, tenantA, profileUpdateOperation, idempotencyKey).Scan(&countA, &receiptA); err != nil {
		t.Fatal(err)
	}
	if err := adapterB.db.QueryRowContext(ctx, `
		SELECT COUNT(*),MIN(receipt_id)
		FROM console_mutation_receipts
		WHERE tenant_code=? AND operation_code=? AND idempotency_key=?
	`, tenantB, profileUpdateOperation, idempotencyKey).Scan(&countB, &receiptB); err != nil {
		t.Fatal(err)
	}
	if countA != 1 || countB != 1 || receiptA == "" || receiptB == "" || receiptA == receiptB {
		t.Fatalf(
			"tenant receipts must be independent: countA=%d countB=%d receiptA=%q receiptB=%q",
			countA,
			countB,
			receiptA,
			receiptB,
		)
	}
}

func TestRestoredDatabaseRevokesRefreshFamilyOnTokenReuse(t *testing.T) {
	if os.Getenv("HZY_CONSOLE_CUTOVER_INTEGRATION") != "1" {
		t.Skip("set HZY_CONSOLE_CUTOVER_INTEGRATION=1 for restored-database verification")
	}
	port, err := strconv.Atoi(os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PORT"))
	if err != nil || port <= 0 {
		t.Fatal("HZY_CONSOLE_INTEGRATION_DB_PORT is invalid")
	}
	adapter, err := New(config.ConsoleConfig{
		DB: config.DBConfig{
			Host:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_HOST"),
			Port:            port,
			User:            os.Getenv("HZY_CONSOLE_INTEGRATION_DB_USER"),
			Password:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_PASSWORD"),
			Database:        os.Getenv("HZY_CONSOLE_INTEGRATION_DB_NAME"),
			ConnectionLimit: 2,
		},
	}, os.Getenv("HZY_CONSOLE_INTEGRATION_TENANT"))
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()
	ctx := context.Background()

	var uid, clientID string
	var clientPK uint64
	if err := adapter.db.QueryRowContext(ctx, `
		SELECT uid FROM directory_users WHERE status='active' ORDER BY id LIMIT 1
	`).Scan(&uid); err != nil {
		t.Skipf("restored database has no active Directory user: %v", err)
	}
	if err := adapter.db.QueryRowContext(ctx, `
		SELECT id,client_id
		FROM auth_clients
		WHERE status='active' AND auth_mode IN ('oidc','mixed')
		ORDER BY id LIMIT 1
	`).Scan(&clientPK, &clientID); err != nil {
		t.Skipf("restored database has no active OIDC client: %v", err)
	}

	stamp := time.Now().UTC().Format("20060102T150405.000000000")
	sessionDigest := sha256.Sum256([]byte("session:" + stamp))
	tokenDigest := sha256.Sum256([]byte("refresh:" + stamp))
	sessionHash := "sha256_" + hex.EncodeToString(sessionDigest[:])
	tokenHash := "sha256_" + hex.EncodeToString(tokenDigest[:])
	tokenFamily := "restore-reuse-" + stamp
	var sessionPK uint64
	result, err := adapter.db.ExecContext(ctx, `
		INSERT INTO local_sessions (
			session_id,uid,auth_provider,issued_at,expires_at,status,created_at,updated_at
		) VALUES (?,?,'local',UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),
			'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
	`, sessionHash, uid)
	if err != nil {
		t.Fatal(err)
	}
	sessionPK, err = lastInsertID(result)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = adapter.db.ExecContext(context.Background(), `DELETE FROM auth_token_events WHERE token_hash=?`, tokenHash)
		_, _ = adapter.db.ExecContext(context.Background(), `DELETE FROM auth_refresh_tokens WHERE token_family=?`, tokenFamily)
		_, _ = adapter.db.ExecContext(context.Background(), `DELETE FROM local_sessions WHERE id=?`, sessionPK)
	})
	if _, err := adapter.db.ExecContext(ctx, `
		INSERT INTO auth_refresh_tokens (
			token_hash,token_family,client_id,session_id,uid,issued_at,expires_at,status
		) VALUES (?,?,?,?,?,UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),'active')
	`, tokenHash, tokenFamily, clientPK, sessionPK, uid); err != nil {
		t.Fatal(err)
	}

	if _, err := adapter.ConsumeOIDCRefreshToken(ctx, map[string]any{
		"tokenHash": tokenHash,
		"clientId":  clientID,
	}); err != nil {
		t.Fatal(err)
	}
	_, err = adapter.ConsumeOIDCRefreshToken(ctx, map[string]any{
		"tokenHash": tokenHash,
		"clientId":  clientID,
	})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) ||
		httpErr.Status != http.StatusBadRequest ||
		httpErr.Code != "invalid_grant" {
		t.Fatalf("refresh token reuse must fail closed: %T %v", err, err)
	}
	var status string
	var reuseDetectedAt sql.NullTime
	if err := adapter.db.QueryRowContext(ctx, `
		SELECT status,reuse_detected_at
		FROM auth_refresh_tokens
		WHERE token_hash=?
	`, tokenHash).Scan(&status, &reuseDetectedAt); err != nil {
		t.Fatal(err)
	}
	if status != "revoked" || !reuseDetectedAt.Valid {
		t.Fatalf("refresh family was not revoked on reuse: status=%s reuse=%v", status, reuseDetectedAt.Valid)
	}
	var reuseEvents int
	if err := adapter.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM auth_token_events
		WHERE token_hash=? AND event_type='reuse_detected' AND result='failed'
	`, tokenHash).Scan(&reuseEvents); err != nil {
		t.Fatal(err)
	}
	if reuseEvents != 1 {
		t.Fatalf("expected one refresh reuse audit event, got %d", reuseEvents)
	}
}

func profileTenantCode(t *testing.T, response map[string]any) string {
	t.Helper()
	profile, ok := response["data"].(Profile)
	if !ok {
		t.Fatalf("unexpected profile response: %#v", response)
	}
	return profile.TenantCode
}

func profileRevision(t *testing.T, response map[string]any) uint64 {
	t.Helper()
	profile, ok := response["data"].(Profile)
	if !ok {
		t.Fatalf("unexpected profile response: %#v", response)
	}
	return profile.Revision
}

func lastInsertID(result sql.Result) (uint64, error) {
	value, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if value <= 0 {
		return 0, fmt.Errorf("invalid last insert id: %d", value)
	}
	return uint64(value), nil
}
