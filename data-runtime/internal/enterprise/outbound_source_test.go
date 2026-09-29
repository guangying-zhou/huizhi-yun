package enterprise

import "testing"

func TestOutboundSourceUsesExplicitWorkerAndBoundTables(t *testing.T) {
	key := BindingKey{"tenant", "test", "enterprise"}
	writer := ResolveRequest{Key: key, Domain: "aims", OwnerDeployment: "enterprise", SchemaVersion: "v1", Generation: 2, Operation: Write}
	resolved := Resolved{Key: key, Domain: "aims", OwnerDeployment: "enterprise", SchemaVersion: "v1", Generation: 2, tables: map[string]string{"integration_operation": "a_operation", "integration_operation_attempt": "a_attempt", "service_command_receipt": "a_receipt", "integration_operation_dead_letter_actionable": "a_dead"}}
	source, err := NewOutboundSource(writer, resolved, "actual-aims", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	ctx := source.Context(writer, "request")
	if ctx.DeploymentCode != "actual-aims" || ctx.SourceApp != "aims" || ctx.ServiceClientID != "" || ctx.TenantCode != "tenant" {
		t.Fatal("producer impersonated transport", ctx)
	}
	table, err := ctx.OperationTable()
	if err != nil || table != "`a_operation`" {
		t.Fatal(table, err)
	}
	changed := writer
	changed.Key.Tenant = "other"
	if source.Context(changed, "request").SourceApp != "" || source.Validate(changed, resolved) == nil {
		t.Fatal("cross tenant accepted")
	}
	changed = writer
	changed.Generation++
	if source.Context(changed, "request").SourceApp != "" {
		t.Fatal("stale source accepted")
	}
	for _, client := range []string{"", "enterprise.runtime", "aims"} {
		if _, err = NewOutboundSource(writer, resolved, "actual-aims", client); err == nil {
			t.Fatal(client)
		}
	}
	if _, err = NewOutboundSource(writer, resolved, "", "aims.runtime"); err == nil {
		t.Fatal("guessed owner")
	}
	delete(resolved.tables, "service_command_receipt")
	if source.Validate(writer, resolved) == nil {
		t.Fatal("missing table")
	}
	if ((*OutboundSource)(nil)).Context(writer, "r").SourceApp != "" {
		t.Fatal("nil source")
	}
}
