package cutoverprofile

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

func sampleProfile(t *testing.T) (Profile, ed25519.PrivateKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return Profile{
		Version: Version, Tenant: "T900001", Environment: "prod", RuntimeDeployment: "t900001-prod-tenant-runtime", EnterpriseDeployment: "T900001-prod-enterprise",
		SourceDeployments: map[string]string{"aims": "T900001-prod-aims", "assets": "T900001-prod-assets"},
		InstanceID:        "11111111-2222-3333-4444-555555555555", SchemaVersion: "enterprise-v1", Generation: 1,
		SourceAims: "hzy_aims_restore", SourceAssets: "hzy_assets_restore", Target: "hzy_enterprise_prod", CutoverKey: "t900001-prod-cutover-1",
		Connection: Connection{Host: "127.0.0.1", Port: 3306, User: "hzy_cutover", Password: "secret-never-printed"},
		Platform:   Platform{KeyID: "platform-prod-2026", PublicKey: base64.RawURLEncoding.EncodeToString(public)},
		Runtime:    RuntimeService{Listen: "127.0.0.1:18084", SystemdUnit: "hzy-tenant-runtime.service"},
	}, private
}

func writeProfile(t *testing.T, p Profile, mode os.FileMode) string {
	t.Helper()
	raw, _ := json.Marshal(p)
	path := filepath.Join(t.TempDir(), "profile.json")
	if err := os.WriteFile(path, raw, mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestProfileValidationRefusals(t *testing.T) {
	p, _ := sampleProfile(t)
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Profile){
		"unknown environment": func(p *Profile) { p.Environment = "staging" },
		"production alias":    func(p *Profile) { p.Environment = "production" },
		"empty tenant":        func(p *Profile) { p.Tenant = "" },
		"root account":        func(p *Profile) { p.Connection.User = "ROOT" },
		"zero generation":     func(p *Profile) { p.Generation = 0 },
		"same source/target":  func(p *Profile) { p.Target = p.SourceAims },
		"bad schema":          func(p *Profile) { p.Target = "hzy-enterprise" },
		"missing cutover key": func(p *Profile) { p.CutoverKey = "" },
		"missing issuer kid":  func(p *Profile) { p.Platform.KeyID = "" },
		"bad public key":      func(p *Profile) { p.Platform.PublicKey = "AAAA" },
		"one source":          func(p *Profile) { delete(p.SourceDeployments, "assets") },
		"shared source":       func(p *Profile) { p.SourceDeployments["assets"] = p.SourceDeployments["aims"] },
		"bad unit":            func(p *Profile) { p.Runtime.SystemdUnit = "x; rm -rf /" },
		"wrong version":       func(p *Profile) { p.Version = "v0" },
	} {
		t.Run(name, func(t *testing.T) {
			q, _ := sampleProfile(t)
			mutate(&q)
			if err := q.Validate(); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}

func TestProtectedProfileFile(t *testing.T) {
	p, _ := sampleProfile(t)
	path := writeProfile(t, p, 0600)
	loaded, err := Load(path)
	if err != nil || loaded.Tenant != p.Tenant {
		t.Fatal(err)
	}
	if _, err := Load(writeProfile(t, p, 0640)); err == nil {
		t.Fatal("group-readable profile accepted")
	}
	link := filepath.Join(t.TempDir(), "link.json")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(link); err == nil {
		t.Fatal("symlinked profile accepted")
	}
	big := filepath.Join(t.TempDir(), "big.json")
	if err := os.WriteFile(big, []byte(strings.Repeat(" ", MaxProfileSize+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(big); err == nil {
		t.Fatal("oversized profile accepted")
	}
	unknown := filepath.Join(t.TempDir(), "unknown.json")
	raw, _ := json.Marshal(p)
	raw = append(raw[:len(raw)-1], []byte(`,"skipGuards":true}`)...)
	if err := os.WriteFile(unknown, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(unknown); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err := Load(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("missing profile accepted")
	}
	// Errors never echo file content or credentials.
	if _, err := Load(writeProfile(t, p, 0644)); err == nil || strings.Contains(err.Error(), p.Connection.Password) {
		t.Fatal("unexpected error content", err)
	}
}

func signedEnvelope(t *testing.T, p Profile, key ed25519.PrivateKey, mutate func(map[string]any)) Envelope {
	t.Helper()
	payload := map[string]any{"type": "enterprise-external-drain-approval.v1", "tenant": p.Tenant, "environment": p.Environment, "cutoverKey": p.CutoverKey, "generation": "1", "report": map[string]any{"binding": map[string]any{"tenant": p.Tenant, "environment": p.Environment, "runtimeDeployment": p.RuntimeDeployment, "instanceId": p.InstanceID}}}
	if mutate != nil {
		mutate(payload)
	}
	raw, _ := json.Marshal(payload)
	return Envelope{Payload: string(raw), Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, raw)), Alg: "Ed25519", Kid: p.Platform.KeyID, PublicKey: p.Platform.PublicKey}
}

func TestEnvelopeRequiresPinnedIssuerSignature(t *testing.T) {
	p, key := sampleProfile(t)
	if _, _, err := p.VerifyEnvelope(signedEnvelope(t, p, key, nil)); err != nil {
		t.Fatal(err)
	}
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	cases := map[string]Envelope{}
	unsigned := signedEnvelope(t, p, key, nil)
	unsigned.Signature = ""
	cases["unsigned"] = unsigned
	cases["signed by another key"] = signedEnvelope(t, p, otherKey, nil)
	selfSigned := signedEnvelope(t, p, otherKey, nil)
	selfSigned.PublicKey = base64.RawURLEncoding.EncodeToString(otherKey.Public().(ed25519.PublicKey))
	cases["self-signed with embedded key"] = selfSigned
	wrongKid := signedEnvelope(t, p, key, nil)
	wrongKid.Kid = "platform-test"
	cases["wrong issuer kid"] = wrongKid
	wrongAlg := signedEnvelope(t, p, key, nil)
	wrongAlg.Alg = "HS256"
	cases["wrong algorithm"] = wrongAlg
	tampered := signedEnvelope(t, p, key, nil)
	tampered.Payload += " "
	cases["tampered payload"] = tampered
	cases["other tenant"] = signedEnvelope(t, p, key, func(m map[string]any) { m["tenant"] = "C000001" })
	cases["other environment"] = signedEnvelope(t, p, key, func(m map[string]any) { m["environment"] = "test" })
	cases["other runtime binding"] = signedEnvelope(t, p, key, func(m map[string]any) {
		m["report"] = map[string]any{"binding": map[string]any{"tenant": p.Tenant, "environment": p.Environment, "runtimeDeployment": "c000001-test-tenant-runtime", "instanceId": p.InstanceID}}
	})
	cases["other cutover key"] = signedEnvelope(t, p, key, func(m map[string]any) { m["cutoverKey"] = "other" })
	cases["other generation"] = signedEnvelope(t, p, key, func(m map[string]any) { m["generation"] = "2" })
	cases["other type"] = signedEnvelope(t, p, key, func(m map[string]any) { m["type"] = "enterprise-recovery-route.v1" })
	for name, envelope := range cases {
		t.Run(name, func(t *testing.T) {
			if _, _, err := p.VerifyEnvelope(envelope); err == nil || !errors.Is(err, ErrProfile) {
				t.Fatal("accepted", err)
			}
		})
	}
}

// The fixture is signed by Platform TypeScript with its active fixture key.
// No Go signing helper participates in the positive cross-language assertion.
func TestPlatformSignedDrainApprovalFixture(t *testing.T) {
	path := os.Getenv("HZY_K2P_DRAIN_FIXTURE")
	if path == "" {
		t.Skip("isolated Platform signer fixture not supplied")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Envelope Envelope `json:"envelope"`
		Profile  struct {
			Tenant, Environment, RuntimeDeployment, InstanceID, CutoverKey, Generation, KeyID, PublicKey string
		} `json:"profile"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	p := Profile{Tenant: fixture.Profile.Tenant, Environment: fixture.Profile.Environment,
		RuntimeDeployment: fixture.Profile.RuntimeDeployment, InstanceID: fixture.Profile.InstanceID,
		CutoverKey: fixture.Profile.CutoverKey, Platform: Platform{KeyID: fixture.Profile.KeyID, PublicKey: fixture.Profile.PublicKey}}
	generation, err := strconv.ParseUint(fixture.Profile.Generation, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	p.Generation = generation
	if _, _, err := p.VerifyEnvelope(fixture.Envelope); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*Profile){
		"tenant":             func(p *Profile) { p.Tenant += "X" },
		"environment":        func(p *Profile) { p.Environment = "test" },
		"runtime deployment": func(p *Profile) { p.RuntimeDeployment += "X" },
		"instance id":        func(p *Profile) { p.InstanceID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
		"cutover key":        func(p *Profile) { p.CutoverKey += "X" },
		"generation":         func(p *Profile) { p.Generation++ },
	} {
		t.Run(name, func(t *testing.T) {
			other := p
			mutate(&other)
			if _, _, err := other.VerifyEnvelope(fixture.Envelope); err == nil {
				t.Fatal("accepted mismatched Platform binding")
			}
		})
	}
}

func TestPlanBindingAndReviewGuards(t *testing.T) {
	p, _ := sampleProfile(t)
	plan := unified.Plan{Version: "enterprise-shadow-copy.v1", Config: p.Migration()}
	plan.ReviewHash = unified.ReviewHash(plan)
	if err := p.CheckPlanIdentity(plan); err != nil {
		t.Fatal(err)
	}
	other := plan
	other.Config.Tenant = "C000001"
	other.ReviewHash = unified.ReviewHash(other)
	if p.CheckPlanIdentity(other) == nil {
		t.Fatal("cross-tenant plan accepted")
	}
	stale := plan
	stale.Version = "changed"
	if p.CheckPlanIdentity(stale) == nil {
		t.Fatal("stale review hash accepted")
	}
	if RequireReview(false, plan.ReviewHash, plan.ReviewHash) == nil || RequireReview(true, "", plan.ReviewHash) == nil || RequireReview(true, "x", plan.ReviewHash) == nil || RequireReview(true, "", "") == nil {
		t.Fatal("missing/incorrect review accepted")
	}
	if RequireReview(true, plan.ReviewHash, plan.ReviewHash) != nil {
		t.Fatal("exact review rejected")
	}
	b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: p.Tenant, Environment: p.Environment, RuntimeDeployment: p.RuntimeDeployment}, Storage: enterprise.Storage{InstanceID: strings.ToUpper(p.InstanceID), Database: p.Target}, SchemaVersion: p.SchemaVersion, Generation: 1, Domains: map[string]enterprise.DomainBinding{"aims": {OwnerDeployment: p.EnterpriseDeployment}}}
	if err := p.CheckBinding(b, 1); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*enterprise.Binding){
		"tenant":     func(b *enterprise.Binding) { b.Key.Tenant = "C000001" },
		"env":        func(b *enterprise.Binding) { b.Key.Environment = "test" },
		"target":     func(b *enterprise.Binding) { b.Storage.Database = "hzy_other" },
		"generation": func(b *enterprise.Binding) { b.Generation = 2 },
		"owner": func(b *enterprise.Binding) {
			b.Domains["aims"] = enterprise.DomainBinding{OwnerDeployment: "C000001-test-enterprise"}
		},
	} {
		c := b
		c.Domains = map[string]enterprise.DomainBinding{"aims": b.Domains["aims"]}
		mutate(&c)
		if p.CheckBinding(c, 1) == nil {
			t.Fatal(name, "mismatch accepted")
		}
	}
}

func TestStoppedEvidenceParsers(t *testing.T) {
	if !SystemdStopped("disabled\n", "inactive\n") || !SystemdStopped("masked", "failed") {
		t.Fatal("explicit stopped rejected")
	}
	for _, v := range [][2]string{{"enabled", "inactive"}, {"disabled", "active"}, {"static", "inactive"}, {"", ""}, {"disabled", "activating"}} {
		if SystemdStopped(v[0], v[1]) {
			t.Fatal("unproven stop accepted", v)
		}
	}
	label := "cn.example.hzy-runtime"
	if !LaunchdDisabled(`"cn.example.hzy-runtime" => disabled`, label) || LaunchdDisabled(`"cn.example.hzy-runtime" => enabled`, label) || LaunchdDisabled(`"cn.example.hzy-runtime-2" => disabled`, label) {
		t.Fatal("launchd parser mismatch")
	}
	p, _ := sampleProfile(t)
	p.Runtime = RuntimeService{}
	if p.RuntimeStopped(t.Context()) == nil {
		t.Fatal("incomplete runtime service accepted as stopped")
	}
}
