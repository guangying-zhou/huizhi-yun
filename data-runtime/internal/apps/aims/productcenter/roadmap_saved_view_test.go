package productcenter

import "testing"

func TestRoadmapSavedViewDefinition(t *testing.T) {
	base := RoadmapSavedViewDefinition{Title: "季度交付", Audience: "delivery", Visibility: "personal", CycleBizID: "00000000-0000-4000-8000-000000000001", Year: 2026, Quarter: 4}
	for _, audience := range []string{"planning", "delivery", "stakeholder"} {
		for _, visibility := range []string{"personal", "product"} {
			view := base
			view.Audience, view.Visibility = audience, visibility
			if err := ValidateRoadmapSavedViewDefinition(view); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, mutate := range []func(*RoadmapSavedViewDefinition){
		func(v *RoadmapSavedViewDefinition) { v.Title = " " },
		func(v *RoadmapSavedViewDefinition) { v.Audience = "admin" },
		func(v *RoadmapSavedViewDefinition) { v.Visibility = "public" },
		func(v *RoadmapSavedViewDefinition) { v.CycleBizID = "other" },
		func(v *RoadmapSavedViewDefinition) { v.Year = 999 },
		func(v *RoadmapSavedViewDefinition) { v.Quarter = 5 },
	} {
		view := base
		mutate(&view)
		if ValidateRoadmapSavedViewDefinition(view) == nil {
			t.Fatalf("invalid view accepted %+v", view)
		}
	}
	q := base.Query(2, 10)
	if q.Page != 2 || q.PageSize != 10 || q.CycleBizID != base.CycleBizID {
		t.Fatalf("query %+v", q)
	}
	if ValidateQuarterRoadmapQuery(base.Query(1, 101)) == nil {
		t.Fatal("saved view bypassed page bound")
	}
}
