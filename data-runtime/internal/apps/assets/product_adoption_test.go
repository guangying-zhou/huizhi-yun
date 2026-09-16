package assets

import (
	"reflect"
	"testing"
)

func TestProductAdoptionSummaryCountsIndependentDimensions(t *testing.T) {
	rows := []ProductAdoptionRelation{
		{"DA1", "ENV1", "CU1", "production", "online", "v1"},
		{"DA1", "ENV1", "CU1", "primary", "accepted", "v2"},
		{"DA1", "ENV1", "CU1", "backup", "deployed", ""},
		{"DA2", "ENV1", "CU1", "test", "deployed", "v1"},
		{"DA3", "ENV2", "CU1", "production", "accepted", "v1"},
		{"DA4", "ENV3", "CU2", "production", "planned", "v1"},
		{"DA5", "ENV4", "CU3", "production", "suspended", "v1"},
		{"DA6", "ENV5", "", "test", "deployed", ""},
	}
	want := ProductAdoptionSummary{Instances: 4, Environments: 3, Customers: 1,
		ProductionInstances: 2, UnknownVersionInstances: 2, ConflictingVersionInstances: 1}
	if got := summarizeProductAdoption(rows); got != want {
		t.Fatalf("summary = %+v, want %+v", got, want)
	}
	if got := summarizeProductAdoption(nil); got != (ProductAdoptionSummary{}) {
		t.Fatalf("empty summary = %+v", got)
	}
}

func TestProductAdoptionDeduplicatesRolesAndPreservesVersionEvidence(t *testing.T) {
	input := []ProductAdoptionRelation{
		{"DA1", "ENV1", "CU1", "production", "online", "v1"},
		{"DA1", "ENV1", "CU1", "primary", "accepted", "v1"},
		{"DA1", "ENV1", "CU1", "backup", "deployed", "v2"},
		{"DA1", "ENV1", "CU1", "test", "planned", "future"},
		{"DA2", "ENV1", "CU1", "production", "provisioning", "v3"},
		{"DA3", "ENV2", "CU2", "test", "deployed", ""},
	}
	result := aggregateProductAdoption(input)
	if len(result) != 3 {
		t.Fatal("role rows multiplied adoption instances")
	}
	if !result[0].Adopted || !result[0].Production || !result[0].VersionConflict || !reflect.DeepEqual(result[0].Versions, []string{"v1", "v2"}) {
		t.Fatal("conflicting actual versions were hidden or planned version counted")
	}
	if result[1].Adopted || result[1].Production || len(result[1].Versions) != 0 {
		t.Fatal("planned production counted as adopted")
	}
	if !result[2].Adopted || result[2].Production || !result[2].VersionUnknown {
		t.Fatal("unknown test deployment was lost or treated as production")
	}
	reversed := append([]ProductAdoptionRelation(nil), input...)
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	if !reflect.DeepEqual(result, aggregateProductAdoption(reversed)) {
		t.Fatal("aggregation depends on row order")
	}
}
