package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestAPFTenderPermitMatrix(t *testing.T) {
	for path, spec := range enterpriseAPFPaths {
		if !enterpriseapf.IsTenderOperation(spec.operation) {
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
			payload := map[string]any{}
			id := "1"
			switch spec.operation {
			case "tenders-page", "tender-agencies-page":
				id = ""
				payload = map[string]any{"page": float64(1), "pageSize": float64(20)}
			case "tenders-create":
				id = ""
				payload = map[string]any{"name": "标记", "owner_uid": "Person"}
			case "tender-agencies-create":
				id = ""
				payload = map[string]any{"name": "标记代理", "agency_type": "group"}
			case "tenders-update":
				payload = map[string]any{"expectedVersion": float64(1), "name": "新名称"}
			case "tender-members-add":
				payload = map[string]any{"expectedVersion": float64(1), "user_id": "Person", "role": "member"}
			case "tender-members-remove":
				payload = map[string]any{"expectedVersion": float64(1), "childId": "2"}
			case "tender-milestones-create":
				payload = map[string]any{"expectedVersion": float64(1), "name": "节点"}
			case "tender-milestones-update":
				payload = map[string]any{"expectedVersion": float64(1), "childId": "2", "name": "节点"}
			}
			i := apfInput{Sales: &enterpriseapf.SalesInput{ID: id, Payload: payload}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "opportunity", Action: action, Operation: spec.operation, ObjectID: id, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{}}}}
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
			if !strings.HasSuffix(path, ":"+strings.Split(spec.operation, "-")[len(strings.Split(spec.operation, "-"))-1]) {
				t.Fatal("path mapping")
			}
		})
	}
}
