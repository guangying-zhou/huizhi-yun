package providers

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
)

type fakeWeComConfigClient struct{}

func (fakeWeComConfigClient) Integration(context.Context, string) (consoleclient.Integration, error) {
	return consoleclient.Integration{
		IntegrationCode: "wecom.default",
		ProviderCode:    "wecom",
		BaseURL:         DefaultWeComBaseURL,
		Config:          map[string]any{"corpid": "corp-1", "agentid": "1000007"},
		CurrentCredential: &consoleclient.Credential{
			VersionNo: 8,
		},
	}, nil
}

func (fakeWeComConfigClient) ResolveSecret(context.Context, string) (consoleclient.Secret, error) {
	return consoleclient.Secret{Value: "vault-secret", VersionNo: 8}, nil
}

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestWeComIdentityExchangeReturnsOnlyNormalizedMemberSubject(t *testing.T) {
	var observedCode string
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/cgi-bin/gettoken":
			return jsonResponse(`{"errcode":0,"access_token":"provider-token","expires_in":7200}`), nil
		case "/cgi-bin/auth/getuserinfo":
			observedCode = request.URL.Query().Get("code")
			return jsonResponse(`{"errcode":0,"userid":"zhangsan","user_ticket":"must-not-escape"}`), nil
		default:
			t.Fatalf("unexpected provider path %s", request.URL.Path)
			return nil, nil
		}
	})}
	provider := newWeComProvider(fakeWeComConfigClient{}, client)
	result, err := provider.ExchangeIdentity(context.Background(), IdentityExchangeRequest{
		IntegrationCode: "wecom.default", AuthorizationCode: "one-time-code",
	})
	if err != nil {
		t.Fatalf("ExchangeIdentity error: %v", err)
	}
	if observedCode != "one-time-code" || result.Provider != "wecom" || result.IntegrationCode != "wecom.default" || result.Subject.ID != "zhangsan" || result.Subject.Kind != "member" {
		t.Fatalf("unexpected identity result=%+v code=%q", result, observedCode)
	}
	if strings.Contains(strings.ToLower(strings.TrimSpace(result.Subject.ID)), "ticket") {
		t.Fatalf("provider ticket leaked in normalized result: %+v", result)
	}
}

func TestWeComIdentityExchangeRejectsNonMemberAndInvalidCode(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path == "/cgi-bin/gettoken" {
			return jsonResponse(`{"errcode":0,"access_token":"provider-token","expires_in":7200}`), nil
		}
		return jsonResponse(`{"errcode":0,"openid":"external-user"}`), nil
	})}
	provider := newWeComProvider(fakeWeComConfigClient{}, client)
	if _, err := provider.ExchangeIdentity(context.Background(), IdentityExchangeRequest{AuthorizationCode: ""}); err == nil || !strings.Contains(err.Error(), "authorization code") {
		t.Fatalf("empty code error=%v", err)
	}
	if _, err := provider.ExchangeIdentity(context.Background(), IdentityExchangeRequest{AuthorizationCode: "one-time-code"}); err == nil || !strings.Contains(err.Error(), "enterprise member") {
		t.Fatalf("non-member error=%v", err)
	}
}
