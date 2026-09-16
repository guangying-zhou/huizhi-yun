package directoryconnector

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type RuntimeClient struct {
	baseURL     string
	connectorID string
	privateKey  *rsa.PrivateKey
	httpClient  *http.Client
}

func NewRuntimeClient(cfg Config, connectorID string, privateKey *rsa.PrivateKey) *RuntimeClient {
	return &RuntimeClient{
		baseURL: cfg.RuntimeURL, connectorID: connectorID, privateKey: privateKey,
		httpClient: &http.Client{Timeout: cfg.HTTPTimeout},
	}
}

func runtimeCanonicalRequest(method, path, timestamp, nonce, bodySHA string) string {
	return strings.Join([]string{strings.ToUpper(method), path, timestamp, nonce, bodySHA}, "\n")
}

func (c *RuntimeClient) request(ctx context.Context, path string, body any, output any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	// Sign and send the same canonical JSON shape that data-runtime verifies
	// after decoding into map/slice values. This also makes struct-backed LDAP
	// user arrays independent from Go field declaration order.
	var canonicalBody any
	if err := json.Unmarshal(encoded, &canonicalBody); err != nil {
		return err
	}
	encoded, err = json.Marshal(canonicalBody)
	if err != nil {
		return err
	}
	bodyDigest := sha256.Sum256(encoded)
	bodySHA := hex.EncodeToString(bodyDigest[:])
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonceBytes := make([]byte, 18)
	if _, err := rand.Read(nonceBytes); err != nil {
		return err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	canonical := runtimeCanonicalRequest(http.MethodPost, path, timestamp, nonce, bodySHA)
	digest := sha256.Sum256([]byte(canonical))
	signature, err := rsa.SignPSS(rand.Reader, c.privateKey, crypto.SHA256, digest[:], nil)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("X-HZY-Directory-Connector-ID", c.connectorID)
	req.Header.Set("X-HZY-Directory-Timestamp", timestamp)
	req.Header.Set("X-HZY-Directory-Nonce", nonce)
	req.Header.Set("X-HZY-Directory-Body-SHA256", bodySHA)
	req.Header.Set("X-HZY-Directory-Signature", base64.RawURLEncoding.EncodeToString(signature))
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	content, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := sanitizedHTTPErrorDetail(content)
		if detail != "" {
			return fmt.Errorf("data-runtime %s returned HTTP %d: %s", path, resp.StatusCode, detail)
		}
		return fmt.Errorf("data-runtime %s returned HTTP %d", path, resp.StatusCode)
	}
	if output != nil && len(content) > 0 {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(content, &envelope); err == nil && len(envelope.Data) > 0 {
			content = envelope.Data
		}
		if err := json.Unmarshal(content, output); err != nil {
			return err
		}
	}
	return nil
}

func sanitizedHTTPErrorDetail(content []byte) string {
	var payload map[string]any
	if json.Unmarshal(content, &payload) == nil {
		parts := make([]string, 0, 2)
		for _, key := range []string{"code", "message"} {
			if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
				parts = append(parts, strings.TrimSpace(value))
			}
		}
		if nested, ok := payload["error"].(map[string]any); ok {
			for _, key := range []string{"code", "message"} {
				if value, ok := nested[key].(string); ok && strings.TrimSpace(value) != "" {
					parts = append(parts, strings.TrimSpace(value))
				}
			}
		}
		if len(parts) > 0 {
			return truncateHTTPDetail(strings.Join(parts, ": "))
		}
	}
	return truncateHTTPDetail(string(content))
}

func truncateHTTPDetail(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 300 {
		value = value[:300]
	}
	return value
}

func (c *RuntimeClient) Lease(ctx context.Context) (*LeasedCommand, error) {
	var result struct {
		Command *LeasedCommand `json:"command"`
	}
	if err := c.request(ctx, "/runtime/internal/directory-connector/commands/lease", map[string]any{}, &result); err != nil {
		return nil, err
	}
	return result.Command, nil
}

func (c *RuntimeClient) Configuration(ctx context.Context) (LDAPConfiguration, error) {
	var result LDAPConfiguration
	err := c.request(ctx, "/runtime/internal/directory-connector/configuration", map[string]any{}, &result)
	return result, err
}

func (c *RuntimeClient) Complete(ctx context.Context, command *LeasedCommand, body map[string]any) error {
	body["fencingToken"] = command.FencingToken
	return c.request(ctx, "/runtime/internal/directory-connector/commands/"+url.PathEscape(command.OperationID)+"/complete", body, nil)
}

func (c *RuntimeClient) PushSync(ctx context.Context, users []LDAPUser, full bool) error {
	return c.request(ctx, "/runtime/internal/directory-connector/sync", map[string]any{"users": users, "fullSync": full}, nil)
}
