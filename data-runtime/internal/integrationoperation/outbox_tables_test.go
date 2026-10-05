package integrationoperation

import "testing"

func TestOutboxTablesRejectUnsafeAndExplicitZero(t *testing.T) {
	for _, name := range []string{"", "table", "`db`.`table`", "`x`; DROP TABLE y", "`x y`"} {
		if _, err := NewOutboxTables(name, "`a`", "`r`", "`d`"); err == nil {
			t.Fatal(name)
		}
	}
	if _, err := NewOutboxTables("`a`", "`a`", "`r`", "`d`"); err == nil {
		t.Fatal("alias")
	}
	if got, err := (TrustedContext{}).OperationTable(); err != nil || got != "`integration_operation`" {
		t.Fatal(got, err)
	}
	zero := OutboxTables{}
	if _, err := (TrustedContext{OutboxTables: &zero}).OperationTable(); err == nil {
		t.Fatal("explicit zero accepted")
	}
}
