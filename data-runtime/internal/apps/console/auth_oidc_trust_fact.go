package console

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const oidcTrustFactOperation = "console.auth.oidc.trust.initialize"

// OIDCTrustFact contains public trust and enrolled binding facts only. No key,
// token or caller-provided unverified envelope belongs in this receipt.
type OIDCTrustFact struct {
	TenantCode     string `json:"tenantCode"`
	DeploymentCode string `json:"deploymentCode"`
	RuntimeCode    string `json:"runtimeCode"`
	Issuer         string `json:"issuer"`
	Audience       string `json:"audience"`
	JWKSURL        string `json:"jwksUrl"`
}

func (f OIDCTrustFact) normalized() OIDCTrustFact {
	f.TenantCode = strings.TrimSpace(f.TenantCode)
	f.DeploymentCode = strings.TrimSpace(f.DeploymentCode)
	f.RuntimeCode = strings.TrimSpace(f.RuntimeCode)
	f.Issuer = strings.TrimRight(strings.TrimSpace(f.Issuer), "/")
	f.Audience = strings.TrimSpace(f.Audience)
	f.JWKSURL = strings.TrimSpace(f.JWKSURL)
	return f
}

func oidcTrustFactKey(tenant, deployment, runtime string) string {
	b, _ := json.Marshal([]string{tenant, deployment, runtime})
	digest := sha256.Sum256(b)
	return "trust:" + hex.EncodeToString(digest[:])
}

func oidcTrustFactDigest(f OIDCTrustFact) string {
	b, _ := json.Marshal(f)
	digest := sha256.Sum256(b)
	return hex.EncodeToString(digest[:])
}

func oidcTrustImmutableError() error {
	return httperror.New(http.StatusConflict, "console_oidc_bootstrap_jwt_trust_immutable", "Shared Console OIDC JWT trust is already initialized with different values")
}

// EnsureOIDCTrustFact reserves the immutable trust before consuming any JTI or
// bootstrapping keys. A later custody/disk failure can resume only these same
// facts; it never makes another trust root permissible. The unique receipt and
// transaction serialize even instances with an empty local config directory.
func (a *Adapter) EnsureOIDCTrustFact(ctx context.Context, fact OIDCTrustFact, meta AuditMutationMeta) error {
	fact = fact.normalized()
	if fact.TenantCode != a.tenant || fact.DeploymentCode == "" || fact.RuntimeCode == "" || fact.Issuer == "" || fact.Audience == "" || fact.JWKSURL == "" {
		return httperror.New(http.StatusServiceUnavailable, "console_oidc_bootstrap_trust_binding_unavailable", "Shared OIDC trust binding is incomplete")
	}
	session, replay, err := a.beginMutationAs(ctx, oidcTrustFactOperation, oidcTrustFactKey(fact.TenantCode, fact.DeploymentCode, fact.RuntimeCode), meta.RequestID, "system", "platform:tenant-owner", fact)
	if err != nil {
		var known httperror.Error
		if errors.As(err, &known) && known.Code == "idempotency_payload_mismatch" {
			return oidcTrustImmutableError()
		}
		return err
	}
	if replay != nil {
		stored, err := decodeOIDCTrustFact(replay, fact.TenantCode, fact.DeploymentCode, fact.RuntimeCode)
		if err != nil {
			return err
		}
		if stored != fact {
			return oidcTrustImmutableError()
		}
		return nil
	}
	defer session.tx.Rollback()
	return a.finishMutation(ctx, session, "console", "auth.oidc.trust.initialize", "oidc_trust", fact.RuntimeCode, map[string]any{"trustSha256": oidcTrustFactDigest(fact)}, map[string]any{"fact": fact, "sha256": oidcTrustFactDigest(fact)})
}

func decodeOIDCTrustFact(result map[string]any, tenant, deployment, runtime string) (OIDCTrustFact, error) {
	raw, err := json.Marshal(result["fact"])
	var fact OIDCTrustFact
	if err == nil {
		err = json.Unmarshal(raw, &fact)
	}
	if err != nil || fact != fact.normalized() || fact.TenantCode != tenant || fact.DeploymentCode != deployment || fact.RuntimeCode != runtime || fact.Issuer == "" || fact.Audience == "" || fact.JWKSURL == "" || result["sha256"] != oidcTrustFactDigest(fact) {
		return OIDCTrustFact{}, httperror.New(http.StatusServiceUnavailable, "console_oidc_bootstrap_trust_receipt_invalid", "Shared OIDC trust receipt is invalid")
	}
	return fact, nil
}

func (a *Adapter) ReadOIDCTrustFact(ctx context.Context, deployment, runtime string) (OIDCTrustFact, bool, error) {
	deployment, runtime = strings.TrimSpace(deployment), strings.TrimSpace(runtime)
	var status string
	var result sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT status,result_json FROM console_mutation_receipts WHERE tenant_code=? AND operation_code=? AND idempotency_key=?`, a.tenant, oidcTrustFactOperation, oidcTrustFactKey(a.tenant, deployment, runtime)).Scan(&status, &result)
	if errors.Is(err, sql.ErrNoRows) {
		return OIDCTrustFact{}, false, nil
	}
	if err != nil {
		return OIDCTrustFact{}, false, err
	}
	var decoded map[string]any
	if status != "succeeded" || !result.Valid || json.Unmarshal([]byte(result.String), &decoded) != nil {
		return OIDCTrustFact{}, false, httperror.New(http.StatusServiceUnavailable, "console_oidc_bootstrap_trust_receipt_invalid", "Shared OIDC trust receipt is invalid")
	}
	fact, err := decodeOIDCTrustFact(decoded, a.tenant, deployment, runtime)
	return fact, err == nil, err
}
