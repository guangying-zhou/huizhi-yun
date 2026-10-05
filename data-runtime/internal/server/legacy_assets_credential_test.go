package server

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"testing"
)

func TestLegacyUnifiedAssetsRequiresOwningLiveCredential(t *testing.T) {
	base := auth.Context{Mode: "jwt", Tenant: "tenant-a", Deployment: "assets-test", AppCode: "assets", ClientID: "assets.runtime", Subject: "client:assets.runtime", CredentialID: 1, Scopes: []string{"assets.write"}}
	for name, change := range map[string]func(*auth.Context){
		"tenant": func(a *auth.Context) { a.Tenant = "other" }, "deployment": func(a *auth.Context) { a.Deployment = "enterprise-test" }, "app": func(a *auth.Context) { a.AppCode = "enterprise" }, "client": func(a *auth.Context) { a.ClientID = "enterprise.runtime" }, "subject": func(a *auth.Context) { a.Subject = "user" }, "credential": func(a *auth.Context) { a.CredentialID = 0 }, "colon token": func(a *auth.Context) { a.Scopes = []string{"assets:write"} }, "wildcard": func(a *auth.Context) { a.Scopes = []string{"assets.*"} }, "mode": func(a *auth.Context) { a.Mode = "static" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := base
			change(&candidate)
			called := false
			err := verifyLegacyUnifiedAssetsCredential(context.Background(), candidate, "tenant-a", "assets-test", func(context.Context, auth.Context, string) (bool, error) { called = true; return true, nil })
			if err == nil || called {
				t.Fatalf("identity accepted or queried live state: %v, %v", err, called)
			}
		})
	}
	for _, outcome := range []struct {
		active  bool
		err     error
		wantErr bool
	}{{true, nil, false}, {false, nil, true}, {false, errors.New("offline"), true}} {
		err := verifyLegacyUnifiedAssetsCredential(context.Background(), base, "tenant-a", "assets-test", func(_ context.Context, a auth.Context, scope string) (bool, error) {
			if a.CredentialID != 1 || scope != "assets:write" {
				t.Fatal("wrong state lookup")
			}
			return outcome.active, outcome.err
		})
		if (err != nil) != outcome.wantErr {
			t.Fatalf("live result %v", err)
		}
	}
}
