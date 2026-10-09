package server

import "testing"

func TestEnterpriseProjectListPaginationQueryKeys(t *testing.T) {
	for _, scenario := range []struct {
		name      string
		spec      enterpriseDelegatedSpec
		projectID string
	}{
		{name: "deliverables", spec: enterpriseProjectDeliverableSpec},
		{name: "releases", spec: enterpriseProjectReleaseSpec, projectID: "42"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			input := enterpriseDelegatedInput{
				ProjectID: scenario.projectID,
				Query: map[string]string{
					"page": "2", "pageSize": "20", "current_user_dept_codes": "D-1",
				},
			}
			query, err := enterpriseDelegatedQuery(input, scenario.spec, scenario.spec.Actions["list"], "person-a")
			if err != nil {
				t.Fatal(err)
			}
			if query.Get("page") != "2" || query.Get("pageSize") != "20" || query.Get("current_user") != "person-a" || query.Get("current_user_dept_codes") != "D-1" {
				t.Fatalf("forwarded query = %v", query)
			}
			input.Query["actor"] = "forged"
			if _, err := enterpriseDelegatedQuery(input, scenario.spec, scenario.spec.Actions["list"], "person-a"); err == nil {
				t.Fatal("unlisted query key was accepted")
			}
		})
	}
}
