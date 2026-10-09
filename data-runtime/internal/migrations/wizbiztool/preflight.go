package wizbiztool

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/config"
	runtimedb "github.com/huizhi-yun/data-runtime/internal/db"
	"os"
	"sort"
	"strings"
	"syscall"
	"time"
)

type PreflightCheck struct {
	Name     string `json:"name"`
	Required bool   `json:"required"`
	Ready    bool   `json:"ready"`
	Code     string `json:"code"`
}
type PreflightReport struct {
	Ready  bool             `json:"ready"`
	Phase  string           `json:"phase"`
	Checks []PreflightCheck `json:"checks"`
}

// Preflight performs only reads before any maintenance window. A failed identity
// never short-circuits the remaining identities. It does not authorize apply or
// replace the stopped-state, immutable-plan and live checks in the write path.
func Preflight(ctx context.Context, p Profile, m SnapshotManifest, manifestHash string) PreflightReport {
	return PreflightPhase(ctx, p, m, manifestHash, "migration")

}
func PreflightPhase(ctx context.Context, p Profile, m SnapshotManifest, manifestHash, phase string) PreflightReport {
	return preflightPhase(ctx, p, m, manifestHash, phase, ReadTargetRuntimeBuild, preflightVault)
}
func preflight(ctx context.Context, p Profile, m SnapshotManifest, manifestHash string, build func(string, string) (RuntimeBuildEvidence, error), vault func(Profile) error) PreflightReport {
	return preflightPhase(ctx, p, m, manifestHash, "migration", build, vault)
}
func preflightPhase(ctx context.Context, p Profile, m SnapshotManifest, manifestHash, phase string, build func(string, string) (RuntimeBuildEvidence, error), vault func(Profile) error) PreflightReport {
	r := PreflightReport{Ready: phase == "migration" || phase == "w1", Phase: phase, Checks: []PreflightCheck{}}
	check := func(name string, fn func(context.Context) error) {
		required := phase == "migration" || phase == "w1" && (name == "profile" || name == "runtime_binding" || name == "source" || name == "source_metadata")
		if !required {
			r.Checks = append(r.Checks, PreflightCheck{Name: name, Required: false, Code: "not_required"})
			return
		}
		c, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		e := fn(c)
		v := PreflightCheck{Name: name, Required: true, Ready: e == nil, Code: "ok"}
		if e != nil {
			v.Code = name + "_not_ready"
			r.Ready = false
		}
		r.Checks = append(r.Checks, v)
	}
	check("profile", func(context.Context) error { return p.Validate() })
	check("runtime_binding", func(context.Context) error { _, _, e := p.RuntimeBinding(); return e })
	check("runtime_build", func(context.Context) error { _, e := build(p.RuntimeBinary, p.SourceRepository); return e })
	check("source", func(c context.Context) error {
		d, e := p.Source.Open()
		if e != nil {
			return e
		}
		defer d.Close()
		s, e := OpenSourceSnapshot(c, d, p.Source.Database)
		if e != nil {
			return e
		}
		defer s.Close()
		if CheckCoverageDeclarations(m) != nil {
			return ErrCoverage
		}
		names := []string{}
		for name := range Declarations() {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			cols := []string{}
			for _, f := range Declarations()[name].Columns {
				if f.Disposition != "vault" || p.VaultWrite == "real" {
					cols = append(cols, "`"+f.Name+"`")
				}
			}
			rows, e := s.tx.QueryContext(c, "SELECT "+strings.Join(cols, ",")+" FROM `"+name+"` LIMIT 0")
			if e != nil {
				return ErrSourcePrivileges
			}
			rows.Close()
		}
		return nil
	})
	check("source_metadata", func(c context.Context) error {
		if p.SourceMetadata.Database != p.Source.Database || p.SourceMetadata.Host != p.Source.Host || p.SourceMetadata.Port != p.Source.Port || p.SourceMetadata.Socket != p.Source.Socket {
			return ErrSourceBinding
		}
		d, e := p.SourceMetadata.Open()
		if e != nil {
			return e
		}
		defer d.Close()
		// Use metadata's own snapshot to inspect its permissions even if source failed.
		s, e := OpenSourceSnapshot(c, d, p.Source.Database)
		if e != nil {
			return e
		}
		defer s.Close()
		if e = s.AttachMetadata(c, d); e != nil {
			return e
		}
		_, e = s.VerifyStage(c, m, manifestHash)
		return e
	})
	check("target", func(c context.Context) error {
		d, e := p.Target.Open()
		if e != nil {
			return e
		}
		defer d.Close()
		b, _, e := p.RuntimeBinding()
		if e != nil {
			return e
		}
		if e = CheckTarget(c, d, p, b); e != nil {
			return e
		}
		plan, e := BuildTargetGrantPlan(p)
		if e != nil {
			return e
		}
		var account string
		if e = d.QueryRowContext(c, "SELECT CURRENT_USER()").Scan(&account); e != nil {
			return ErrTarget
		}
		parts := strings.Split(account, "@")
		if len(parts) != 2 || parts[0] != p.Target.User {
			return ErrTarget
		}
		rows, e := d.QueryContext(c, "SHOW GRANTS FOR CURRENT_USER")
		if e != nil {
			return ErrTarget
		}
		defer rows.Close()
		suffix := " TO `" + parts[0] + "`@`" + parts[1] + "`"
		grants := []string{}
		for rows.Next() {
			var grant string
			if rows.Scan(&grant) != nil || !strings.HasSuffix(grant, suffix) {
				return ErrTarget
			}
			grants = append(grants, strings.TrimSuffix(grant, suffix)+" TO `hzy_wizbiz_migrate`@`127.0.0.1`")
		}
		if rows.Err() != nil {
			return ErrTarget
		}
		return CheckTargetGrantSnapshot(plan, grants)
	})
	check("dependencies", func(c context.Context) error {
		d, e := p.Target.Open()
		if e != nil {
			return e
		}
		defer d.Close()
		b, _, e := p.RuntimeBinding()
		if e != nil {
			return e
		}
		_, e = CheckDependencies(c, d, p, b)
		return e
	})
	check("directory", func(c context.Context) error {
		d, e := p.Directory.Open()
		if e != nil {
			return e
		}
		defer d.Close()
		_, e = ReadDirectory(c, d, p, map[string]IdentityConfirmation{})
		if e != nil {
			return e
		}
		for _, query := range []string{"SELECT uid,status FROM directory_users LIMIT 0", "SELECT uid,dept_code,is_primary,status FROM directory_user_departments LIMIT 0"} {
			rows, e := d.QueryContext(c, query)
			if e != nil {
				return ErrTarget
			}
			rows.Close()
		}
		return nil
	})
	check("vault", func(context.Context) error { return vault(p) })
	return r
}

// Readiness inspects only key location metadata; never reads live key bytes.
func preflightVault(p Profile) error {
	cfg, _, err := readRuntimeBindingConfig(p.RuntimeConfig)
	if err != nil {
		return err
	}
	if cfg.Apps.Console.DB.Database != p.ConsoleDatabase || strings.EqualFold(cfg.Apps.Console.DB.User, "root") {
		return ErrVault
	}
	if strings.TrimSpace(os.Getenv("HZY_CONSOLE_VAULT_MASTER_KEY")) == "" {
		st, err := os.Lstat(config.ConsoleVaultMasterKeyFile(os.Getenv))
		if err != nil || !st.Mode().IsRegular() || st.Mode().Perm() != 0600 || st.Size() == 0 || st.Size() > 4096 {
			return ErrVault
		}
		if raw, ok := st.Sys().(*syscall.Stat_t); !ok || int(raw.Uid) != os.Getuid() {
			return ErrVault
		}
	}
	db, err := runtimedb.Open(cfg.Apps.Console.DB)
	if err != nil {
		return err
	}
	defer db.Close()
	var database, instance string
	if db.QueryRow("SELECT DATABASE(),@@server_uuid").Scan(&database, &instance) != nil || database != p.ConsoleDatabase || instance != p.InstanceID {
		return ErrVault
	}
	return nil
}
