package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"testing"
)

func TestEnterpriseCustomerWorkspacePermitVectors(t *testing.T) {
	raw, e := os.ReadFile("testdata/enterprise-altoc-customer-workspace-permits.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures []struct {
		Name, Method, Target, Token, Canonical, Signature string
		Authorization                                     enterpriseAltocReadPermit
	}
	if e = json.Unmarshal(raw, &fixtures); e != nil {
		t.Fatal(e)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			request := httptest.NewRequest(f.Method, f.Target, nil)
			request.Header.Set("Authorization", "Bearer "+f.Token)
			request.Header.Set("X-HZY-Enterprise-Altoc-Permit-Signature", f.Signature)
			if enterpriseAltocReadPermitCanonical(request, f.Authorization) != f.Canonical {
				t.Fatal("Go/TS vector mismatch")
			}
			if e := verifyEnterpriseAltocReadPermitSignature(request, f.Authorization); e != nil {
				t.Fatal(e)
			}
			mutations := []func(*enterpriseAltocReadPermit){func(p *enterpriseAltocReadPermit) { p.Query.IndustryCode = "other" }, func(p *enterpriseAltocReadPermit) { p.Query.RegionCode = "other" }, func(p *enterpriseAltocReadPermit) { p.Query.UpdatedDateFrom = "2020-01-01" }, func(p *enterpriseAltocReadPermit) { p.Query.UpdatedDateTo = "2030-01-01" }, func(p *enterpriseAltocReadPermit) { p.Query.CustomerSort = "updated_asc" }, func(p *enterpriseAltocReadPermit) { p.Query.ContactsOnly = !p.Query.ContactsOnly }, func(p *enterpriseAltocReadPermit) { p.Query.DecisionRole = "other" }, func(p *enterpriseAltocReadPermit) { p.Query.PrimaryOnly = !p.Query.PrimaryOnly }, func(p *enterpriseAltocReadPermit) { p.Query.StarredOnly = !p.Query.StarredOnly }, func(p *enterpriseAltocReadPermit) { p.Query.Workspace = !p.Query.Workspace }, func(p *enterpriseAltocReadPermit) { p.Query.OwnerUID = "other" }}
			for _, change := range mutations {
				p := f.Authorization
				change(&p)
				if verifyEnterpriseAltocReadPermitSignature(request, p) == nil {
					t.Fatal("tampered query accepted")
				}
			}
		})
	}
}
