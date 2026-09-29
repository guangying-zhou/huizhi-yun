package server

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDepartmentAssetReceiptRequiresDirectoryAndValidSource(t *testing.T) {
	server := &Server{}
	request := httptest.NewRequest(http.MethodPost, "/", nil)
	if err := server.requireEnterpriseCodocsDepartmentAssetRelation(request, "actor", "codocs/company/rules/a.md"); err != nil {
		t.Fatalf("company path changed: %v", err)
	}
	if err := server.requireEnterpriseCodocsDepartmentAssetRelation(request, "actor", "codocs/departments/../rules/a.md"); err == nil {
		t.Fatal("traversing department accepted")
	}
	if err := server.requireEnterpriseCodocsDepartmentAssetRelation(request, "actor", "codocs/departments/D1/rules/a.md"); err == nil {
		t.Fatal("department path accepted without Directory")
	}
}

func TestEnterpriseCodocsCompanyHostWritesNeverCallLegacyAdapterWrite(t *testing.T) {
	writes := []string{
		"record-access", "quick-publish-prepare", "quick-publish-complete",
		"mkdir-prepare", "mkdir-complete", "delete-directory-prepare", "delete-directory-complete",
		"move-prepare", "move-complete", "archive-prepare", "archive-complete",
	}
	for _, action := range writes {
		if enterpriseCodocsCompanyAssetsSpec.Actions[action].Method != http.MethodPost {
			t.Errorf("%s is not a Host write", action)
		}
	}
	if enterpriseCodocsPublishedAssetLinksSpec.Actions["create"].Method != http.MethodPost {
		t.Fatal("short link create is not a Host write")
	}
	// Every B2 resource is intercepted before the shared generic adapter call.
	// Inside the B2 dispatcher, the legacy adapter may only receive GETs.
	for _, file := range []string{"enterprise_codocs_reads.go", "enterprise_codocs_company_assets.go"} {
		parsed, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		if file == "enterprise_codocs_reads.go" {
			found := false
			ast.Inspect(parsed, func(node ast.Node) bool {
				decl, ok := node.(*ast.FuncDecl)
				if ok && decl.Name.Name == "routeEnterpriseCodocsOperation" {
					ast.Inspect(decl.Body, func(child ast.Node) bool {
						call, ok := child.(*ast.CallExpr)
						if ok {
							if selector, ok := call.Fun.(*ast.SelectorExpr); ok && selector.Sel.Name == "executeEnterpriseCodocsCompanyAssets" {
								found = true
							}
						}
						return true
					})
				}
				return true
			})
			if !found {
				t.Fatal("B2 is not intercepted after shared authorization")
			}
			continue
		}
		ast.Inspect(parsed, func(node ast.Node) bool {
			decl, ok := node.(*ast.FuncDecl)
			if !ok || decl.Name.Name != "executeEnterpriseCodocsCompanyAssets" {
				return true
			}
			ast.Inspect(decl.Body, func(child ast.Node) bool {
				call, ok := child.(*ast.CallExpr)
				if !ok {
					return true
				}
				selector, ok := call.Fun.(*ast.SelectorExpr)
				if !ok || selector.Sel.Name != "HandleRuntime" {
					return true
				}
				if len(call.Args) < 2 {
					t.Error("legacy adapter call has no method")
					return true
				}
				method, ok := call.Args[1].(*ast.SelectorExpr)
				if !ok || method.Sel.Name != "MethodGet" {
					t.Error("Host B2 can reach a legacy adapter write")
				}
				return true
			})
			return false
		})
	}
}

func TestEnterpriseCodocsCompanyAssetsRoutesExact(t *testing.T) {
	want := map[string]struct{ permit, method string }{
		"company-assets:record-access":             {"record-access", http.MethodPost},
		"company-assets:access-records":            {"admin", http.MethodGet},
		"company-assets:export-access-records":     {"export", http.MethodGet},
		"company-assets:quick-publish-source":      {"publish", http.MethodGet},
		"company-assets:quick-publish-prepare":     {"publish", http.MethodPost},
		"company-assets:quick-publish-complete":    {"publish", http.MethodPost},
		"company-assets:mkdir-prepare":             {"admin", http.MethodPost},
		"company-assets:mkdir-complete":            {"admin", http.MethodPost},
		"company-assets:delete-directory-prepare":  {"admin", http.MethodPost},
		"company-assets:delete-directory-complete": {"admin", http.MethodPost},
		"company-assets:move-prepare":              {"admin", http.MethodPost},
		"company-assets:move-complete":             {"admin", http.MethodPost},
		"company-assets:archive-prepare":           {"admin", http.MethodPost},
		"company-assets:archive-complete":          {"admin", http.MethodPost},
		"open-department-documents:list":           {"read", http.MethodGet},
		"open-department-documents:view":           {"read", http.MethodGet},
		"published-asset-links:create":             {"create", http.MethodPost},
		"published-asset-links:resolve":            {"resolve", http.MethodGet},
	}
	if len(enterpriseCodocsCompanyAssetsRoutes) != len(want) {
		t.Fatalf("routes=%d want=%d", len(enterpriseCodocsCompanyAssetsRoutes), len(want))
	}
	for suffix, expectation := range want {
		route, ok := enterpriseCodocsCompanyAssetsRoutes["/v1/enterprise/codocs/"+suffix]
		if !ok || route.Spec.Domain != "codocs" || route.Spec.Actions[route.Action].PermitAction != expectation.permit || route.Spec.Actions[route.Action].Method != expectation.method {
			t.Errorf("unexpected %s route: %#v", suffix, route)
		}
	}
}

func TestEnterpriseCodocsCompanyAssetsQueryRejectsActorAndMarkerInjection(t *testing.T) {
	input := enterpriseDelegatedInput{Payload: map[string]any{"path": "codocs/company/rules/a.md", "eventId": "550e8400-e29b-41d4-a716-446655440000"}}
	query, err := enterpriseCodocsCompanyAssetsQuery(input, "record-access", "person-a")
	if err != nil || query.Get("current_user") != "person-a" || query.Get("codocs_trusted_company_asset_access_action") != "record" {
		t.Fatalf("verified actor not bound: query=%v err=%v", query, err)
	}
	for key, value := range map[string]string{"current_user": "other", "owner": "other", "viewer": "other", "hzy_runtime_actor_delegated": "1", "dept_code": "A"} {
		bad := input
		bad.Query = map[string]string{key: value}
		if _, err := enterpriseCodocsCompanyAssetsQuery(bad, "record-access", "person-a"); err == nil {
			t.Errorf("accepted browser %s", key)
		}
	}
	bad := input
	bad.Payload = map[string]any{"path": "codocs/company/rules/a.md", "eventId": "550e8400-e29b-41d4-a716-446655440000", "viewer": "other"}
	if _, err := enterpriseCodocsCompanyAssetsQuery(bad, "record-access", "person-a"); err == nil {
		t.Fatal("accepted extra body identity")
	}
}

func TestEnterpriseCodocsOpenDepartmentUUIDOnlyNarrows(t *testing.T) {
	input := enterpriseDelegatedInput{Code: "550e8400-e29b-41d4-a716-446655440000"}
	query, err := enterpriseCodocsCompanyAssetsQuery(input, "view", "person-a")
	if err != nil || query.Get("uuid") != input.Code {
		t.Fatalf("uuid not bound: query=%v err=%v", query, err)
	}
	if query.Get("include_snapshot_ref") != "1" {
		t.Fatalf("view must request the snapshot reference: %v", query)
	}
	list, err := enterpriseCodocsCompanyAssetsQuery(enterpriseDelegatedInput{}, "list", "person-a")
	if err != nil || list.Has("include_snapshot_ref") {
		t.Fatalf("list must not request snapshot references: %v err=%v", list, err)
	}
	injected := input
	injected.Query = map[string]string{"include_snapshot_ref": "1"}
	if _, err := enterpriseCodocsCompanyAssetsQuery(injected, "list", "person-a"); err == nil {
		t.Fatal("browser include_snapshot_ref accepted")
	}
	input.Query = map[string]string{"dept_code": "other"}
	if _, err := enterpriseCodocsCompanyAssetsQuery(input, "view", "person-a"); err == nil {
		t.Fatal("department selector accepted")
	}
}
