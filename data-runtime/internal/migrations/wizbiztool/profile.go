package wizbiztool

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
)

const ProfileVersion = "wizbiz-migration-profile.v1"

var ErrProfile = errors.New("migration_profile_invalid")
var ErrTarget = errors.New("migration_target_identity_invalid")

type Connection struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Socket   string `json:"socket,omitempty"`
	User     string `json:"user"`
	Password string `json:"password"`
	Database string `json:"database"`
}
type Approval struct {
	Approver string `json:"approver"`
	Date     string `json:"date"`
	Scope    string `json:"scope"`
	Note     string `json:"note"`
}
type CurrencyConfirmation struct {
	Code     string `json:"code"`
	Approver string `json:"approver"`
	Date     string `json:"date"`
}
type Profile struct {
	snapshotAt           string
	Version              string                        `json:"version"`
	Tenant               string                        `json:"tenant"`
	Environment          string                        `json:"environment"`
	RuntimeDeployment    string                        `json:"runtimeDeployment"`
	EnterpriseDeployment string                        `json:"enterpriseDeployment"`
	InstanceID           string                        `json:"instanceId"`
	Database             string                        `json:"database"`
	ConsoleDatabase      string                        `json:"consoleDatabase"`
	RuntimeConfig        string                        `json:"runtimeConfig"`
	RuntimeBinary        string                        `json:"runtimeBinary"`
	SourceRepository     string                        `json:"sourceRepository"`
	Runtime              cutoverprofile.RuntimeService `json:"runtime"`
	SourceMetadata       Connection                    `json:"sourceMetadata"`
	Source               Connection                    `json:"source"`
	Target               Connection                    `json:"target"`
	Directory            Connection                    `json:"directory"`
	VaultWrite           string                        `json:"vaultWrite"`
	Approval             *Approval                     `json:"approval,omitempty"`
	Currency             CurrencyConfirmation          `json:"currency"`
	BatchCode            string                        `json:"batchCode"`
	Operator             string                        `json:"operator"`
}

func ReadJSON(path string, destination any, limit int64) (string, error) {
	raw, err := cutoverprofile.ReadProtected(path, limit)
	if err != nil {
		return "", ErrProfile
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(destination) != nil {
		return "", ErrProfile
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return "", ErrProfile
	}
	return Digest(raw), nil
}
func WriteJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return ErrProfile
	}
	fd, err := syscall.Open(path, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return ErrProfile
	}
	file := os.NewFile(uintptr(fd), path)
	ok := false
	defer func() {
		file.Close()
		if !ok {
			os.Remove(path)
		}
	}()
	if file.Chmod(0600) != nil {
		return ErrProfile
	}
	if _, err = file.Write(append(data, '\n')); err != nil {
		return ErrProfile
	}
	if file.Sync() != nil {
		return ErrProfile
	}
	ok = true
	return nil
}
func (p Profile) Validate() error {
	code := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)
	if p.Version != ProfileVersion || !code.MatchString(p.Tenant) || !code.MatchString(p.RuntimeDeployment) || !code.MatchString(p.EnterpriseDeployment) || !cutoverprofile.AllowedEnvironment(p.Environment) || p.InstanceID == "" || !identifier.MatchString(p.Database) || !identifier.MatchString(p.ConsoleDatabase) || !code.MatchString(p.BatchCode) || p.Operator == "" || len(p.Operator) > 64 {
		return ErrProfile
	}
	if p.Currency.Code != "CNY" || p.Currency.Approver == "" {
		return ErrProfile
	}
	if _, err := time.Parse("2006-01-02", p.Currency.Date); err != nil {
		return ErrProfile
	}
	if p.VaultWrite != "real" && p.VaultWrite != "synthetic" && p.VaultWrite != "forbidden" {
		return ErrProfile
	}
	if p.VaultWrite == "real" && (p.Approval == nil || p.Approval.Approver == "" || p.Approval.Scope != p.Environment+"/"+p.BatchCode || p.Approval.Note == "") {
		return ErrProfile
	}
	if p.Approval != nil {
		if _, err := time.Parse("2006-01-02", p.Approval.Date); err != nil {
			return ErrProfile
		}
	}
	for _, path := range []string{p.RuntimeConfig, p.RuntimeBinary, p.SourceRepository} {
		if !filepath.IsAbs(path) {
			return ErrProfile
		}
	}
	for _, connection := range []Connection{p.Source, p.SourceMetadata, p.Target, p.Directory} {
		if connection.Validate() != nil {
			return ErrProfile
		}
	}
	if p.SourceMetadata.Database != p.Source.Database || p.SourceMetadata.Host != p.Source.Host || p.SourceMetadata.Port != p.Source.Port || p.SourceMetadata.Socket != p.Source.Socket {
		return ErrProfile
	}
	if p.Target.Database != p.Database || p.Directory.Database != p.ConsoleDatabase || p.Source.Database == p.Database || p.Target.User == p.Source.User {
		return ErrProfile
	}
	return nil
}
func (c Connection) Validate() error {
	if !identifier.MatchString(c.Database) || !regexp.MustCompile(`^[A-Za-z0-9_.-]{1,32}$`).MatchString(c.User) || strings.EqualFold(c.User, "root") {
		return ErrProfile
	}
	if c.Socket != "" {
		if c.Host != "" || c.Port != 0 || !filepath.IsAbs(c.Socket) {
			return ErrProfile
		}
	} else if c.Host == "" || c.Port < 1 || c.Port > 65535 {
		return ErrProfile
	}
	return nil
}
func (c Connection) Open() (*sql.DB, error) {
	if c.Validate() != nil {
		return nil, ErrProfile
	}
	m := mysql.NewConfig()
	m.User = c.User
	m.Passwd = c.Password
	m.DBName = c.Database
	m.ParseTime = false
	m.MultiStatements = false
	m.InterpolateParams = false
	m.Timeout = 5 * time.Second
	m.ReadTimeout = 30 * time.Second
	m.WriteTimeout = 30 * time.Second
	if c.Socket != "" {
		m.Net = "unix"
		m.Addr = c.Socket
	} else {
		m.Net = "tcp"
		m.Addr = net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
	}
	db, err := sql.Open("mysql", m.FormatDSN())
	if err != nil {
		return nil, ErrProfile
	}
	db.SetMaxOpenConns(2)
	return db, nil
}
func (p Profile) RuntimeBinding() (enterprise.Binding, string, error) {
	cfg, hash, err := readRuntimeBindingConfig(p.RuntimeConfig)
	if err != nil {
		return enterprise.Binding{}, "", err
	}
	if cfg.Tenant != p.Tenant || cfg.Deployment != p.RuntimeDeployment || cfg.DeploymentBindings["enterprise"] != p.EnterpriseDeployment || cfg.Apps.Console.DB.Database != p.ConsoleDatabase {
		return enterprise.Binding{}, "", gateFailure(ErrTarget, "deployment_binding", "runtime_config")
	}
	b, err := cfg.EnterpriseBinding()
	if err != nil || b.Key.Environment != p.Environment || b.Generation == 0 || b.Storage.InstanceID != p.InstanceID || b.Storage.Database != p.Database {
		return enterprise.Binding{}, "", gateFailure(ErrTarget, "storage_binding", "runtime_config")
	}
	for _, domain := range []string{"altoc", "finance"} {
		d := b.Domains[domain]
		if d.OwnerDeployment != p.EnterpriseDeployment || d.Read != enterprise.PathUnified || d.Write != enterprise.PathUnified {
			return enterprise.Binding{}, "", gateFailure(ErrTarget, "domain_binding", "runtime_config")
		}
	}
	return b, hash, nil
}

// The protected Runtime file may carry this existing local path although the
// runtime-only Config field is excluded from JSON. Accept only that field;
// never open its value. All other fields retain strict typed decoding.
func readRuntimeBindingConfig(path string) (config.Config, string, error) {
	var wire struct {
		config.Config
		Apps struct {
			config.AppsConfig
			Console struct {
				config.ConsoleConfig
				VaultMasterKeyFile string `json:"vaultMasterKeyFile"`
			} `json:"console"`
		} `json:"apps"`
	}
	hash, err := ReadJSON(path, &wire, 32<<20)
	if err != nil {
		return config.Config{}, "", err
	}
	cfg := wire.Config
	cfg.Apps = wire.Apps.AppsConfig
	cfg.Apps.Console = wire.Apps.Console.ConsoleConfig
	return cfg, hash, nil
}

type targetQuery interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func CheckTarget(ctx context.Context, q targetQuery, p Profile, b enterprise.Binding) error {
	var instance, database, tenant, environment, deployment, schema string
	var generation uint64
	if q.QueryRowContext(ctx, "SELECT @@server_uuid,DATABASE()").Scan(&instance, &database) != nil || instance != p.InstanceID || database != p.Database {
		return gateFailure(ErrTarget, "server_identity", "target_database")
	}
	if q.QueryRowContext(ctx, "SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1").Scan(&tenant, &environment, &deployment, &schema, &generation) != nil || tenant != p.Tenant || environment != p.Environment || deployment != p.RuntimeDeployment || schema != b.SchemaVersion || generation != b.Generation || generation == 0 {
		return gateFailure(ErrTarget, "registry_identity", "registry")
	}
	return CheckTargetPrivileges(ctx, q, p)
}
func CheckTargetPrivileges(ctx context.Context, q targetQuery, p Profile) error {
	var user string
	if q.QueryRowContext(ctx, "SELECT CURRENT_USER()").Scan(&user) != nil || strings.EqualFold(strings.Split(user, "@")[0], "root") {
		return gateFailure(ErrTarget, "principal", "target_account")
	}
	rows, err := q.QueryContext(ctx, "SHOW GRANTS FOR CURRENT_USER")
	if err != nil {
		return gateFailure(ErrTarget, "grant_query", "target_account")
	}
	defer rows.Close()
	anyGrant := false
	grantPattern := regexp.MustCompile("^GRANT ([A-Z, ]+) ON `" + p.Database + "`\\.`([a-z][a-z0-9_]*)` TO ")
	allowed := targetTableSet()
	binding, _, bindingErr := p.RuntimeBinding()
	if bindingErr != nil {
		return gateFailure(ErrTarget, "runtime_binding", "runtime_config")
	}
	for _, domain := range binding.Domains {
		for _, table := range domain.Tables {
			if !identifier.MatchString(table) {
				return gateFailure(ErrTarget, "mapping_identifier", "registered_table")
			}
			allowed[table] = true
		}
	}
	for rows.Next() {
		var grant string
		if rows.Scan(&grant) != nil {
			return gateFailure(ErrTarget, "grant_scan", "target_account")
		}
		if strings.HasPrefix(grant, "GRANT USAGE ON *.* TO ") {
			continue
		}
		match := grantPattern.FindStringSubmatch(grant)
		if len(match) != 3 || !allowed[match[2]] || strings.Contains(grant, " WITH GRANT OPTION") {
			return gateFailure(ErrTarget, "grant_object", "target_account")
		}
		for _, privilege := range strings.Split(match[1], ",") {
			switch strings.TrimSpace(privilege) {
			case "SELECT", "INSERT", "UPDATE", "DELETE":
				if (!targetTableSet()[match[2]] || match[2] == "enterprise_schema_registry") && strings.TrimSpace(privilege) != "SELECT" {
					return gateFailure(ErrTarget, "grant_write_scope", "target_account")
				}
			default:
				return gateFailure(ErrTarget, "grant_privilege", "target_account")
			}
		}
		anyGrant = true
	}
	if rows.Err() != nil || !anyGrant {
		return gateFailure(ErrTarget, "grant_rows", "target_account")
	}
	return nil
}
