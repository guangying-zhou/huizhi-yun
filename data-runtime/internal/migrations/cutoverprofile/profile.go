// Package cutoverprofile parameterizes the reviewed ADR-018 cutover protocol
// (install-fence -> fence -> prepare-final -> final apply -> compatibility views
// -> drain activate -> domain install -> verify-views) for an explicit tenant
// and environment. It adds no new trust path: every phase still calls the same
// unified/enterprise/domaininstall functions, every write still requires an
// exact reviewed hash, and activation still requires a Platform-signed drain
// approval verified against a pinned key. The profile only replaces the fixed
// C000001/test constants with a protected, reviewed identity.
package cutoverprofile

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

const (
	Version = "enterprise-cutover-profile.v1"
	// MaxFileSize bounds every protected input (profile, plan, approval,
	// Runtime config). Real final plans with ~150 tables stay far below this.
	MaxFileSize = 32 << 20
	// MaxProfileSize bounds the profile itself; it holds identity, not data.
	MaxProfileSize = 64 << 10
)

// ErrProfile is intentionally generic: messages must never echo a DSN,
// password or file content.
var ErrProfile = errors.New("cutover profile rejected")

// ErrTargetActive refuses every forward-cutover write against a target whose
// registry generation is already non-zero. Recovery of an active target must
// use the separately reviewed recovery path (hzy-enterprise-migrate --recovery
// and hzy-enterprise-recover), never a re-run of the forward protocol.
var ErrTargetActive = errors.New("target already has an active generation; use the reviewed recovery path (hzy-enterprise-migrate --recovery / hzy-enterprise-recover)")

type Connection struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
}

// Platform pins the drain approval issuer: the Platform signing key id (kid)
// and its raw Ed25519 public key (base64url). The envelope's own publicKey is
// never trusted; it must be absent or byte-equal to this pinned key.
type Platform struct {
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
}

// RuntimeService names the Runtime process that must be proven stopped before
// domain DDL is installed into an activated target.
type RuntimeService struct {
	Listen       string `json:"listen"`
	SystemdUnit  string `json:"systemdUnit,omitempty"`
	LaunchdLabel string `json:"launchdLabel,omitempty"`
}

type Profile struct {
	Version              string            `json:"version"`
	Tenant               string            `json:"tenant"`
	Environment          string            `json:"environment"`
	RuntimeDeployment    string            `json:"runtimeDeployment"`
	EnterpriseDeployment string            `json:"enterpriseDeployment"`
	SourceDeployments    map[string]string `json:"sourceDeployments"`
	InstanceID           string            `json:"instanceId"`
	SchemaVersion        string            `json:"schemaVersion"`
	Generation           uint64            `json:"generation"`
	SourceAims           string            `json:"sourceAims"`
	SourceAssets         string            `json:"sourceAssets"`
	Target               string            `json:"target"`
	CutoverKey           string            `json:"cutoverKey"`
	Connection           Connection        `json:"connection"`
	Platform             Platform          `json:"platform"`
	Runtime              RuntimeService    `json:"runtime"`
}

var (
	codePattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	deploymentPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)
	schemaPattern     = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	keyPattern        = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$`)
	unitPattern       = regexp.MustCompile(`^[A-Za-z0-9@._-]{1,200}\.service$`)
	labelPattern      = regexp.MustCompile(`^[A-Za-z0-9._-]{1,200}$`)
	userPattern       = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,32}$`)
)

// AllowedEnvironment matches the Platform policy verifier's environment set.
func AllowedEnvironment(environment string) bool {
	return environment == "prod" || environment == "test" || environment == "dev"
}

// ReadProtected opens a local input with O_NOFOLLOW, requires a regular file
// owned by the current user with no group/other permission bits, and reads at
// most limit bytes. It never includes file content in an error.
func ReadProtected(path string, limit int64) ([]byte, error) {
	if path == "" || limit <= 0 {
		return nil, ErrProfile
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrProfile
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > limit {
		return nil, ErrProfile
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return nil, ErrProfile
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, ErrProfile
	}
	return raw, nil
}

// ReadProtectedJSON strictly decodes a protected file into value.
func ReadProtectedJSON(path string, value any) error {
	raw, err := ReadProtected(path, MaxFileSize)
	if err != nil {
		return err
	}
	if json.Unmarshal(raw, value) != nil {
		return ErrProfile
	}
	return nil
}

// Load reads and validates a protected profile. Unknown fields are refused so
// a typo cannot silently disable a guard.
func Load(path string) (Profile, error) {
	var p Profile
	raw, err := ReadProtected(path, MaxProfileSize)
	if err != nil {
		return p, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&p) != nil || decoder.More() {
		return Profile{}, ErrProfile
	}
	if err := p.Validate(); err != nil {
		return Profile{}, err
	}
	return p, nil
}

func (p Profile) Validate() error {
	fail := func(reason string) error { return fmt.Errorf("%w: %s", ErrProfile, reason) }
	if p.Version != Version {
		return fail("unsupported profile version")
	}
	if !AllowedEnvironment(p.Environment) {
		return fail("environment must be prod, test or dev")
	}
	if !codePattern.MatchString(p.Tenant) {
		return fail("tenant code invalid")
	}
	for _, d := range []string{p.RuntimeDeployment, p.EnterpriseDeployment, p.SourceDeployments["aims"], p.SourceDeployments["assets"]} {
		if !deploymentPattern.MatchString(d) {
			return fail("deployment code invalid")
		}
	}
	if len(p.SourceDeployments) != 2 || p.SourceDeployments["aims"] == p.SourceDeployments["assets"] {
		return fail("exactly two distinct source deployments (aims, assets) required")
	}
	if strings.TrimSpace(p.InstanceID) == "" || strings.TrimSpace(p.SchemaVersion) == "" || p.Generation == 0 {
		return fail("instance, schema version and non-zero generation required")
	}
	for _, s := range []string{p.SourceAims, p.SourceAssets, p.Target} {
		if !schemaPattern.MatchString(s) {
			return fail("schema name invalid")
		}
	}
	if p.SourceAims == p.SourceAssets || p.Target == p.SourceAims || p.Target == p.SourceAssets {
		return fail("separate source/target schemas required")
	}
	if !keyPattern.MatchString(p.CutoverKey) {
		return fail("stable cutover key required")
	}
	c := p.Connection
	if c.Host == "" || strings.TrimSpace(c.Host) != c.Host || c.Port < 1 || c.Port > 65535 || !userPattern.MatchString(c.User) {
		return fail("migration connection incomplete")
	}
	if strings.EqualFold(c.User, "root") {
		return fail("root is refused; use the dedicated least-privilege cutover account")
	}
	if !keyPattern.MatchString(p.Platform.KeyID) {
		return fail("pinned Platform signing key id required")
	}
	if _, err := p.PinnedPlatformKey(); err != nil {
		return fail("pinned Platform Ed25519 public key required")
	}
	if p.Runtime.Listen != "" {
		host, port, err := net.SplitHostPort(p.Runtime.Listen)
		if n, perr := strconv.Atoi(port); err != nil || host == "" || perr != nil || n < 1 || n > 65535 {
			return fail("runtime listen address invalid")
		}
	}
	if p.Runtime.SystemdUnit != "" && !unitPattern.MatchString(p.Runtime.SystemdUnit) {
		return fail("systemd unit invalid")
	}
	if p.Runtime.LaunchdLabel != "" && !labelPattern.MatchString(p.Runtime.LaunchdLabel) {
		return fail("launchd label invalid")
	}
	return nil
}

// Migration is the exact unified.Config that every plan must carry.
func (p Profile) Migration() unified.Config {
	return unified.Config{Tenant: p.Tenant, Environment: p.Environment, RuntimeDeployment: p.RuntimeDeployment, InstanceID: p.InstanceID, SchemaVersion: p.SchemaVersion, Generation: p.Generation, SourceAims: p.SourceAims, SourceAssets: p.SourceAssets, Target: p.Target}
}

// Address is the canonical host:port of the migration connection.
func (p Profile) Address() string {
	return net.JoinHostPort(p.Connection.Host, strconv.Itoa(p.Connection.Port))
}

// MySQL returns a driver config for the least-privilege cutover account. The
// DSN is never printed by callers.
func (p Profile) MySQL(database string) *mysql.Config {
	mc := mysql.NewConfig()
	mc.User, mc.Passwd, mc.Net, mc.Addr, mc.DBName = p.Connection.User, p.Connection.Password, "tcp", p.Address(), database
	mc.Params = map[string]string{"time_zone": "'+00:00'"}
	mc.Timeout, mc.ReadTimeout, mc.WriteTimeout = 5*time.Second, 60*time.Second, 60*time.Second
	return mc
}

func (p Profile) PinnedPlatformKey() (ed25519.PublicKey, error) {
	raw, err := base64.RawURLEncoding.DecodeString(p.Platform.PublicKey)
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, ErrProfile
	}
	return ed25519.PublicKey(raw), nil
}

// CheckPlanIdentity binds a reviewed plan to the profile.
func (p Profile) CheckPlanIdentity(plan unified.Plan) error {
	if plan.Config != p.Migration() || plan.ReviewHash == "" || unified.ReviewHash(plan) != plan.ReviewHash {
		return fmt.Errorf("%w: plan identity differs from profile or plan hash invalid", ErrProfile)
	}
	return nil
}

// RequireReview enforces "dry-run by default; every write names the exact
// reviewed hash".
func RequireReview(apply bool, supplied, reviewed string) error {
	if !apply {
		return fmt.Errorf("%w: write phase requires --apply", ErrProfile)
	}
	if reviewed == "" || supplied != reviewed {
		return fmt.Errorf("%w: exact reviewed hash required for this write", ErrProfile)
	}
	return nil
}

// CheckBinding binds a Runtime config binding to the profile (tenant,
// environment, runtime deployment, storage, generation, domain owner).
func (p Profile) CheckBinding(b enterprise.Binding, wantGeneration uint64) error {
	if b.Key != (enterprise.BindingKey{Tenant: p.Tenant, Environment: p.Environment, RuntimeDeployment: p.RuntimeDeployment}) || !strings.EqualFold(b.Storage.InstanceID, p.InstanceID) || b.Storage.Database != p.Target || b.SchemaVersion != p.SchemaVersion || b.Generation != wantGeneration {
		return fmt.Errorf("%w: Runtime binding identity differs from profile", ErrProfile)
	}
	for _, domain := range []string{"aims", "assets"} {
		if d, ok := b.Domains[domain]; ok && d.OwnerDeployment != p.EnterpriseDeployment {
			return fmt.Errorf("%w: domain owner deployment differs from profile", ErrProfile)
		}
	}
	return nil
}

// CheckRuntimeConfig verifies a Runtime config names the profile tenant and
// runtime deployment before its enterprise binding is trusted.
func (p Profile) CheckRuntimeConfig(cfg config.Config) error {
	if cfg.Tenant != p.Tenant || cfg.Deployment != p.RuntimeDeployment || cfg.Enterprise.Environment != p.Environment {
		return fmt.Errorf("%w: Runtime config tenant/deployment/environment differs from profile", ErrProfile)
	}
	return nil
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// CheckAccount refuses root and accounts holding global administrative power.
// Grants are schema-scoped by design; see the cutover protocol doc §9.
func CheckAccount(ctx context.Context, q queryer) error {
	var current string
	if err := q.QueryRowContext(ctx, "SELECT CURRENT_USER()").Scan(&current); err != nil {
		return fmt.Errorf("%w: account identity unavailable", ErrProfile)
	}
	if user, _, _ := strings.Cut(current, "@"); strings.EqualFold(user, "root") {
		return fmt.Errorf("%w: root is refused", ErrProfile)
	}
	rows, err := q.QueryContext(ctx, "SHOW GRANTS")
	if err != nil {
		return fmt.Errorf("%w: account grants unavailable", ErrProfile)
	}
	defer rows.Close()
	for rows.Next() {
		var grant string
		if err := rows.Scan(&grant); err != nil {
			return fmt.Errorf("%w: account grants unavailable", ErrProfile)
		}
		upper := strings.ToUpper(grant)
		if strings.Contains(upper, " ON *.* ") && (strings.Contains(upper, "ALL PRIVILEGES") || strings.Contains(upper, "SUPER") || strings.Contains(upper, "WITH GRANT OPTION") || strings.Contains(upper, "SYSTEM_USER") || strings.Contains(upper, "SET_USER_ID") || strings.Contains(upper, "CREATE USER")) {
			return fmt.Errorf("%w: account holds global administrative privileges; use the least-privilege cutover account", ErrProfile)
		}
	}
	if rows.Err() != nil {
		return fmt.Errorf("%w: account grants unavailable", ErrProfile)
	}
	return nil
}

// CheckInstance binds the live server to the profile's instance id.
func (p Profile) CheckInstance(ctx context.Context, q queryer) error {
	var instance string
	if err := q.QueryRowContext(ctx, "SELECT @@server_uuid").Scan(&instance); err != nil || !strings.EqualFold(instance, p.InstanceID) {
		return fmt.Errorf("%w: MySQL instance differs from profile", ErrProfile)
	}
	return nil
}

func tableExists(ctx context.Context, q queryer, schema, table string) (bool, error) {
	var n int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", schema, table).Scan(&n); err != nil {
		return false, err
	}
	return n != 0, nil
}

func quote(name string) string { return "`" + name + "`" }

// TargetState is the read-only view of the final target used by the guards.
type TargetState struct {
	Exists       bool
	Registry     bool
	Generation   uint64
	LedgerStatus string
	LedgerHash   string
}

// InspectTarget reads the target registry and ledger. A registry row naming a
// different tenant/environment/runtime/schema version is always refused.
func (p Profile) InspectTarget(ctx context.Context, q queryer) (TargetState, error) {
	var state TargetState
	var n int
	if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", p.Target).Scan(&n); err != nil {
		return state, fmt.Errorf("%w: target inspection failed", ErrProfile)
	}
	if n == 0 {
		return state, nil
	}
	state.Exists = true
	ok, err := tableExists(ctx, q, p.Target, "enterprise_schema_registry")
	if err != nil {
		return state, fmt.Errorf("%w: target inspection failed", ErrProfile)
	}
	if ok {
		var tenant, environment, deployment, version string
		if err := q.QueryRowContext(ctx, "SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM "+quote(p.Target)+".`enterprise_schema_registry` WHERE id=1").Scan(&tenant, &environment, &deployment, &version, &state.Generation); err != nil {
			return state, fmt.Errorf("%w: target registry unreadable", ErrProfile)
		}
		if tenant != p.Tenant || environment != p.Environment || deployment != p.RuntimeDeployment || version != p.SchemaVersion {
			return state, fmt.Errorf("%w: target registry belongs to another tenant/environment/runtime", ErrProfile)
		}
		state.Registry = true
	}
	ok, err = tableExists(ctx, q, p.Target, "enterprise_migration_ledger")
	if err != nil {
		return state, fmt.Errorf("%w: target inspection failed", ErrProfile)
	}
	if ok {
		if err := q.QueryRowContext(ctx, "SELECT review_hash,status FROM "+quote(p.Target)+".`enterprise_migration_ledger` WHERE id=1").Scan(&state.LedgerHash, &state.LedgerStatus); err != nil {
			return state, fmt.Errorf("%w: target ledger unreadable", ErrProfile)
		}
	}
	return state, nil
}

// RequireInactiveTarget is the forward-protocol guard: an active generation or
// an active ledger is never re-entered by install-fence/fence/prepare-final/
// apply/view installation.
func (p Profile) RequireInactiveTarget(ctx context.Context, q queryer) (TargetState, error) {
	state, err := p.InspectTarget(ctx, q)
	if err != nil {
		return state, err
	}
	if state.Generation != 0 || state.LedgerStatus == "active" {
		return state, ErrTargetActive
	}
	return state, nil
}

// CheckSourceFences refuses a source fence row installed for another tenant.
func (p Profile) CheckSourceFences(ctx context.Context, q queryer) error {
	for _, schema := range []string{p.SourceAims, p.SourceAssets} {
		ok, err := tableExists(ctx, q, schema, "enterprise_source_fence")
		if err != nil {
			return fmt.Errorf("%w: source inspection failed", ErrProfile)
		}
		if !ok {
			continue
		}
		var tenant string
		err = q.QueryRowContext(ctx, "SELECT tenant_code FROM "+quote(schema)+".`enterprise_source_fence` WHERE id=1").Scan(&tenant)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil || tenant != p.Tenant {
			return fmt.Errorf("%w: source fence belongs to another tenant", ErrProfile)
		}
	}
	return nil
}

// RequireFencedSources is the final-apply guard: in profile mode only a
// post-fence final copy may be applied to the final target.
func (p Profile) RequireFencedSources(ctx context.Context, q queryer) error {
	for _, schema := range []string{p.SourceAims, p.SourceAssets} {
		var tenant, state string
		var key sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT tenant_code,state,transition_key FROM "+quote(schema)+".`enterprise_source_fence` WHERE id=1").Scan(&tenant, &state, &key); err != nil || tenant != p.Tenant || state != "fenced" || !key.Valid || key.String != p.CutoverKey {
			return fmt.Errorf("%w: both sources must be fenced with the profile cutover key before the final copy", ErrProfile)
		}
	}
	return nil
}

// ActivationReplay reports whether the target already holds the exact
// activation receipt for this cutover key, review hash and generation.
func (p Profile) ActivationReplay(ctx context.Context, q queryer, reviewHash string) (bool, error) {
	ok, err := tableExists(ctx, q, p.Target, "enterprise_cutover_receipt")
	if err != nil || !ok {
		return false, err
	}
	var review string
	var generation uint64
	err = q.QueryRowContext(ctx, "SELECT review_hash,generation FROM "+quote(p.Target)+".`enterprise_cutover_receipt` WHERE operation_key=?", p.CutoverKey).Scan(&review, &generation)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return review == reviewHash && generation == p.Generation, nil
}

// Envelope is the Platform drain-approval signing response. Payload is the
// exact signed text; Kid names the signing key; PublicKey is informational
// and must equal the pinned key when present.
type Envelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
	Alg       string `json:"alg"`
	Kid       string `json:"kid"`
	PublicKey string `json:"publicKey"`
}

// VerifyEnvelope checks the pinned issuer key id and public key, the Ed25519
// signature, and the signed tenant/environment/cutover/generation/runtime
// binding before the SQL drain verifier re-checks the full closure in the
// activation transaction. There is no unsigned or self-signed path.
func (p Profile) VerifyEnvelope(e Envelope) ([]byte, []byte, error) {
	fail := func(reason string) ([]byte, []byte, error) {
		return nil, nil, fmt.Errorf("%w: drain approval %s", ErrProfile, reason)
	}
	key, err := p.PinnedPlatformKey()
	if err != nil {
		return fail("pinned key unavailable")
	}
	if e.Alg != "Ed25519" || e.Kid != p.Platform.KeyID {
		return fail("issuer key id or algorithm mismatch")
	}
	if e.PublicKey != "" && e.PublicKey != p.Platform.PublicKey {
		return fail("embedded public key differs from pinned issuer")
	}
	signature, err := base64.RawURLEncoding.DecodeString(e.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize || e.Payload == "" {
		return fail("signature missing or malformed")
	}
	payload := []byte(e.Payload)
	if !ed25519.Verify(key, payload, signature) {
		return fail("signature invalid for pinned issuer")
	}
	var wire struct {
		Type, Tenant, Environment, CutoverKey, Generation string
		Report                                            struct {
			Binding struct{ Tenant, Environment, RuntimeDeployment, InstanceID string }
		}
	}
	if json.Unmarshal(payload, &wire) != nil {
		return fail("payload invalid")
	}
	b := wire.Report.Binding
	if wire.Type != "enterprise-external-drain-approval.v1" || wire.Tenant != p.Tenant || wire.Environment != p.Environment || b.Tenant != p.Tenant || b.Environment != p.Environment || b.RuntimeDeployment != p.RuntimeDeployment || !strings.EqualFold(b.InstanceID, p.InstanceID) {
		return fail("tenant/environment/runtime differs from profile")
	}
	if wire.CutoverKey != p.CutoverKey || wire.Generation != strconv.FormatUint(p.Generation, 10) {
		return fail("cutover key or generation differs from profile")
	}
	return payload, signature, nil
}

// Redact keeps protocol refusal reasons but replaces driver/server errors with
// their numeric code so no SQL value, host or credential reaches output.
func Redact(err error) error {
	if err == nil {
		return nil
	}
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		return fmt.Errorf("MySQL rejected the operation (code %d); SQL values withheld", mysqlErr.Number)
	}
	var netErr net.Error
	if errors.As(err, &netErr) || errors.Is(err, mysql.ErrInvalidConn) || errors.Is(err, context.DeadlineExceeded) {
		return errors.New("database connection unavailable or timed out")
	}
	return err
}

// Summary is the only profile-derived output a tool prints: identities and
// hashes, never connection data.
func (p Profile) Summary() string {
	return fmt.Sprintf("tenant=%s environment=%s runtime=%s target=%s generation=%d", p.Tenant, p.Environment, p.RuntimeDeployment, p.Target, p.Generation)
}
