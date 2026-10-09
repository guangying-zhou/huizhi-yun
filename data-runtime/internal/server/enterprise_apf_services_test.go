package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestAPFServiceAgreementPermitMatrix(t *testing.T) {
	for path, spec := range enterpriseAPFPaths {
		if !enterpriseapf.IsServiceAgreementOperation(spec.operation) {
			continue
		}
		t.Run(spec.operation, func(t *testing.T) {
			now := time.Now()
			revision := int64(1)
			a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "altoc:enterprise-host:execute" }, true)
			route.LogicalTarget = "altoc"
			v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
			if e != nil {
				t.Fatal(e)
			}
			r.Method = http.MethodPost
			r.URL.Path = path
			_, action, _ := enterpriseapf.SalesPermission(spec.operation)
			id := "1"
			payload := map[string]any{"expectedVersion": float64(1), "childId": "2"}
			switch spec.operation {
			case "service-agreements-page":
				id = ""
				fallthrough
			case "service-coverages-page", "service-projects-page":
				payload = map[string]any{"page": float64(1), "pageSize": float64(20)}
			case "service-agreements-view":
				payload = map[string]any{}
			case "service-agreements-create":
				id = ""
				payload = map[string]any{"name": "标记服务", "contract_id": "1"}
			case "service-agreements-update":
				payload = map[string]any{"expectedVersion": float64(1), "name": "更新服务"}
			case "service-coverages-create", "service-coverages-resolve":
				payload = map[string]any{"expectedVersion": float64(1), "target_type": "delivery_asset", "delivery_asset_code": "DA-1"}
				if spec.operation == "service-coverages-resolve" {
					payload["childId"] = "2"
				}
			case "service-projects-bind":
				payload = map[string]any{"expectedVersion": float64(1), "project_code": "P-1", "project_role": "maintenance"}
			}

			i := apfInput{Sales: &enterpriseapf.SalesInput{ID: id, Payload: payload}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "contract", Action: action, Operation: spec.operation, ObjectID: id, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{}}}}
			sign := func() {
				mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
				mac.Write([]byte(apfPermitCanonical(r, i)))
				r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
			}
			sign()
			if e = validateAPFPermit(r, i, spec, v, now); e != nil {
				t.Fatal(e)
			}
			for _, field := range []string{"resource", "action", "actor", "tenant", "deployment", "expired", "denied", "object"} {
				save := i.Authorization
				switch field {
				case "resource":
					i.Authorization.Resource = "customer"
				case "action":
					if action == "view" {
						i.Authorization.Action = "edit"
					} else {
						i.Authorization.Action = "view"
					}
				case "actor":
					i.Authorization.ActorUID = "forged"
				case "tenant":
					i.Authorization.Tenant = "other"
				case "deployment":
					i.Authorization.Deployment = "other"
				case "expired":
					i.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli()
				case "denied":
					i.Authorization.Allowed = false
				case "object":
					i.Authorization.ObjectID = "99"
				}
				sign()
				if validateAPFPermit(r, i, spec, v, now) == nil {
					t.Fatal(field, "reached business")
				}
				i.Authorization = save
			}
			sign()
			i.Sales.Payload["forged"] = true
			if validateAPFPermit(r, i, spec, v, now) == nil {
				t.Fatal("payload tamper")
			}
		})
	}
}

func TestAPFServicesGoldenFixture(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-service-agreement-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if apfPermitCanonical(r, f.Body) != f.Canonical {
		t.Fatal(apfPermitCanonical(r, f.Body))
	}
}
