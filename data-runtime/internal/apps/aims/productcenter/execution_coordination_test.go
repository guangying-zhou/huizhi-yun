package productcenter

import (
	"math"
	"testing"
)

func TestExecutionCoordinationDeduplicatesAcrossProjects(t *testing.T) {
	a := VersionExecutionItem{ID: 1, ProjectID: 2, Status: "completed", Weight: 3}
	b := VersionExecutionItem{ID: 2, ProjectID: 1, Status: "active", Weight: 1}
	bug := VersionExecutionItem{ID: 3, ProjectID: 1, Status: "active"}
	out, err := SummarizeExecutionCoordination(VersionExecutionSnapshot{Targets: []VersionExecutionItem{a, b, a}, OpenDefects: []VersionExecutionItem{bug, bug}, DefectCoverage: "linked-descendants-only"})
	if err != nil || out.TargetCount != 2 || out.IncompleteTargetCount != 1 || out.OpenDefectCount != 1 || out.TotalWeight != 4 || out.CompletedWeight != 3 || out.NoExecutionPlan || out.DefectCoverage != "linked-descendants-only" || len(out.Projects) != 2 {
		t.Fatalf("summary %+v %v", out, err)
	}
	if out.Projects[0].ProjectID != 1 || out.Projects[0].TotalWeight != 1 || out.Projects[0].OpenDefectCount != 1 || out.Projects[1].CompletedWeight != 3 {
		t.Fatalf("projects %+v", out.Projects)
	}
}
func TestExecutionCoordinationZeroPlanAndInvalidFacts(t *testing.T) {
	out, err := SummarizeExecutionCoordination(VersionExecutionSnapshot{Targets: []VersionExecutionItem{{ID: 1, ProjectID: 1, Status: "active", Weight: 0}}})
	if err != nil || !out.NoExecutionPlan || !out.Projects[0].NoExecutionPlan || out.IncompleteTargetCount != 1 {
		t.Fatalf("zero %+v %v", out, err)
	}
	for _, snapshot := range []VersionExecutionSnapshot{
		{Targets: []VersionExecutionItem{{ID: 1, ProjectID: 1}, {ID: 1, ProjectID: 2}}},
		{Targets: []VersionExecutionItem{{ID: 1, ProjectID: 1, Weight: math.MaxUint64}, {ID: 2, ProjectID: 1, Weight: 1}}},
		{Targets: []VersionExecutionItem{{ID: 0, ProjectID: 1}}},
		{OpenDefects: []VersionExecutionItem{{ID: 1, ProjectID: 1, Status: "completed"}}},
	} {
		if _, err := SummarizeExecutionCoordination(snapshot); err == nil {
			t.Fatalf("accepted %+v", snapshot)
		}
	}
}
