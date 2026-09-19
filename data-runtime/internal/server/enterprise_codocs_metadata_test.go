package server

import "testing"

func TestEnterpriseCodocsMetadataRejectsPrivilegeAndStorageFields(t *testing.T) {
	for _, key := range []string{"owner_uid", "actorUid", "ossPath", "oss_path", "doc_type", "dept_code", "project_code", "serverAuthorized"} {
		input := enterpriseDelegatedInput{Code: "document-1", Payload: map[string]any{key: "forged"}}
		if _, err := enterpriseCodocsMetadataQuery(input, "edit-metadata", "actor"); err == nil {
			t.Errorf("accepted %s", key)
		}
	}
}

func TestEnterpriseCodocsMetadataBindsActorAndDesiredState(t *testing.T) {
	input := enterpriseDelegatedInput{Code: "document-1", Payload: map[string]any{"title": "Renamed", "star_flag": float64(1), "folder_id": nil}}
	query, err := enterpriseCodocsMetadataQuery(input, "edit-metadata", "actor")
	if err != nil || query.Get("current_user") != "actor" || query.Get("hzy_runtime_actor_delegated") != "1" {
		t.Fatalf("trusted query: %v %v", query, err)
	}
	for _, payload := range []map[string]any{nil, {}, {"title": " "}, {"star_flag": "1"}, {"readonly_flag": float64(2)}, {"folder_id": float64(-1)}, {"folder_id": float64(1.5)}} {
		input.Payload = payload
		if _, err := enterpriseCodocsMetadataQuery(input, "edit-metadata", "actor"); err == nil {
			t.Errorf("accepted invalid payload: %#v", payload)
		}
	}
	input.Payload = map[string]any{"star_flag": true}
	input.Query = map[string]string{"current_user": "forged"}
	if _, err := enterpriseCodocsMetadataQuery(input, "edit-metadata", "actor"); err == nil {
		t.Fatal("accepted actor override")
	}
}
