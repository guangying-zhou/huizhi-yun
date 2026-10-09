// Root-local initial enrollment; no HTTP surface or plaintext output.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
)

const secretRef = "HZY_SERVICE_CLIENT_COLLAB_SECRET"

type options struct {
	config, tenant, deployment, client, environment, target, approval string
	verify                                                            bool
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "SERVICE_CREDENTIAL_INITIAL_FAILED (details suppressed)")
		os.Exit(1)
	}
}
func validate(o options, c config.Config) error {
	if o.environment != "prod" || o.client != "collab.runtime" || o.tenant == "" || o.approval == "" || o.tenant != c.Tenant || o.deployment != o.tenant+"-collab" || c.DeploymentBindings["collab"] != o.deployment || c.Deployment != strings.ToLower(o.tenant)+"-prod-tenant-runtime" || !c.Apps.Console.Enabled {
		return errors.New("identity binding rejected")
	}
	return nil
}
func protected(path string, dir bool, uid uint32) error {
	i, e := os.Lstat(path)
	if e != nil {
		return e
	}
	st, ok := i.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uid || i.Mode()&os.ModeSymlink != 0 {
		return errors.New("protected owner required")
	}
	want := os.FileMode(0600)
	if dir {
		want = 0700
	}
	if i.IsDir() != dir || i.Mode().Perm() != want {
		return errors.New("protected mode required")
	}
	return nil
}
func destination(path string, uid uint32) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("absolute clean path required")
	}
	// The dedicated root-owned 0700 directory is the security boundary. Ancestors
	// must not be symbolic links or writable by group/others.
	for p := filepath.Dir(path); p != "/"; p = filepath.Dir(p) {
		i, e := os.Lstat(p)
		if e != nil {
			return e
		}
		st, ok := i.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != uid || !i.IsDir() || i.Mode()&os.ModeSymlink != 0 || i.Mode().Perm()&0022 != 0 {
			return errors.New("unsafe ancestor")
		}
	}
	return protected(filepath.Dir(path), true, uid)
}
func persist(path, secret string) error {
	if strings.ContainsAny(secret, "\r\n") || secret == "" {
		return errors.New("invalid material")
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".credential-*")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if e = f.Chmod(0600); e != nil {
		return e
	}
	if _, e = f.WriteString(secretRef + "=" + secret + "\nCOLLAB_SERVICE_CLIENT_SECRET=" + secret + "\n"); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	// link is atomic and fails if the destination exists; rename would overwrite.
	if e = os.Link(f.Name(), path); e != nil {
		return e
	}
	d, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}
func readSecret(path string) (string, error) {
	b, e := os.ReadFile(path)
	if e != nil {
		return "", e
	}
	lines := strings.Split(strings.TrimSuffix(string(b), "\n"), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], secretRef+"=") {
		return "", errors.New("invalid credential file")
	}
	s := strings.TrimPrefix(lines[0], secretRef+"=")
	if s == "" || lines[1] != "COLLAB_SERVICE_CLIENT_SECRET="+s {
		return "", errors.New("credential keys mismatch")
	}
	return s, nil
}
func run() error {
	var o options
	flag.StringVar(&o.config, "config", "", "protected Runtime config")
	flag.StringVar(&o.tenant, "tenant", "", "tenant")
	flag.StringVar(&o.deployment, "deployment", "", "registered Collab deployment")
	flag.StringVar(&o.client, "client-id", "", "collab.runtime only")
	flag.StringVar(&o.environment, "environment", "", "explicit prod confirmation")
	flag.StringVar(&o.target, "target-env", "", "new root 0600 env file in root 0700 directory")
	flag.StringVar(&o.approval, "approval-id", "", "user approval record identifier")
	flag.BoolVar(&o.verify, "verify", false, "read-only replay verification")
	flag.Parse()
	if flag.NArg() != 0 || os.Geteuid() != 0 {
		return errors.New("root local operation required")
	}
	if err := protected(o.config, false, 0); err != nil {
		return err
	}
	if err := destination(o.target, 0); err != nil {
		return err
	}
	if err := os.Setenv("HZY_DATA_RUNTIME_CONFIG", o.config); err != nil {
		return err
	}
	if err := os.Setenv("HZY_DATA_RUNTIME_CONFIG_DIR", filepath.Dir(o.config)); err != nil {
		return err
	}
	c, e := config.Load()
	if e != nil {
		return e
	}
	if e = validate(o, c); e != nil {
		return e
	}
	if o.verify {
		if e = protected(o.target, false, 0); e != nil {
			return e
		}
		s, e := readSecret(o.target)
		if e != nil {
			return e
		}
		if e = os.Setenv(secretRef, s); e != nil {
			return e
		}
	} else {
		if _, e = os.Lstat(o.target); !os.IsNotExist(e) {
			return errors.New("destination already exists or unavailable")
		}
	}
	conn, e := db.Open(c.Apps.Console.DB)
	if e != nil {
		return e
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var databaseTenant string
	if e = conn.QueryRowContext(ctx, `SELECT tenant_code FROM org_profiles WHERE singleton_key=1 AND status='active'`).Scan(&databaseTenant); e != nil {
		return e
	}
	if databaseTenant != o.tenant {
		return errors.New("database tenant mismatch")
	}
	var n, bad int
	// Only the reviewed two qualified capabilities, with authoritative binding.
	if e = conn.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(CASE WHEN g.resource_code='data-runtime:codocs:collaboration-snapshots' AND g.action IN ('read','publish') AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.tenantCode'))=? AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.deploymentCode'))=? AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.audience'))='data-runtime' AND JSON_UNQUOTE(JSON_EXTRACT(g.scope_json,'$.semanticScope'))=CONCAT('codocs:collaboration-snapshots:',g.action) THEN 0 ELSE 1 END),0) FROM service_client_grants g JOIN service_clients s ON s.id=g.service_client_id WHERE s.client_code=? AND s.app_code='collab' AND s.status='active' AND g.status='active'`, o.tenant, o.deployment, o.client).Scan(&n, &bad); e != nil {
		return e
	}
	if n != 2 || bad != 0 {
		return errors.New("registered grant bindings required")
	}
	a := console.NewWithDB(c.Apps.Console, c.Tenant, conn)
	in := console.InitialServiceCredential{ClientCode: o.client, AppCode: "collab", ActorID: "initial-enrollment:" + o.approval, ExternalSecretRef: secretRef, PersistSecret: func(s string) error { return persist(o.target, s) }}
	var out console.InitialServiceCredentialResult
	if o.verify {
		out, e = a.VerifyInitialServiceCredential(ctx, in)
	} else {
		out, e = a.EnsureInitialServiceCredential(ctx, in)
	}
	if e != nil {
		return e
	}
	if !o.verify && !out.Created {
		return errors.New("existing credential requires verify, never rotate")
	}
	fmt.Println("SERVICE_CREDENTIAL_INITIAL_OK")
	return nil
}
