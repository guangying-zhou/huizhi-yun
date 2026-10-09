package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var policyObjectKey = regexp.MustCompile(`^policy/v1/[a-f0-9]{64}\.json$`)
var policyETag = regexp.MustCompile(`^[a-f0-9]{64}$`)

func policyInvalid() error {
	return httperror.New(http.StatusBadRequest, "console_policy_record_invalid", "Invalid policy snapshot")
}

// Tenant and deployment come exclusively from the authenticated Runtime context.
func (a *Adapter) ReadPolicyBundle(ctx context.Context, tenant, deployment, key string) (map[string]any, error) {
	if tenant == "" || tenant != a.tenant || deployment == "" {
		return nil, httperror.New(403, "console_policy_binding_mismatch", "Policy binding mismatch")
	}
	if !policyObjectKey.MatchString(key) {
		return nil, policyInvalid()
	}
	var body, etag string
	err := a.db.QueryRowContext(ctx, `SELECT envelope,etag FROM policy_bundle_snapshots WHERE tenant_code=? AND deployment_code=? AND object_key=?`, tenant, deployment, key).Scan(&body, &etag)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"body": body, "etag": etag}, nil
}

type policySnapshot struct {
	Scope    string `json:"scope"`
	SyncedAt int64  `json:"syncedAt"`
	Value    struct {
		Tenant     string `json:"tenantCode"`
		Deployment string `json:"deploymentCode"`
		Version    string `json:"bundleVersion"`
		Hash       string `json:"bundleHash"`
		CachedAt   string `json:"cachedAt"`
		Signature  string `json:"signature"`
	} `json:"value"`
}

func validatePolicySnapshot(tenant, deployment, key, body, expected string, now time.Time) (policySnapshot, error) {
	var record policySnapshot
	var envelope struct {
		Body string `json:"body"`
		MAC  string `json:"mac"`
	}
	if !policyObjectKey.MatchString(key) || len(body) > 4*1024*1024 || (expected != "" && !policyETag.MatchString(expected)) {
		return record, policyInvalid()
	}
	if json.Unmarshal([]byte(body), &envelope) != nil || !policyETag.MatchString(envelope.MAC) || json.Unmarshal([]byte(envelope.Body), &record) != nil {
		return record, policyInvalid()
	}
	hash := sha256.Sum256([]byte(record.Scope))
	cachedAt, err := time.Parse(time.RFC3339Nano, record.Value.CachedAt)
	if record.Scope == "" || key != "policy/v1/"+hex.EncodeToString(hash[:])+".json" || err != nil || cachedAt.UnixMilli() != record.SyncedAt || record.SyncedAt > now.UnixMilli() || record.SyncedAt <= now.Add(-5*time.Minute).UnixMilli() || record.Value.Version == "" || len(record.Value.Version) > 191 || record.Value.Hash == "" || len(record.Value.Hash) > 191 || record.Value.Signature == "" {
		return record, policyInvalid()
	}
	// Managed-cloud bundles are tenant/environment-wide, not deployment-wide.
	// The storage row remains bound to the authenticated Console deployment.
	managedScope := false
	for _, environment := range []string{"prod", "test", "dev"} {
		managedScope = managedScope || record.Scope == "managed-cloud-console:"+environment+":"+tenant
	}
	if record.Value.Tenant != tenant || (!managedScope && record.Value.Deployment != deployment) || strings.TrimSpace(deployment) == "" {
		return record, httperror.New(403, "console_policy_binding_mismatch", "Policy binding mismatch")
	}
	return record, nil
}

// Console verifies Platform's Ed25519 signature and seals the envelope before
// writing. Runtime stores opaque signed material, never authorizes from it.
// CAS + strictly increasing sync timestamp prevent concurrent stale overwrites.
// Identical content is an idempotent success; no append-only replay table needed.
func (a *Adapter) WritePolicyBundle(ctx context.Context, tenant, deployment string, body map[string]any, idempotencyKey string) (map[string]any, error) {
	if tenant == "" || tenant != a.tenant || deployment == "" {
		return nil, httperror.New(403, "console_policy_binding_mismatch", "Policy binding mismatch")
	}
	key, raw, expected := stringField(body["key"]), stringField(body["body"]), stringField(body["expectedEtag"])
	if !policyETag.MatchString(idempotencyKey) {
		return nil, httperror.New(400, "idempotency_key_required", "Idempotency-Key required")
	}
	record, err := validatePolicySnapshot(tenant, deployment, key, raw, expected, time.Now())
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256([]byte(raw))
	etag := hex.EncodeToString(digest[:])
	var result sql.Result
	if expected == "" {
		result, err = a.db.ExecContext(ctx, `INSERT INTO policy_bundle_snapshots (tenant_code,deployment_code,object_key,envelope,etag,synced_at_ms,bundle_version,bundle_hash) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE object_key=object_key`, tenant, deployment, key, raw, etag, record.SyncedAt, record.Value.Version, record.Value.Hash)
	} else {
		result, err = a.db.ExecContext(ctx, `UPDATE policy_bundle_snapshots SET envelope=?,etag=?,synced_at_ms=?,bundle_version=?,bundle_hash=? WHERE tenant_code=? AND deployment_code=? AND object_key=? AND etag=? AND synced_at_ms<?`, raw, etag, record.SyncedAt, record.Value.Version, record.Value.Hash, tenant, deployment, key, expected, record.SyncedAt)
	}
	if err != nil {
		return nil, err
	}
	if _, err := result.RowsAffected(); err != nil {
		return nil, err
	}
	// Read back also handles a repeated PUT after the response was lost. If a
	// newer writer won already, report CAS conflict without restoring old content.
	current, err := a.ReadPolicyBundle(ctx, tenant, deployment, key)
	if err != nil {
		return nil, err
	}
	return map[string]any{"stored": current != nil && current["etag"] == etag}, nil
}
