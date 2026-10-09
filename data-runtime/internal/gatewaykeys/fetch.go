package gatewaykeys

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Fetch uses enrolled control credentials, never a business runtime credential.
// Redirects are refused so credentials cannot travel to a second origin.
func (s *Store) Fetch(ctx context.Context, platformURL, controlToken string, client *http.Client, now time.Time) error {
	base, err := url.Parse(platformURL)
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || !strings.HasPrefix(controlToken, "hzy_ctl_") {
		s.Reject()
		return ErrInvalid
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/api/v1/runtime/gateway-keyset"
	base.RawPath = ""
	q := url.Values{"runtimeCode": {s.binding.RuntimeCode}, "gatewayDeployment": {s.binding.GatewayDeployment}}
	base.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base.String(), nil)
	if err != nil {
		s.Reject()
		return ErrInvalid
	}
	req.Header.Set("Authorization", "Bearer "+controlToken)
	copyClient := *client
	copyClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := copyClient.Do(req)
	if err != nil {
		return ErrUnavailable
	} // preserve verified keys only until signed expiry
	defer response.Body.Close()
	if response.StatusCode == http.StatusServiceUnavailable || response.StatusCode == http.StatusNotFound {
		s.Unavailable()
		return ErrUnavailable
	}
	if response.StatusCode != http.StatusOK {
		s.Reject()
		return ErrUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(raw) > 65536 {
		s.Reject()
		return ErrInvalid
	}
	return s.Accept(raw, now)
}
