package wizbiztool

import "testing"

func TestFollowupConfigOnlyCollabAdditions(t *testing.T) {
	old := []byte(`{"apps":{"codocs":{"db":{"user":"runtime"}}},"enterprise":{"generation":7}}`)
	if !followupConfigEqual(old, []byte(`{"apps":{"codocs":{"db":{"user":"runtime"},"collaborationV2Enabled":true,"departmentCollaborationV2Enabled":true}},"enterprise":{"generation":7}}`)) {
		t.Fatal("approved additive switches rejected")
	}
	for _, bad := range []string{
		`{"apps":{"codocs":{"db":{"user":"other"},"collaborationV2Enabled":true}},"enterprise":{"generation":7}}`,
		`{"apps":{"codocs":{"db":{"user":"runtime"}}},"enterprise":{"generation":8}}`,
		`{"apps":{"codocs":{"db":{"user":"runtime"},"collaborationV2Enabled":"true"}},"enterprise":{"generation":7}}`,
		`{"apps":{"codocs":{"db":{"user":"runtime"},"unknown":true}},"enterprise":{"generation":7}}`,
	} {
		if followupConfigEqual(old, []byte(bad)) {
			t.Fatal("non-allowlisted configuration change accepted")
		}
	}
	existing := []byte(`{"apps":{"codocs":{"collaborationV2Enabled":false}}}`)
	if followupConfigEqual(existing, []byte(`{"apps":{"codocs":{"collaborationV2Enabled":true}}}`)) {
		t.Fatal("existing switch changed")
	}
}
