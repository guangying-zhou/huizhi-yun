package projectscope

import (
	"encoding/json"
	"os"
	"testing"
)

func TestFoundationSharedProjectionFixture(t *testing.T) {
	data, err := os.ReadFile("../../../foundation/test/fixtures/project-scope-projection.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name       string     `json:"name"`
		Projection Projection `json:"projection"`
		Cases      []struct {
			Facts   Facts `json:"facts"`
			Allowed bool  `json:"allowed"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			for _, row := range fixture.Cases {
				actual, err := fixture.Projection.Allows(row.Facts)
				if err != nil || actual != row.Allowed {
					t.Fatalf("allowed=%v err=%v want=%v", actual, err, row.Allowed)
				}
			}
		})
	}
}

func TestMalformedProjectionFailsClosed(t *testing.T) {
	for _, p := range []Projection{
		{}, {Version: 1, Masks: []int{65536}}, {Version: 1, Masks: []int{15, 15}},
		{Version: 1, ProjectCodes: []string{"263", "263"}, Masks: []int{15, 15, 15}},
		{Version: 1, ProjectCodes: []string{"\x00other"}, Masks: []int{15, 15}},
		{Version: 1, DepartmentTreeRoots: []string{"D"}, Masks: []int{15, 15}},
	} {
		if allowed, err := p.Allows(Facts{ProjectCode: "263", Member: true, Owner: true}); err == nil || allowed {
			t.Fatalf("malformed projection accepted: %#v", p)
		}
	}
}
