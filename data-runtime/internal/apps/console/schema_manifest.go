package console

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
)

type schemaManifestTable struct {
	Columns     []string `json:"columns"`
	Indexes     []string `json:"indexes"`
	Constraints []string `json:"constraints"`
}

type schemaManifest struct {
	SchemaRevision string                         `json:"schemaRevision"`
	Source         string                         `json:"source"`
	ExcludedTables []string                       `json:"excludedTables"`
	Tables         map[string]schemaManifestTable `json:"tables"`
}

//go:embed schema_manifest.json
var embeddedSchemaManifest []byte

var consoleSchemaManifest = mustLoadSchemaManifest()

func mustLoadSchemaManifest() schemaManifest {
	var manifest schemaManifest
	if err := json.Unmarshal(embeddedSchemaManifest, &manifest); err != nil {
		panic(fmt.Sprintf("parse Console Runtime schema manifest: %v", err))
	}
	if manifest.SchemaRevision == "" || len(manifest.Tables) == 0 {
		panic("Console Runtime schema manifest is empty")
	}
	for table, definition := range manifest.Tables {
		if table == "" || len(definition.Columns) == 0 {
			panic(fmt.Sprintf("Console Runtime schema manifest table %q has no columns", table))
		}
	}
	return manifest
}

func schemaRequiredTables() []string {
	tables := make([]string, 0, len(consoleSchemaManifest.Tables))
	for table := range consoleSchemaManifest.Tables {
		tables = append(tables, table)
	}
	sort.Strings(tables)
	return tables
}
