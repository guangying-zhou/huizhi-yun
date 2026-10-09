package console

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/policyenvelope"
)

func exchangePolicyPayload(environment, tenant, deployment string) string {
	payload, _ := json.Marshal(map[string]any{"tenant": map[string]any{"tenantCode": tenant}, "environment": environment, "policyRevision": 7, "deployments": []any{map[string]any{"deploymentCode": deployment, "environment": environment, "status": "active"}}})
	return string(payload)
}
func exchangePolicyHash() string {
	hash := sha256.Sum256([]byte(exchangePolicyPayload("test", "C000001", "C000001-test-console")))
	return "sha256_" + hex.EncodeToString(hash[:])
}

// A real Platform signature and accepted receipt, never a hand-written digest verdict.
func exchangePolicyFixture(t *testing.T, environment, deployment, version string, change func(*policyenvelope.Body)) (policyenvelope.Store, string) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(public)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	now := time.Now().UnixMilli() - 1000
	body := policyenvelope.Body{Purpose: "enterprise-policy", Issuer: "https://platform.example", Tenant: "C000001", Environment: environment, Deployments: []string{deployment}, BundleVersion: version, PolicyRevision: 7, Status: "active", IssuedAt: now, ExpiresAt: now + 300000}
	if change != nil {
		change(&body)
	}
	body.Payload = exchangePolicyPayload(body.Environment, body.Tenant, body.Deployments[0])
	hash := sha256.Sum256([]byte(body.Payload))
	body.PayloadHash = "sha256_" + hex.EncodeToString(hash[:])
	raw, _ := json.Marshal(body)
	envelope := policyenvelope.Envelope{Schema: policyenvelope.Schema, Alg: "Ed25519", KID: "fixture-platform", Body: string(raw), Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, []byte(policyenvelope.Schema+"\n"+string(raw))))}
	binding := policyenvelope.Context{Issuer: body.Issuer, Tenant: "C000001", Environment: environment, Deployment: deployment, MaxAgeMS: 300000, Now: body.IssuedAt + 1}
	acceptedBinding := binding
	acceptedBinding.Tenant = body.Tenant
	acceptedBinding.Environment = body.Environment
	acceptedBinding.Deployment = body.Deployments[0]
	snapshot, err := policyenvelope.Prepare(envelope, nil, envelope.KID, publicPEM, acceptedBinding)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(snapshot)
	return policyenvelope.Store{Binding: binding, KID: envelope.KID, PublicKey: publicPEM}, string(encoded)
}
func setExchangePolicyFixture(a *Adapter, store policyenvelope.Store) {
	a.SetServiceTokenExchangePolicySource(func(tenant, deployment string) (policyenvelope.Store, error) {
		if tenant != store.Binding.Tenant || deployment != store.Binding.Deployment {
			return policyenvelope.Store{}, errors.New("exact binding mismatch")
		}
		return store, nil
	})
}
func expectVerifiedExchangePolicy(t *testing.T, mock sqlmock.Sqlmock, a *Adapter, version string) {
	t.Helper()
	store, raw := exchangePolicyFixture(t, "test", "C000001-test-console", version, nil)
	setExchangePolicyFixture(a, store)
	mock.ExpectQuery("SELECT snapshot, renewal_state, renewal_attempted_at FROM verified_policy_snapshots WHERE tenant_code=\\? AND environment=\\? AND deployment_code=\\?").WithArgs("C000001", "test", "C000001-test-console").WillReturnRows(sqlmock.NewRows([]string{"snapshot", "renewal_state", "renewal_attempted_at"}).AddRow(raw, "ok", time.Now().UnixMilli()))
}

func TestExchangeVerifiedPolicyRejectsLegacyAndInvalidSnapshots(t *testing.T) {
	for _, tc := range []struct {
		name, environment, version         string
		change                             func(*policyenvelope.Body)
		missing                            bool
		missingTable, hashMismatch, tamper bool
		renewal                            string
		want                               string
	}{
		{name: "test exact snapshot", environment: "test", version: "v7"},
		{name: "prod exact snapshot", environment: "prod", version: "v7"},
		{name: "only legacy matches formal differs", environment: "test", version: "v8", want: "console_exchange_policy_mismatch"},
		{name: "only legacy exists", environment: "test", version: "v7", missing: true, want: "console_exchange_policy_unavailable"},
		{name: "expired lease", environment: "test", version: "v7", change: func(b *policyenvelope.Body) { b.IssuedAt -= 600000; b.ExpiresAt -= 600000 }, want: "console_exchange_policy_unavailable"},
		{name: "wrong tenant", environment: "test", version: "v7", change: func(b *policyenvelope.Body) { b.Tenant = "OTHER" }, want: "console_exchange_policy_unavailable"},
		{name: "wrong deployment", environment: "test", version: "v7", change: func(b *policyenvelope.Body) { b.Deployments = []string{"other-console"} }, want: "console_exchange_policy_unavailable"},
		{name: "wrong environment", environment: "prod", version: "v7", change: func(b *policyenvelope.Body) { b.Environment = "test" }, want: "console_exchange_policy_unavailable"},
		{name: "same version wrong hash", environment: "test", version: "v7", hashMismatch: true, want: "console_exchange_policy_mismatch"},
		{name: "formal table missing", environment: "test", version: "v7", missingTable: true, want: "console_exchange_policy_unavailable"},
		{name: "signature tampered", environment: "test", version: "v7", tamper: true, want: "console_exchange_policy_unavailable"},
		{name: "existing outage grace", environment: "test", version: "v7", renewal: "platform_unavailable", change: func(b *policyenvelope.Body) { b.IssuedAt -= 600000; b.ExpiresAt -= 600000 }},
		{name: "refused renewal grants no grace", environment: "test", version: "v7", renewal: "refused", change: func(b *policyenvelope.Body) { b.IssuedAt -= 600000; b.ExpiresAt -= 600000 }, want: "console_exchange_policy_unavailable"},
		{name: "invalid renewal grants no grace", environment: "test", version: "v7", renewal: "invalid", change: func(b *policyenvelope.Body) { b.IssuedAt -= 600000; b.ExpiresAt -= 600000 }, want: "console_exchange_policy_unavailable"},
		{name: "revoked", environment: "test", version: "v7", change: func(b *policyenvelope.Body) { b.Status = "revoked" }, want: "console_exchange_policy_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			deployment := "C000001-" + tc.environment + "-console"
			store, raw := exchangePolicyFixture(t, tc.environment, deployment, tc.version, tc.change)
			if tc.tamper {
				var snapshot policyenvelope.Snapshot
				_ = json.Unmarshal([]byte(raw), &snapshot)
				snapshot.Envelope.Signature = base64.RawURLEncoding.EncodeToString(make([]byte, ed25519.SignatureSize))
				encoded, _ := json.Marshal(snapshot)
				raw = string(encoded)
			}
			a := &Adapter{db: db, tenant: "C000001"}
			setExchangePolicyFixture(a, store)
			mock.ExpectBegin()
			query := mock.ExpectQuery("SELECT snapshot, renewal_state, renewal_attempted_at FROM verified_policy_snapshots").WithArgs("C000001", tc.environment, deployment)
			if tc.missingTable {
				query.WillReturnError(&mysql.MySQLError{Number: 1146, Message: "fixture table absent"})
			} else if tc.missing {
				query.WillReturnError(sql.ErrNoRows)
			} else {
				renewal := tc.renewal
				if renewal == "" {
					renewal = "ok"
				}
				query.WillReturnRows(sqlmock.NewRows([]string{"snapshot", "renewal_state", "renewal_attempted_at"}).AddRow(raw, renewal, time.Now().UnixMilli()))
			}
			mock.ExpectRollback()
			tx, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			var body policyenvelope.Body
			var snapshot policyenvelope.Snapshot
			_ = json.Unmarshal([]byte(raw), &snapshot)
			_ = json.Unmarshal([]byte(snapshot.Envelope.Body), &body)
			hash := body.PayloadHash
			if tc.hashMismatch {
				hash = "sha256_wrong"
			}
			err = a.verifyServiceTokenExchangePolicy(context.Background(), tx, "C000001", deployment, "v7", hash)
			_ = tx.Rollback()
			if tc.want == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				var known httperror.Error
				if !errors.As(err, &known) || known.Code != tc.want {
					t.Fatalf("error=%v want=%s", err, tc.want)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestExchangeVerifiedPolicyUnconfiguredHasNoLegacyFallback(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectRollback()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	a := &Adapter{db: db, tenant: "C000001"}
	err = a.verifyServiceTokenExchangePolicy(context.Background(), tx, "C000001", "C000001-test-console", "v7", exchangePolicyHash())
	_ = tx.Rollback()
	var known httperror.Error
	if !errors.As(err, &known) || known.Code != "console_exchange_policy_unavailable" {
		t.Fatal("unconfigured verifier must fail closed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
