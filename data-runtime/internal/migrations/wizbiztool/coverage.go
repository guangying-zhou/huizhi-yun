package wizbiztool

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strings"
)

//go:embed source_declarations.json
var sourceDeclarations []byte
var ErrCoverage = errors.New("migration_field_coverage_gap")
var ErrValue = errors.New("migration_source_value_invalid")

type FieldDeclaration struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Nullable    bool   `json:"nullable"`
	Disposition string `json:"disposition"`
	Rule        string `json:"rule"`
	Target      string `json:"target"`
	Reason      string `json:"reason"`
}
type TableDeclaration struct {
	PrimaryKey []string           `json:"primaryKey"`
	Columns    []FieldDeclaration `json:"columns"`
}
type CoverageField struct {
	Table       string `json:"table"`
	Column      string `json:"column"`
	Disposition string `json:"disposition"`
	Rule        string `json:"rule"`
	Target      string `json:"target,omitempty"`
	Reason      string `json:"reason,omitempty"`
	Rows        uint64 `json:"rows"`
	Nulls       uint64 `json:"nulls"`
	Blanks      uint64 `json:"blanks"`
	Distinct    uint64 `json:"distinct"`
	Observed    bool   `json:"observed"`
}
type SourceData map[string][]map[string]any

func Declarations() map[string]TableDeclaration {
	var declarations map[string]TableDeclaration
	if json.Unmarshal(sourceDeclarations, &declarations) != nil {
		panic("invalid compiled migration declarations")
	}
	return declarations
}
func CheckCoverageDeclarations(m SnapshotManifest) error {
	declarations := Declarations()
	for table, definition := range declarations {
		actual, exists := m.Tables[table]
		if !exists || !reflect.DeepEqual(actual.PrimaryKey, definition.PrimaryKey) || len(actual.Columns) != len(definition.Columns) {
			return ErrCoverage
		}
		for i, c := range definition.Columns {
			observed := actual.Columns[i]
			if observed.Name != c.Name || normalizedType(observed.Type) != normalizedType(c.Type) || observed.Nullable != c.Nullable {
				return ErrCoverage
			}
			switch c.Disposition {
			case "map", "snapshot", "identity", "vault":
				if c.Target == "" || c.Rule == "" {
					return ErrCoverage
				}
			case "ledger_only":
				switch c.Reason {
				case "phase2_family", "derived_cache", "no_target_semantics", "all_null":
				default:
					return ErrCoverage
				}
			default:
				return ErrCoverage
			}
		}
	}
	return nil
}
func (s *SourceSnapshot) ReadCovered(ctx context.Context, m SnapshotManifest, vaultMode ...string) (SourceData, []CoverageField, error) {
	if CheckCoverageDeclarations(m) != nil {
		return nil, nil, ErrCoverage
	}
	data := SourceData{}
	coverage := []CoverageField{}
	declarations := Declarations()
	names := []string{}
	for table := range declarations {
		names = append(names, table)
	}
	sort.Strings(names)
	for _, table := range names {
		declaration := declarations[table]
		columns := []string{}
		for _, field := range declaration.Columns {
			if field.Disposition != "vault" || (len(vaultMode) == 1 && vaultMode[0] == "real") {
				columns = append(columns, field.Name)
			}
		}
		list := []map[string]any{}
		if err := s.eachRow(ctx, table, columns, declaration.PrimaryKey, func(row map[string]any) error { list = append(list, row); return nil }); err != nil {
			return nil, nil, err
		}
		data[table] = list
		for _, field := range declaration.Columns {
			record := CoverageField{Table: table, Column: field.Name, Disposition: field.Disposition, Rule: field.Rule, Target: field.Target, Reason: field.Reason, Rows: uint64(len(list)), Observed: field.Disposition != "vault"}
			distinct := map[string]bool{}
			if record.Observed {
				for _, row := range list {
					value := row[field.Name]
					if value == nil {
						record.Nulls++
						continue
					}
					text, ok := value.(string)
					if !ok {
						return nil, nil, ErrValue
					}
					if strings.TrimSpace(text) == "" {
						record.Blanks++
					}
					distinct[text] = true
					if field.Reason == "all_null" {
						return nil, nil, ErrCoverage
					}
				}
				record.Distinct = uint64(len(distinct))
			}
			coverage = append(coverage, record)
		}
	}
	return data, coverage, nil
}
