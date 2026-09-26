package codocs

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestSnapshotMigrationMatchesCanonicalSchema(t *testing.T) {
	migration, err := os.ReadFile("../../../../codocs/docs/migrations/20260920_document_snapshots.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	definitions := regexp.MustCompile(`(?ms)^CREATE TABLE document_snapshot_.*?^\) ENGINE=InnoDB;`).FindAllString(string(migration), -1)
	if len(definitions) != 2 {
		t.Fatal("expected exactly two snapshot tables")
	}
	for _, definition := range definitions {
		if !strings.Contains(string(schema), definition) {
			t.Fatal("snapshot migration drifted from canonical schema")
		}
	}
}
