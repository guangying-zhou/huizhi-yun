package server

import "testing"

func TestEnterpriseCodocsFolderContractsBindActorAndFields(t *testing.T) {
	for _, action := range []string{"view", "update", "delete"} {
		input := enterpriseDelegatedInput{ObjectID: "12"}
		if action == "update" {
			input.Payload = map[string]any{"name": "Renamed", "parent_id": nil}
		}
		query, err := enterpriseCodocsFolderQuery(input, action, "actor")
		if err != nil || query.Get("current_user") != "actor" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("%s: %v %v", action, query, err)
		}
		for _, key := range []string{"current_user", "owner_uid", "codocs_trusted_department_manage_dept_code", "codocs_trusted_department_read_dept_code"} {
			input.Query = map[string]string{key: "forged"}
			if _, err := enterpriseCodocsFolderQuery(input, action, "actor"); err == nil {
				t.Fatalf("accepted %s", key)
			}
		}
	}
}

func TestEnterpriseCodocsFolderContractsRejectMalformedWrites(t *testing.T) {
	for _, payload := range []map[string]any{nil, {}, {"owner_uid": "forged"}, {"dept_code": "other"}, {"name": " "}, {"parent_id": -1.0}, {"parent_id": "2"}, {"parent_id": 2.5}} {
		if _, err := enterpriseCodocsFolderQuery(enterpriseDelegatedInput{ObjectID: "12", Payload: payload}, "update", "actor"); err == nil {
			t.Fatalf("accepted %#v", payload)
		}
	}
	for _, id := range []string{"0", "-1", "../12", "01", "9223372036854775808"} {
		if _, err := enterpriseCodocsFolderQuery(enterpriseDelegatedInput{ObjectID: id}, "delete", "actor"); err == nil {
			t.Fatalf("accepted id %s", id)
		}
	}
	if _, err := enterpriseCodocsFolderQuery(enterpriseDelegatedInput{ObjectID: "12"}, "create", "actor"); err == nil {
		t.Fatal("accepted unregistered operation")
	}
}
