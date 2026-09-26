package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
)

func snapshotRouteInput(action string, payload map[string]any) enterpriseDelegatedInput {
	permit := "edit"
	if action == "snapshot-read" {
		permit = "read"
	}
	return enterpriseDelegatedInput{Tenant: "tenant-a", Deployment: "enterprise-test", Code: "doc-1", Payload: payload, Authorization: enterpriseDelegatedPermit{
		ActorUID: "user-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "personal-documents", Action: permit, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(),
	}}
}

func TestEnterpriseSnapshotRoutesUseExactPersonalDocumentPermits(t *testing.T) {
	command := map[string]any{"generation": float64(0), "epoch": float64(0), "markdownSha256": strings.Repeat("a", 64), "markdownSize": float64(5)}
	for action, permit := range map[string]string{"snapshot-prepare": "edit", "snapshot-publish": "edit", "snapshot-read": "read"} {
		route, ok := enterpriseCodocsDocumentSnapshotRoutes["/v1/enterprise/codocs/personal-documents:"+action]
		if !ok || route.Spec.Actions[action].PermitAction != permit || route.Spec.Domain != "codocs" || route.Spec.Resource != "personal-documents" {
			t.Fatalf("%s: incorrect route %#v", action, route)
		}
		payload := command
		if action == "snapshot-read" {
			payload = nil
		}
		if _, err := enterpriseCodocsDocumentSnapshotQuery(snapshotRouteInput(action, payload), action, "user-a"); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		wrongBody := map[string]any(nil)
		if action == "snapshot-read" {
			wrongBody = command
		}
		if _, err := enterpriseCodocsDocumentSnapshotQuery(snapshotRouteInput(action, wrongBody), action, "user-a"); err == nil {
			t.Fatalf("%s: accepted wrong body presence", action)
		}
		if _, err := enterpriseCodocsDocumentSnapshotQuery(snapshotRouteInput(action, payload), action, ""); err == nil {
			t.Fatalf("%s: accepted missing actor", action)
		}
	}
}

func TestDecodeSnapshotCommandIsStrict(t *testing.T) {
	digest := strings.Repeat("b", 64)
	base := func() map[string]any {
		return map[string]any{"generation": float64(3), "epoch": float64(1), "markdownSha256": digest, "markdownSize": float64(10)}
	}
	cmd, _, err := decodeSnapshotCommand("doc-1", base(), false)
	if err != nil || cmd.UUID != "doc-1" || cmd.Generation != 3 || cmd.Epoch != 1 || cmd.MarkdownSize != 10 || cmd.YjsSize != 0 {
		t.Fatalf("prepare decode %+v %v", cmd, err)
	}
	publish := base()
	publish["yjsSha256"], publish["yjsSize"] = digest, float64(7)
	publish["objects"] = map[string]any{
		"markdown": map[string]any{"key": "codocs/snapshots/p/body.md", "version": "V1"},
		"yjs":      map[string]any{"key": "codocs/snapshots/p/body.yjs", "version": "V2"},
	}
	cmd, objects, err := decodeSnapshotCommand("doc-1", publish, true)
	if err != nil || cmd.YjsSize != 7 || objects.Markdown.Version != "V1" || objects.Yjs == nil || objects.Yjs.Version != "V2" {
		t.Fatalf("publish decode %+v %+v %v", cmd, objects, err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"uuid override":      func(p map[string]any) { p["uuid"] = "other" },
		"unknown field":      func(p map[string]any) { p["tenant"] = "x" },
		"fractional":         func(p map[string]any) { p["generation"] = 1.5 },
		"negative":           func(p map[string]any) { p["markdownSize"] = float64(-1) },
		"string number":      func(p map[string]any) { p["epoch"] = "1" },
		"missing generation": func(p map[string]any) { delete(p, "generation") },
		"digest not string":  func(p map[string]any) { p["markdownSha256"] = float64(1) },
		"objects on prepare": func(p map[string]any) { p["objects"] = map[string]any{} },
		"too large":          func(p map[string]any) { p["markdownSize"] = float64(1 << 60) },
	} {
		payload := base()
		mutate(payload)
		if _, _, err := decodeSnapshotCommand("doc-1", payload, false); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	for name, objects := range map[string]any{
		"missing":       nil,
		"no markdown":   map[string]any{"yjs": map[string]any{"key": "k", "version": "v"}},
		"extra object":  map[string]any{"markdown": map[string]any{"key": "k", "version": "v"}, "other": map[string]any{"key": "k", "version": "v"}},
		"extra field":   map[string]any{"markdown": map[string]any{"key": "k", "version": "v", "bucket": "b"}},
		"empty version": map[string]any{"markdown": map[string]any{"key": "k", "version": ""}},
		"not an object": "codocs/snapshots/x",
	} {
		payload := base()
		if objects != nil {
			payload["objects"] = objects
		}
		if _, _, err := decodeSnapshotCommand("doc-1", payload, true); err == nil {
			t.Fatalf("objects %s accepted", name)
		}
	}
}

type fakeRetentionStorage struct {
	calls     int
	retention consoleapp.OSSBucketRetention
	err       error
}

func (f *fakeRetentionStorage) GetOSSBucketRetention(context.Context, string, consoleapp.VaultAccessMeta) (consoleapp.OSSBucketRetention, error) {
	f.calls++
	return f.retention, f.err
}

func TestSnapshotRetentionCacheRemembersOnlySuccessBriefly(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	cache := snapshotRetentionCache{now: func() time.Time { return now }}
	if cache.check(context.Background(), nil) == nil {
		t.Fatal("unbound storage must fail closed")
	}
	storage := &fakeRetentionStorage{err: errors.New("oss down")}
	if cache.check(context.Background(), storage) == nil || cache.check(context.Background(), storage) == nil || storage.calls != 2 {
		t.Fatalf("failures must not be cached, calls=%d", storage.calls)
	}
	storage.err = nil
	storage.retention = consoleapp.OSSBucketRetention{Versioning: "Enabled", Rules: []consoleapp.OSSLifecycleRule{{Prefix: "codocs/", Enabled: true, ExpirationDays: 30}}}
	if cache.check(context.Background(), storage) == nil {
		t.Fatal("current-object expiry over snapshots must fail")
	}
	// The real test bucket shape: noncurrent expiry only.
	storage.retention.Rules = []consoleapp.OSSLifecycleRule{{Prefix: "codocs/", Enabled: true, NoncurrentDays: 30}}
	calls := storage.calls
	if err := cache.check(context.Background(), storage); err != nil {
		t.Fatal(err)
	}
	if err := cache.check(context.Background(), storage); err != nil || storage.calls != calls+1 {
		t.Fatalf("success must be cached, calls=%d err=%v", storage.calls, err)
	}
	now = now.Add(snapshotRetentionTTL)
	if err := cache.check(context.Background(), storage); err != nil || storage.calls != calls+2 {
		t.Fatalf("cache must expire, calls=%d err=%v", storage.calls, err)
	}
}

func TestSnapshotRoutesAreOffUnlessEnabled(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		s := &Server{}
		s.cfg.Apps.Codocs.SnapshotV2Enabled = enabled
		request := httptest.NewRequest(http.MethodPost, "/v1/enterprise/codocs/personal-documents:snapshot-publish", strings.NewReader(`{}`))
		_, err := s.route(request)
		// The Codocs handler answers first when enabled (no Enterprise config here).
		reachedHandler := err != nil && strings.HasPrefix(err.Error(), "enterprise_codocs_unavailable:")
		if reachedHandler != enabled {
			t.Fatalf("enabled=%v reachedHandler=%v err=%v", enabled, reachedHandler, err)
		}
	}
}

func TestCollaborationOpenRouteIsExactAndDoublyGated(t *testing.T) {
	route, ok := enterpriseCodocsCollaborationSessionRoutes["/v1/enterprise/codocs/personal-documents:collaboration-open"]
	if !ok || route.Spec.Actions["collaboration-open"].PermitAction != "edit" || route.Spec.Resource != "personal-documents" {
		t.Fatalf("incorrect route %#v", route)
	}
	input := snapshotRouteInput("collaboration-open", nil)
	if _, err := enterpriseCodocsCollaborationSessionQuery(input, "collaboration-open", "user-a"); err != nil {
		t.Fatal(err)
	}
	input.Payload = map[string]any{"sessionId": "x"}
	if _, err := enterpriseCodocsCollaborationSessionQuery(input, "collaboration-open", "user-a"); err == nil {
		t.Fatal("collaboration-open accepted a body")
	}
	for _, flags := range [][2]bool{{false, false}, {true, false}, {false, true}, {true, true}} {
		s := &Server{}
		s.cfg.Apps.Codocs.SnapshotV2Enabled, s.cfg.Apps.Codocs.CollaborationV2Enabled = flags[0], flags[1]
		request := httptest.NewRequest(http.MethodPost, "/v1/enterprise/codocs/personal-documents:collaboration-open", strings.NewReader(`{}`))
		_, err := s.route(request)
		reached := err != nil && strings.HasPrefix(err.Error(), "enterprise_codocs_unavailable:")
		if reached != (flags[0] && flags[1]) {
			t.Fatalf("flags=%v reached=%v err=%v", flags, reached, err)
		}
	}
}

func TestCollaborationSnapshotRoutesUseExactCapabilities(t *testing.T) {
	want := map[string]string{
		"/v1/codocs/collaboration-snapshots:admit":    "codocs:collaboration-snapshots:read",
		"/v1/codocs/collaboration-snapshots:read":     "codocs:collaboration-snapshots:read",
		"/v1/codocs/collaboration-snapshots:prepare":  "codocs:collaboration-snapshots:publish",
		"/v1/codocs/collaboration-snapshots:publish":  "codocs:collaboration-snapshots:publish",
		"/v1/codocs/collaboration-snapshots:renew":    "codocs:collaboration-snapshots:publish",
		"/v1/codocs/collaboration-snapshots:close":    "codocs:collaboration-snapshots:publish",
		"/v1/codocs/collaboration-snapshots:upload":   "codocs:collaboration-snapshots:publish",
		"/v1/codocs/collaboration-snapshots:download": "codocs:collaboration-snapshots:read",
	}
	if len(collaborationSnapshotActions) != len(want) {
		t.Fatalf("unexpected routes: %v", collaborationSnapshotActions)
	}
	for path, capability := range want {
		if collaborationSnapshotActions[path] != capability {
			t.Fatalf("%s: got %q", path, collaborationSnapshotActions[path])
		}
	}
}
