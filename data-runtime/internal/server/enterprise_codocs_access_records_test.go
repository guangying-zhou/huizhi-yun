package server

import (
	"strings"
	"testing"
)

func TestEnterpriseCodocsAccessRecordQueryRequiresExactPayload(t *testing.T) {
	base := enterpriseDelegatedInput{Payload: map[string]any{
		"eventId":    "550e8400-e29b-41d4-a716-446655440000",
		"pathSha256": strings.Repeat("a", 64),
	}, Code: "550e8400-e29b-41d4-a716-446655440000"}
	for name, payload := range map[string]map[string]any{
		"extra field":      {"eventId": base.Payload["eventId"], "pathSha256": base.Payload["pathSha256"], "actor": "spoof"},
		"wrong event type": {"eventId": 12, "pathSha256": base.Payload["pathSha256"]},
		"wrong hash type":  {"eventId": base.Payload["eventId"], "pathSha256": 12},
		"uppercase hash":   {"eventId": base.Payload["eventId"], "pathSha256": strings.Repeat("A", 64)},
		"short hash":       {"eventId": base.Payload["eventId"], "pathSha256": "abc"},
	} {
		t.Run(name, func(t *testing.T) {
			input := base
			input.Payload = payload
			if _, err := enterpriseCodocsAccessRecordQuery(input, "record", "actor-1"); err == nil {
				t.Fatal("invalid access record payload accepted")
			}
		})
	}
	if _, err := enterpriseCodocsAccessRecordQuery(base, "record", ""); err == nil {
		t.Fatal("missing actor accepted")
	}
	query, err := enterpriseCodocsAccessRecordQuery(base, "record", "actor-1")
	if err != nil || query.Get("current_user") != "actor-1" || query.Get("operator_uid") != "actor-1" {
		t.Fatalf("valid input not bound to verified actor: query=%v err=%v", query, err)
	}
	for name, code := range map[string]string{"missing": "", "path traversal": "550e8400-e29b-41d4-a716-446655440000/..", "invalid": "!bad"} {
		t.Run("code/"+name, func(t *testing.T) {
			input := base
			input.Code = code
			if _, err := enterpriseCodocsAccessRecordQuery(input, "record", "actor-1"); err == nil {
				t.Fatal("invalid code accepted")
			}
		})
	}
	input := base
	input.Query = map[string]string{"current_user": "spoof", "operator_uid": "spoof"}
	if _, err := enterpriseCodocsAccessRecordQuery(input, "record", "actor-1"); err == nil {
		t.Fatal("caller-supplied actor query accepted")
	}
}

func TestEnterpriseCodocsAccessRecordRouteIsExplicitAndFixed(t *testing.T) {
	if len(enterpriseCodocsAccessRecordRoutes) != 1 {
		t.Fatalf("routes = %d, want one", len(enterpriseCodocsAccessRecordRoutes))
	}
	route, ok := enterpriseCodocsAccessRecordRoutes["/v1/enterprise/codocs/document-access-records:record"]
	if !ok || route.Spec.Domain != "codocs" || route.Spec.Resource != "document-access-records" || route.Action != "record" {
		t.Fatalf("unexpected route registration: %#v", enterpriseCodocsAccessRecordRoutes)
	}
	if route.Spec.Actions["record"].PermitAction != "record" || route.Spec.Actions["record"].Method != "POST" {
		t.Fatalf("unexpected route action: %#v", route.Spec.Actions["record"])
	}
}
