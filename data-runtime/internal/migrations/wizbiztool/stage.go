package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	ErrSourcePrivileges = errors.New("source_privileges_invalid")
	ErrSourceBinding    = errors.New("source_binding_mismatch")
	ErrStructure        = errors.New("source_structure_drift")
)
var identifier = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

type SourceColumn struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
}
type ManifestTable struct {
	Rows                 uint64         `json:"rows"`
	PrimaryKey           []string       `json:"primaryKey"`
	Columns              []SourceColumn `json:"columns"`
	InsertSequenceSHA256 string         `json:"insertSequenceSha256"`
}
type SnapshotManifest struct {
	SnapshotID      string                   `json:"snapshotId"`
	SourceSystem    string                   `json:"sourceSystem"`
	SQLSHA256       string                   `json:"sqlSha256"`
	EncryptedSHA256 string                   `json:"encryptedSha256"`
	MySQLVersion    string                   `json:"mysqlVersion"`
	Timezone        string                   `json:"timezone"`
	Tables          map[string]ManifestTable `json:"tables"`
}
type StageTable struct {
	Rows                 uint64   `json:"rows"`
	Digest               string   `json:"digest,omitempty"`
	InsertSequenceSHA256 string   `json:"insertSequenceSha256"`
	ExcludedColumns      []string `json:"excludedColumns,omitempty"`
}
type StageReceipt struct {
	SnapshotID     string                `json:"snapshotId"`
	SQLSHA256      string                `json:"sqlSha256"`
	ManifestSHA256 string                `json:"manifestSha256"`
	InstanceID     string                `json:"instanceId"`
	Database       string                `json:"database"`
	Tables         map[string]StageTable `json:"tables"`
	VerifiedAt     time.Time             `json:"verifiedAt"`
}

// SourceSnapshot holds one repeatable, read-only SQL transaction until all
// stage and plan reads are finished. The caller must Close it on every exit.
type SourceSnapshot struct {
	tx       *sql.Tx
	metadata *sql.Tx
	database string
	instance string
}

func OpenSourceSnapshot(ctx context.Context, db *sql.DB, database string) (*SourceSnapshot, error) {
	if !identifier.MatchString(database) {
		return nil, ErrInput
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, ErrSourceBinding
	}
	s := &SourceSnapshot{tx: tx, database: database}
	ok := false
	defer func() {
		if !ok {
			_ = tx.Rollback()
		}
	}()
	var actual string
	if tx.QueryRowContext(ctx, "SELECT DATABASE(), @@server_uuid").Scan(&actual, &s.instance) != nil || actual != database || s.instance == "" {
		return nil, ErrSourceBinding
	}
	rows, err := tx.QueryContext(ctx, "SHOW GRANTS FOR CURRENT_USER")
	if err != nil {
		return nil, ErrSourcePrivileges
	}
	var grants []string
	for rows.Next() {
		var grant string
		if rows.Scan(&grant) != nil {
			rows.Close()
			return nil, ErrSourcePrivileges
		}
		grants = append(grants, grant)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || ValidateSourceGrants(grants, database) != nil {
		return nil, ErrSourcePrivileges
	}
	ok = true
	return s, nil
}
func (s *SourceSnapshot) Close() error {
	if s.metadata != nil && s.metadata != s.tx {
		s.metadata.Rollback()
	}
	return s.tx.Rollback()
}

// ValidateSourceGrants accepts SELECT (including column-level SELECT) on the
// single staging schema and USAGE only. Roles, PROXY, GRANT OPTION, global
// SELECT, unrelated schemas and any write privilege fail closed.
func ValidateSourceGrants(grants []string, database string) error {
	if !identifier.MatchString(database) || len(grants) == 0 {
		return ErrSourcePrivileges
	}
	selected := false
	pattern := regexp.MustCompile("^GRANT SELECT(?: \\([a-zA-Z0-9_`, ]+\\))? ON `" + database + "`\\.(?:\\*|`[a-z][a-z0-9_]*`) TO ")
	for _, grant := range grants {
		if strings.Contains(grant, " WITH GRANT OPTION") {
			return ErrSourcePrivileges
		}
		if strings.HasPrefix(grant, "GRANT USAGE ON *.* TO ") {
			continue
		}
		if !pattern.MatchString(grant) {
			return ErrSourcePrivileges
		}
		selected = true
	}
	if !selected {
		return ErrSourcePrivileges
	}
	return nil
}

// AttachMetadata uses a second SELECT-only account with schema-wide visibility.
// It is used only for schema enumeration and COUNT, never for source row values.
// Column-limited readers alone cannot detect a newly added ungranted table.
func (s *SourceSnapshot) AttachMetadata(ctx context.Context, db *sql.DB) error {
	if s.metadata != nil {
		return ErrSourcePrivileges
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return ErrSourceBinding
	}
	ok := false
	defer func() {
		if !ok {
			tx.Rollback()
		}
	}()
	var database, instance string
	if tx.QueryRowContext(ctx, "SELECT DATABASE(), @@server_uuid").Scan(&database, &instance) != nil || database != s.database || instance != s.instance {
		return ErrSourceBinding
	}
	rows, err := tx.QueryContext(ctx, "SHOW GRANTS FOR CURRENT_USER")
	if err != nil {
		return ErrSourcePrivileges
	}
	grants := []string{}
	for rows.Next() {
		var grant string
		if rows.Scan(&grant) != nil {
			rows.Close()
			return ErrSourcePrivileges
		}
		grants = append(grants, grant)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || ValidateSourceGrants(grants, s.database) != nil {
		return ErrSourcePrivileges
	}
	complete := false
	for _, grant := range grants {
		if strings.HasPrefix(grant, "GRANT SELECT ON `"+s.database+"`.* TO ") {
			complete = true
		}
	}
	if !complete {
		return ErrSourcePrivileges
	}
	s.metadata = tx
	ok = true
	return nil
}
func (s *SourceSnapshot) schemaReader() *sql.Tx {
	if s.metadata != nil {
		return s.metadata
	}
	return s.tx
}

func validateManifest(m SnapshotManifest) error {
	if m.SourceSystem != "wizbiz" || m.SnapshotID == "" || m.Timezone != "Asia/Shanghai" || m.MySQLVersion == "" || !validHash(m.SQLSHA256) || !validHash(m.EncryptedSHA256) || len(m.Tables) == 0 {
		return ErrInput
	}
	for name, table := range m.Tables {
		if !knownSourceTables[name] || !identifier.MatchString(name) || len(table.Columns) == 0 || len(table.PrimaryKey) == 0 || !validHash(table.InsertSequenceSHA256) {
			return ErrInput
		}
		cols := map[string]bool{}
		for _, c := range table.Columns {
			if !identifier.MatchString(c.Name) || c.Type == "" || cols[c.Name] {
				return ErrInput
			}
			cols[c.Name] = true
		}
		seen := map[string]bool{}
		for _, key := range table.PrimaryKey {
			if !cols[key] || seen[key] {
				return ErrInput
			}
			seen[key] = true
		}
	}
	return nil
}
func validHash(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// VerifyStage never selects the sensitive account_number column. Its explicit
// exclusion is bound into the receipt and must remain identical on rechecks.
func (s *SourceSnapshot) VerifyStage(ctx context.Context, m SnapshotManifest, manifestHash string) (StageReceipt, error) {
	if s.metadata == nil {
		return StageReceipt{}, ErrSourcePrivileges
	}
	if validateManifest(m) != nil || !validHash(manifestHash) {
		return StageReceipt{}, ErrInput
	}
	receipt := StageReceipt{SnapshotID: m.SnapshotID, SQLSHA256: m.SQLSHA256, ManifestSHA256: manifestHash, InstanceID: s.instance, Database: s.database, Tables: map[string]StageTable{}, VerifiedAt: time.Now().UTC()}
	rows, err := s.schemaReader().QueryContext(ctx, "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME", s.database)
	if err != nil {
		return StageReceipt{}, errors.Join(ErrStructure, errors.New("source_table_enumeration"))
	}
	actual := map[string]bool{}
	for rows.Next() {
		var name, kind string
		if rows.Scan(&name, &kind) != nil || kind != "BASE TABLE" {
			rows.Close()
			return StageReceipt{}, errors.Join(ErrStructure, errors.New("source_table_enumeration"))
		}
		actual[name] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(actual) != len(m.Tables) {
		return StageReceipt{}, errors.Join(ErrStructure, errors.New("source_table_enumeration"))
	}
	for name, expected := range m.Tables {
		if !actual[name] {
			return StageReceipt{}, ErrStructure
		}
		columns, err := s.columns(ctx, name)
		if err != nil || !sameSourceColumns(columns, expected.Columns) {
			return StageReceipt{}, errors.Join(ErrStructure, errors.New("source_column_definition"), err)
		}
		pk, err := s.primaryKey(ctx, name)
		if err != nil || !reflect.DeepEqual(pk, expected.PrimaryKey) {
			return StageReceipt{}, errors.Join(ErrStructure, errors.New("source_primary_key"))
		}
		var count uint64
		if s.tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM `"+name+"`").Scan(&count) != nil || count != expected.Rows {
			return StageReceipt{}, ErrSourceBinding
		}
		table := StageTable{Rows: count, InsertSequenceSHA256: expected.InsertSequenceSHA256}
		if sourceInScope(name) {
			cols := []string{}
			for _, c := range columns {
				if name == "wb_bank_account" && c.Name == "account_number" {
					table.ExcludedColumns = []string{c.Name}
					continue
				}
				cols = append(cols, c.Name)
			}
			hashes := []string{}
			err = s.eachRow(ctx, name, cols, pk, func(row map[string]any) error {
				raw, e := CanonicalRow(row)
				if e != nil {
					return e
				}
				hashes = append(hashes, Digest(raw))
				return nil
			})
			if err != nil {
				return StageReceipt{}, ErrSourceBinding
			}
			table.Digest, _ = TableDigest(hashes)
		}
		receipt.Tables[name] = table
	}
	return receipt, nil
}
func (s *SourceSnapshot) columns(ctx context.Context, table string) ([]SourceColumn, error) {
	if !identifier.MatchString(table) {
		return nil, ErrStructure
	}
	// SHOW CREATE exposes schema, never values, even for a column-level SELECT
	// reader. information_schema.COLUMNS hides ungranted secret columns and
	// would otherwise make synthetic mode unable to verify full source schema.
	var name, ddl string
	if s.schemaReader().QueryRowContext(ctx, "SHOW CREATE TABLE `"+table+"`").Scan(&name, &ddl) != nil || name != table {
		return nil, errors.Join(ErrStructure, errors.New("source_schema_query"))
	}
	facts, err := expectedFacts(domaininstall.Table{DDL: ddl})
	if err != nil {
		return nil, errors.Join(ErrStructure, errors.New("source_schema_parse"))
	}
	columns := []SourceColumn{}
	for _, c := range facts.Columns {
		columns = append(columns, SourceColumn{Name: c.Name, Type: c.Type, Nullable: c.Nullable})
	}
	return columns, nil
}
func (s *SourceSnapshot) primaryKey(ctx context.Context, table string) ([]string, error) {
	rows, err := s.schemaReader().QueryContext(ctx, "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX", s.database, table)
	if err != nil {
		return nil, ErrStructure
	}
	defer rows.Close()
	result := []string{}
	for rows.Next() {
		var name string
		if rows.Scan(&name) != nil {
			return nil, ErrStructure
		}
		result = append(result, name)
	}
	if rows.Err() != nil {
		return nil, ErrStructure
	}
	return result, nil
}
func (s *SourceSnapshot) eachRow(ctx context.Context, table string, columns, pk []string, consume func(map[string]any) error) error {
	if !identifier.MatchString(table) || len(columns) == 0 || len(pk) == 0 {
		return ErrInput
	}
	quoted := func(values []string) (string, error) {
		out := []string{}
		for _, name := range values {
			if !identifier.MatchString(name) {
				return "", ErrInput
			}
			out = append(out, "`"+name+"`")
		}
		return strings.Join(out, ","), nil
	}
	selectColumns, err := quoted(columns)
	if err != nil {
		return err
	}
	order, err := quoted(pk)
	if err != nil {
		return err
	}
	rows, err := s.tx.QueryContext(ctx, "SELECT "+selectColumns+" FROM `"+table+"` ORDER BY "+order)
	if err != nil {
		return ErrSourceBinding
	}
	defer rows.Close()
	types, err := rows.ColumnTypes()
	if err != nil {
		return ErrSourceBinding
	}
	for rows.Next() {
		values := make([]sql.RawBytes, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if rows.Scan(pointers...) != nil {
			return ErrSourceBinding
		}
		row := map[string]any{}
		for i, value := range values {
			if value == nil {
				row[columns[i]] = nil
			} else {
				switch types[i].DatabaseTypeName() {
				case "BINARY", "VARBINARY", "TINYBLOB", "BLOB", "MEDIUMBLOB", "LONGBLOB", "BIT":
					row[columns[i]] = hex.EncodeToString(value)
				default:
					row[columns[i]] = string(value)
				}
			}
		}
		if err := consume(row); err != nil {
			return err
		}
	}
	if rows.Err() != nil {
		return ErrSourceBinding
	}
	return nil
}
func CheckStageReceipt(expected, actual StageReceipt) error {
	expected.VerifiedAt = time.Time{}
	actual.VerifiedAt = time.Time{}
	if !reflect.DeepEqual(expected, actual) {
		return ErrSourceBinding
	}
	return nil
}
func SortedTableNames(tables map[string]ManifestTable) []string {
	names := []string{}
	for name := range tables {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func sameSourceColumns(a, b []SourceColumn) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Name != b[i].Name || normalizedType(a[i].Type) != normalizedType(b[i].Type) || a[i].Nullable != b[i].Nullable {
			return false
		}
	}
	return true
}
