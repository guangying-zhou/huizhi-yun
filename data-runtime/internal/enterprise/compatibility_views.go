package enterprise

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
	"sort"
	"strings"
	"unicode"
)

var ErrCompatibilityView = errors.New("enterprise: compatibility view identity or definition mismatch")

// Views are single-owner SQL names over the registered physical tables in this
// same database. They preserve existing domain functions, never copy facts or
// authorize a cross-domain operation. Ambiguous logical names cannot be views.
type CompatibilityView struct {
	Domain, Logical, Physical, Definition, DDL string
}
type CompatibilityViewPlan struct {
	Key           BindingKey
	SchemaVersion string
	Generation    uint64
	Views         []CompatibilityView
	ReviewHash    string
}

func viewQuote(name string) string             { return "`" + name + "`" }
func viewQualified(schema, name string) string { return viewQuote(schema) + "." + viewQuote(name) }

// Token-level normalization accepts MySQL's keyword casing and comma spacing,
// but never folds quoted identifiers or string literals into another object.
func viewCanonical(definition string) string {
	var tokens []string
	for i := 0; i < len(definition); {
		c := definition[i]
		if unicode.IsSpace(rune(c)) {
			i++
			continue
		}
		start := i
		if c == '`' || c == '\'' || c == '"' {
			quote := c
			i++
			closed := false
			for i < len(definition) {
				if definition[i] == quote {
					if i+1 < len(definition) && definition[i+1] == quote {
						i += 2
						continue
					}
					i++
					closed = true
					break
				}
				i++
			}
			if !closed {
				return "invalid:" + definition
			}
			tokens = append(tokens, definition[start:i])
			continue
		}
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' {
			i++
			for i < len(definition) {
				d := definition[i]
				if !((d >= 'A' && d <= 'Z') || (d >= 'a' && d <= 'z') || (d >= '0' && d <= '9') || d == '_') {
					break
				}
				i++
			}
			tokens = append(tokens, strings.ToLower(definition[start:i]))
			continue
		}
		tokens = append(tokens, string(c))
		i++
	}
	return strings.Join(tokens, "\x00")
}

type compatibilityQuery interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func viewBindingIdentity(ctx context.Context, db compatibilityQuery, b Binding, shadow bool) error {
	if db == nil {
		return ErrCompatibilityView
	}
	if _, err := normalizeBinding(b); err != nil {
		return ErrCompatibilityView
	}
	var instance, database, tenant, environment, deployment, version string
	var generation uint64
	if err := db.QueryRowContext(ctx, `SELECT @@server_uuid,DATABASE()`).Scan(&instance, &database); err != nil || !strings.EqualFold(instance, b.Storage.InstanceID) || database != b.Storage.Database {
		return ErrCompatibilityView
	}
	if err := db.QueryRowContext(ctx, `SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1`).Scan(&tenant, &environment, &deployment, &version, &generation); err != nil || tenant != b.Key.Tenant || environment != b.Key.Environment || deployment != b.Key.RuntimeDeployment || version != b.SchemaVersion {
		return ErrCompatibilityView
	}
	if (shadow && generation != 0) || (!shadow && generation != b.Generation) {
		return ErrCompatibilityView
	}
	return nil
}

func compatibilityViewSpecs(ctx context.Context, db compatibilityQuery, b Binding, domain string, logicalNames []string) ([]CompatibilityView, error) {
	d, ok := b.Domains[domain]
	if !ok || len(logicalNames) == 0 {
		return nil, ErrCompatibilityView
	}
	seen := map[string]bool{}
	names := append([]string(nil), logicalNames...)
	sort.Strings(names)
	views := make([]CompatibilityView, 0, len(names))
	for _, logical := range names {
		physical, exists := d.Tables[logical]
		if !exists || seen[logical] {
			return nil, ErrCompatibilityView
		}
		seen[logical] = true
		for otherDomain, other := range b.Domains {
			if otherDomain != domain {
				if _, collision := other.Tables[logical]; collision {
					return nil, ErrCompatibilityView
				}
			}
			for otherLogical, target := range other.Tables {
				if strings.EqualFold(target, logical) && !(otherDomain == domain && otherLogical == logical && target == physical) {
					return nil, ErrCompatibilityView
				}
			}
		}
		var engine string
		if err := db.QueryRowContext(ctx, `SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'`, b.Storage.Database, physical).Scan(&engine); err != nil || engine != "InnoDB" {
			return nil, ErrCompatibilityView
		}
		if physical == logical {
			continue
		}
		rows, err := db.QueryContext(ctx, `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, b.Storage.Database, physical)
		if err != nil {
			return nil, err
		}
		columns := []string{}
		for rows.Next() {
			var column string
			if err := rows.Scan(&column); err != nil {
				rows.Close()
				return nil, err
			}
			if !identifier.MatchString(column) {
				rows.Close()
				return nil, ErrCompatibilityView
			}
			columns = append(columns, viewQualified(b.Storage.Database, physical)+"."+viewQuote(column)+" AS "+viewQuote(column))
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		if len(columns) == 0 {
			return nil, ErrCompatibilityView
		}
		definition := "SELECT " + strings.Join(columns, ",") + " FROM " + viewQualified(b.Storage.Database, physical)
		views = append(views, CompatibilityView{Domain: domain, Logical: logical, Physical: physical, Definition: definition, DDL: "CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW " + viewQualified(b.Storage.Database, logical) + " AS " + definition})
	}
	return views, nil
}

func compatibilityViewHash(plan CompatibilityViewPlan) string {
	plan.ReviewHash = ""
	b, _ := json.Marshal(plan)
	hash := sha256.Sum256(b)
	return hex.EncodeToString(hash[:])
}

func PlanCompatibilityViews(ctx context.Context, db *sql.DB, b Binding, domain string, logicalNames []string) (CompatibilityViewPlan, error) {
	if db == nil {
		return CompatibilityViewPlan{}, ErrCompatibilityView
	}
	return planCompatibilityViews(ctx, db, b, domain, logicalNames)
}
func planCompatibilityViews(ctx context.Context, db compatibilityQuery, b Binding, domain string, logicalNames []string) (CompatibilityViewPlan, error) {
	plan := CompatibilityViewPlan{Key: b.Key, SchemaVersion: b.SchemaVersion, Generation: b.Generation}
	if err := viewBindingIdentity(ctx, db, b, true); err != nil {
		return plan, err
	}
	views, err := compatibilityViewSpecs(ctx, db, b, domain, logicalNames)
	if err != nil {
		return plan, err
	}
	plan.Views = views
	plan.ReviewHash = compatibilityViewHash(plan)
	return plan, nil
}

func compatibilityViewExists(ctx context.Context, db compatibilityQuery, schema string, view CompatibilityView) (bool, error) {
	var objectType string
	err := db.QueryRowContext(ctx, `SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, schema, view.Logical).Scan(&objectType)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if objectType != "VIEW" {
		return false, ErrCompatibilityView
	}
	var definition, security, updatable, checkOption string
	err = db.QueryRowContext(ctx, `SELECT VIEW_DEFINITION,SECURITY_TYPE,IS_UPDATABLE,CHECK_OPTION FROM information_schema.VIEWS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, schema, view.Logical).Scan(&definition, &security, &updatable, &checkOption)
	if err != nil || security != "INVOKER" || updatable != "YES" || checkOption != "NONE" || viewCanonical(definition) != viewCanonical(view.Definition) {
		return false, ErrCompatibilityView
	}
	return true, nil
}

// Install is explicit and allowed only while the target generation is zero.
// Never replace existing objects. Re-entry verifies each exact definition.
func ApplyCompatibilityViews(ctx context.Context, db *sql.DB, b Binding, domain string, logicalNames []string, reviewHash string) error {
	if db == nil {
		return ErrCompatibilityView
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, b.Storage.InstanceID, b.Storage.Database)
	if err != nil {
		return err
	}
	defer release()
	plan, err := planCompatibilityViews(ctx, conn, b, domain, logicalNames)
	if err != nil {
		return err
	}
	if reviewHash == "" || reviewHash != plan.ReviewHash {
		return ErrCompatibilityView
	}
	missing := []CompatibilityView{}
	for _, view := range plan.Views {
		exists, err := compatibilityViewExists(ctx, conn, b.Storage.Database, view)
		if err != nil {
			return err
		}
		if !exists {
			missing = append(missing, view)
		}
	}
	for _, view := range missing {
		if err := viewBindingIdentity(ctx, conn, b, true); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, view.DDL); err != nil {
			return err
		}
		if _, err := compatibilityViewExists(ctx, conn, b.Storage.Database, view); err != nil {
			return err
		}
	}
	return nil
}

// Verify runs when constructing an internal domain service, before any legacy
// SQL is used against this pool. No CREATE/ALTER occurs in a business request.
func VerifyCompatibilityViews(ctx context.Context, db *sql.DB, b Binding, domain string, logicalNames []string) error {
	if db == nil {
		return ErrCompatibilityView
	}
	if err := viewBindingIdentity(ctx, db, b, false); err != nil {
		return err
	}
	views, err := compatibilityViewSpecs(ctx, db, b, domain, logicalNames)
	if err != nil {
		return err
	}
	for _, view := range views {
		exists, err := compatibilityViewExists(ctx, db, b.Storage.Database, view)
		if err != nil || !exists {
			return ErrCompatibilityView
		}
	}
	return nil
}

// VerifyCompatibilityViewsTx is VerifyCompatibilityViews inside a transaction
// that already holds the registry generation lock. It exists for entrypoints
// whose optional view family may not be installed yet, so a missing or altered
// view fails only that entrypoint. Definitions are compared exactly: a view
// with the right name but another target must not pass.
func VerifyCompatibilityViewsTx(ctx context.Context, tx compatibilityQuery, b Binding, domain string, logicalNames []string) error {
	if tx == nil || len(logicalNames) == 0 {
		return ErrCompatibilityView
	}
	var database string
	if err := tx.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&database); err != nil {
		return err
	}
	if database == "" || database != b.Storage.Database {
		return ErrCompatibilityView
	}
	views, err := compatibilityViewSpecs(ctx, tx, b, domain, logicalNames)
	if err != nil {
		return err
	}
	for _, view := range views {
		exists, err := compatibilityViewExists(ctx, tx, b.Storage.Database, view)
		if err != nil || !exists {
			return ErrCompatibilityView
		}
	}
	return nil
}
