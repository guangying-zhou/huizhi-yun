package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Invoked from the dedicated catalog HTTP/MySQL fixture; no ambient DB/DSN.
func exerciseEnterpriseWorkspaceHTTP(t *testing.T, url string, template *http.Request, db *sql.DB) {
	t.Helper()
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO aims_product_workspaces(product_code,biz_id,status,revision,positioning,created_by,updated_by) VALUES('A','workspace-A','active',1,'Aims positioning','person-a','person-a')")
	call := func(mutate func(*enterpriseWorkspaceInput, *http.Request)) (int, string) {
		facts, err := pc.LoadAuthorizationFacts(context.Background(), db, "A", "person-a")
		if err != nil {
			t.Fatal(err)
		}
		input := enterpriseWorkspaceInput{ProductCode: "A", Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: pc.AuthorizationPermit{Resource: "products", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli()}, AssetsAuthorization: enterpriseDirectoryAuthorization{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "products", Action: "view", ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(), Scope: map[string]string{"current_user_assets_object_access": "relation", "current_user_assets_scope_units": `[{"directRelation":true,"relationPredicates":["owner"]}]`}}}
		request, _ := http.NewRequest(http.MethodPost, url+"/v1/enterprise/aims/product-workspace:view", nil)
		request.Header = template.Header.Clone()
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, runtimeBearerToken(request), request.Method, request.URL.RequestURI(), "person-a", nil, request.Header.Get("X-HZY-Actor-Signed-At")))
		if mutate != nil {
			mutate(&input, request)
		}
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		request.Body = io.NopCloser(bytes.NewReader(raw))
		request.ContentLength = int64(len(raw))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	code, body := call(nil)
	if code != 200 || !strings.Contains(body, "Renamed live") || !strings.Contains(body, "Aims positioning") {
		t.Fatalf("workspace detail %d %s", code, body)
	}
	code, body = call(func(i *enterpriseWorkspaceInput, _ *http.Request) {
		i.AssetsAuthorization.Scope = map[string]string{"current_user_assets_object_access": "none"}
	})
	var out struct {
		Data pc.WorkspaceDetail `json:"data"`
	}
	if code != 200 || json.Unmarshal([]byte(body), &out) != nil || out.Data.ProductName != nil || out.Data.ProductLine != nil || out.Data.Positioning == nil {
		t.Fatalf("Assets denied workspace %d %s", code, body)
	}
	for _, mutate := range []func(*enterpriseWorkspaceInput, *http.Request){
		func(i *enterpriseWorkspaceInput, _ *http.Request) { i.Authorization.Facts.ActorUID = "other" },
		func(i *enterpriseWorkspaceInput, _ *http.Request) { i.Authorization.Facts.ProductCode = "other" },
		func(i *enterpriseWorkspaceInput, _ *http.Request) { i.Authorization.Action = "edit" },
		func(i *enterpriseWorkspaceInput, _ *http.Request) { i.Tenant = "other" },
		func(i *enterpriseWorkspaceInput, _ *http.Request) { i.AssetsAuthorization.Deployment = "other" },
		func(_ *enterpriseWorkspaceInput, r *http.Request) { r.Header.Set("X-HZY-Actor-Uid", "other") },
	} {
		if code, body := call(mutate); code != 403 {
			t.Fatalf("workspace forged context accepted %d %s", code, body)
		}
	}
	if code, body := call(func(i *enterpriseWorkspaceInput, _ *http.Request) { i.Authorization.Facts.Revision-- }); code != 409 {
		t.Fatalf("workspace stale facts %d %s", code, body)
	}
	t.Log("workspace HTTP keeps owning fields/current Assets identity, denies forged contexts and redacts unavailable current identity")
}
