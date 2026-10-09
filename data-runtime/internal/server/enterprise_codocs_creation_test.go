package server

import (
	"errors"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func requireCreationHTTPStatus(t *testing.T, err error, status int) {
	t.Helper()
	var httpErr httperror.Error
	if err == nil || !errors.As(err, &httpErr) || httpErr.Status != status {
		t.Fatalf("error = %v, want HTTP %d", err, status)
	}
}

func TestEnterpriseCodocsCreationQueryValidatesPayloadAndRejectsInjection(t *testing.T) {
	base := enterpriseDelegatedInput{Payload: map[string]any{
		"title":          "Deck",
		"doc_type":       "slide",
		"content_sha256": strings.Repeat("a", 64),
		"content_size":   float64(12),
	}}
	query, err := enterpriseCodocsCreationQuery(base, "create", "actor-1")
	if err != nil || query.Get("current_user") != "actor-1" || query.Get("operator_uid") != "actor-1" {
		t.Fatalf("valid creation rejected or actor not bound: query=%v err=%v", query, err)
	}
	for name, payload := range map[string]map[string]any{
		"owner injection": {"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1), "owner_uid": "victim"},
		"path injection":  {"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1), "oss_path": "codocs/users/victim/x"},
		"uuid injection":  {"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1), "uuid": "spoof"},
		"wrong kind":      {"title": "x", "doc_type": "department", "content_sha256": strings.Repeat("a", 64), "content_size": float64(1)},
		"bad hash":        {"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("A", 64), "content_size": float64(1)},
		"bad size":        {"title": "x", "doc_type": "private", "content_sha256": strings.Repeat("a", 64), "content_size": float64(-1)},
	} {
		t.Run(name, func(t *testing.T) {
			input := base
			input.Payload = payload
			_, err := enterpriseCodocsCreationQuery(input, "create", "actor-1")
			requireCreationHTTPStatus(t, err, 400)
		})
	}
	input := base
	input.Query = map[string]string{"current_user": "spoof", "oss_path": "codocs/company/x"}
	_, err = enterpriseCodocsCreationQuery(input, "create", "actor-1")
	requireCreationHTTPStatus(t, err, 400)
	_, err = enterpriseCodocsCreationQuery(base, "create", "")
	requireCreationHTTPStatus(t, err, 400)
}

func TestEnterpriseCodocsCreationRouteIsExplicit(t *testing.T) {
	if len(enterpriseCodocsCreationRoutes) != 1 {
		t.Fatalf("routes = %d, want one", len(enterpriseCodocsCreationRoutes))
	}
	route, ok := enterpriseCodocsCreationRoutes["/v1/enterprise/codocs/personal-documents:create"]
	if !ok || route.Spec.Domain != "codocs" || route.Spec.Resource != "personal-documents" || route.Action != "create" {
		t.Fatalf("unexpected route: %#v", enterpriseCodocsCreationRoutes)
	}
	if route.Spec.Actions["create"].PermitAction != "create" || route.Spec.Actions["create"].Method != "POST" {
		t.Fatalf("unexpected action: %#v", route.Spec.Actions["create"])
	}
}
