package providers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestWeComTransportErrorsDoNotExposeCredentialURLs(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("upstream failed: %s", request.URL.String())
	})}
	provider := &WeComProvider{http: client, tokens: make(map[string]wecomToken)}

	_, tokenErr := provider.accessToken(context.Background(), "https://wecom.invalid", "wecom.default", "corp-id", "corp-secret-value", 1)
	assertSafeProviderError(t, tokenErr, "wecom_token_request_failed", "corp-secret-value")

	_, sendErr := provider.sendTextCard(context.Background(), "https://wecom.invalid", "access-token-value", "alice", "100001", SendRequest{
		Title: "title", Description: "description", URL: "https://example.test/action",
	})
	assertSafeProviderError(t, sendErr, "wecom_send_request_failed", "access-token-value")
}

func TestWeComHTTPErrorBodiesAreNotReturned(t *testing.T) {
	const sensitiveBody = `{"errcode":40013,"errmsg":"access_token=upstream-secret internal=https://private.invalid"}`
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusBadGateway,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(sensitiveBody)),
			Request:    request,
		}, nil
	})}
	provider := &WeComProvider{http: client, tokens: make(map[string]wecomToken)}

	_, tokenErr := provider.accessToken(context.Background(), "https://wecom.invalid", "wecom.default", "corp-id", "corp-secret-value", 1)
	assertSafeProviderError(t, tokenErr, "wecom_token_http_error", "upstream-secret", "private.invalid")

	_, sendErr := provider.sendTextCard(context.Background(), "https://wecom.invalid", "access-token-value", "alice", "100001", SendRequest{
		Title: "title", Description: "description", URL: "https://example.test/action",
	})
	assertSafeProviderError(t, sendErr, "wecom_send_http_error", "upstream-secret", "private.invalid", "access-token-value")
}

func assertSafeProviderError(t *testing.T, err error, code string, forbidden ...string) {
	t.Helper()
	var httpError *httperror.Error
	if !errors.As(err, &httpError) {
		t.Fatalf("error = %#v, want httperror", err)
	}
	if httpError.Code != code {
		t.Fatalf("error code = %q, want %q", httpError.Code, code)
	}
	for _, value := range forbidden {
		if strings.Contains(httpError.Message, value) {
			t.Fatalf("error message %q exposed %q", httpError.Message, value)
		}
	}
}
