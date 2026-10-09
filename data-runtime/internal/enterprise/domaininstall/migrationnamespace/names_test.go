package migrationnamespace_test

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall/migrationnamespace"
	"reflect"
	"sort"
	"testing"
)

func TestNamespaceMatchesReviewedInstaller(t *testing.T) {
	names := migrationnamespace.Tables()
	installed := []string{}
	for _, table := range domaininstall.W1Tables("w1-migration-ledger") {
		installed = append(installed, table.Logical)
	}
	sort.Strings(names)
	sort.Strings(installed)
	if !reflect.DeepEqual(names, installed) {
		t.Fatal("closed namespace differs from reviewed installation subset")
	}
	original := migrationnamespace.Tables()
	original[0] = "changed"
	if reflect.DeepEqual(original, migrationnamespace.Tables()) {
		t.Fatal("caller mutated namespace")
	}
}
