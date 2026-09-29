package codocs

import "testing"

func TestEnterpriseCompanyMutationPathBoundary(t *testing.T) {
	for _, good := range []string{"codocs/company/rules/a.md", "codocs/company/knowledge/folder/b.pdf"} {
		if !enterpriseCompanyObjectPath(good, false) {
			t.Errorf("rejected valid file %q", good)
		}
	}
	for _, bad := range []string{"codocs/company/rules/../private.md", "codocs/company/rules2/a.md", "codocs/company/products/a.md", "codocs/company/rules/a.md/", "codocs/company/rules/a\\b.md", "codocs/company/rules/"} {
		if enterpriseCompanyObjectPath(bad, false) {
			t.Errorf("accepted invalid file %q", bad)
		}
	}
	if !enterpriseCompanyObjectPath("codocs/company/rules/empty/", true) || enterpriseCompanyObjectPath("codocs/company/rules/", true) {
		t.Fatal("directory root boundary failed")
	}
}

func TestEnterpriseCompanyMutationRejectsCrossCategoryMove(t *testing.T) {
	base := map[string]any{"operationId": "550e8400-e29b-41d4-a716-446655440000", "sourcePath": "codocs/company/rules/a.md"}
	bad := map[string]any{"operationId": base["operationId"], "sourcePath": base["sourcePath"], "targetPath": "codocs/company/knowledge/a.md"}
	if _, err := enterpriseCompanyMutationCommand("move", bad); err == nil {
		t.Fatal("cross-category move accepted")
	}
	good := map[string]any{"operationId": base["operationId"], "sourcePath": base["sourcePath"], "targetPath": "codocs/company/rules/sub/a.md"}
	if _, err := enterpriseCompanyMutationCommand("move", good); err != nil {
		t.Fatal(err)
	}
	bad["targetPath"] = "codocs/archives/company/rules/other.md"
	if _, err := enterpriseCompanyMutationCommand("archive", bad); err == nil {
		t.Fatal("archive target rewrite accepted")
	}
}

func TestEnterpriseCompanyMutationDepartmentArchiveExactPath(t *testing.T) {
	id := "550e8400-e29b-41d4-a716-446655440000"
	good := map[string]any{"operationId": id, "sourcePath": "codocs/departments/D1/records/a.md", "targetPath": "codocs/archives/departments/D1/records/a.md"}
	if _, err := enterpriseCompanyMutationCommand("archive", good); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"codocs/archives/departments/D2/records/a.md", "codocs/archives/departments/D1/rules/a.md", "codocs/departments/D1/records/a.md"} {
		bad := map[string]any{"operationId": id, "sourcePath": good["sourcePath"], "targetPath": target}
		if _, err := enterpriseCompanyMutationCommand("archive", bad); err == nil {
			t.Errorf("accepted wrong target %q", target)
		}
	}
	good["sourcePath"] = "codocs/departments/D1/records/../a.md"
	if _, err := enterpriseCompanyMutationCommand("archive", good); err == nil {
		t.Fatal("accepted traversing source")
	}
}
