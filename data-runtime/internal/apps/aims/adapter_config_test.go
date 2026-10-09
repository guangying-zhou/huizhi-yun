package aims

import "testing"

func TestAimsSchemaRequirementsCoverServiceTicketDeliveryGeneration(t *testing.T) {
	tables := map[string]bool{}
	for _, table := range requiredTables {
		tables[table] = true
	}
	if !tables["work_item_service_ext"] {
		t.Fatal("requiredTables must include work_item_service_ext")
	}

	columns := map[string]bool{}
	for _, column := range requiredColumns {
		columns[column] = true
	}
	for _, column := range []string{
		"work_item_service_ext.delivery_generation",
		"work_item_service_ext.last_delivery_status",
	} {
		if !columns[column] {
			t.Fatalf("requiredColumns missing %q", column)
		}
	}
}
