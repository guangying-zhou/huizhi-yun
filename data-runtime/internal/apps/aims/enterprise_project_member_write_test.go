package aims

import "testing"

func TestEnterpriseProjectMemberLeaderAndSelfProtection(t *testing.T) {
	for _, c := range []struct {
		leader, actor, uid, action, role string
		deny                             bool
	}{{"U1", "U2", "U1", "remove", "", true}, {"U1", "U2", "U1", "role", "member", true}, {"U1", "U2", "U2", "remove", "", true}, {"U1", "U2", "U1", "role", "manager", false}, {"U1", "U2", "U3", "role", "viewer", false}} {
		err := validateEnterpriseProjectMemberRemoval(c.leader, c.actor, c.uid, c.action, c.role)
		if (err != nil) != c.deny {
			t.Fatalf("unexpected decision %+v: %v", c, err)
		}
	}
}
func TestEnterpriseProjectMemberCapabilitiesAreSeparate(t *testing.T) {
	seen := map[string]bool{}
	for _, capability := range []string{EnterpriseProjectMemberAddCapability, EnterpriseProjectMemberRoleCapability, EnterpriseProjectMemberRemoveCapability} {
		if seen[capability] {
			t.Fatal("write capabilities must be separate")
		}
		seen[capability] = true
	}
}
