package server

import "testing"

func TestEnterpriseWorkItemPaginationKeysPreserveActorBoundary(t *testing.T) {
	for _, tc := range []struct {
		name      string
		spec      enterpriseDelegatedSpec
		keys      map[string]string
		projectID string
	}{
		{name: "my", spec: enterpriseMyWorkItemSpec, keys: map[string]string{"page": "2", "pageSize": "20", "status": "todo"}},
		{name: "project", spec: enterpriseProjectWorkItemListSpec, projectID: "42", keys: map[string]string{"page": "2", "pageSize": "20", "view": "board", "status": "todo", "quickFilter": "my_assigned", "severity": "high", "version_id": "__null__"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := enterpriseDelegatedInput{ProjectID: tc.projectID, Query: tc.keys}
			query, err := enterpriseDelegatedQuery(input, tc.spec, tc.spec.Actions["list"], "trusted-actor")
			if err != nil {
				t.Fatal(err)
			}
			for key, value := range tc.keys {
				if query.Get(key) != value {
					t.Fatalf("%s = %q", key, query.Get(key))
				}
			}
			if query.Get("current_user") != "trusted-actor" {
				t.Fatalf("actor = %q", query.Get("current_user"))
			}
			input.Query["current_user"] = "forged"
			if _, err := enterpriseDelegatedQuery(input, tc.spec, tc.spec.Actions["list"], "trusted-actor"); err == nil {
				t.Fatal("browser actor override accepted")
			}
		})
	}
}
