package wizbiztool

import (
	"errors"
	"testing"
)

func TestVerifiedSourceIndexPreservesRowsAndRejectsAmbiguity(t *testing.T) {
	row := map[string]any{"customer_id": "1", "stars": "0"}
	declaration := Declarations()["wb_contract"]
	key := declaration.PrimaryKey[0]
	delete(row, "customer_id")
	row[key] = "1"
	index, e := indexSourceRows(SourceData{"wb_contract": {row}})
	if e != nil || index["wb_contract"]["1"]["stars"] != "0" {
		t.Fatal("source row changed")
	}
	for _, data := range []SourceData{{"wb_contract": {row, row}}, {"wb_contract": {{key: ""}}}, {"unknown_table": {row}}} {
		if _, e = indexSourceRows(data); !errors.Is(e, ErrSourceBinding) {
			t.Fatal("ambiguous source accepted")
		}
	}
}
