package peoplejobs

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const peopleBatchPath = "/runtime/internal/connector-runtime/people-sync-batches"

type DataRuntimeSink struct {
	baseURL, connectorID string
	key                  *rsa.PrivateKey
	http                 *http.Client
}

func NewDataRuntimeSink(baseURL, connectorID, keyFile string) (*DataRuntimeSink, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	loopbackHTTP := parsed != nil && parsed.Scheme == "http" && isLoopback(parsed.Hostname())
	remoteHTTPS := parsed != nil && parsed.Scheme == "https" && parsed.Hostname() != ""
	cleanOrigin := parsed != nil && parsed.Host != "" && parsed.User == nil && parsed.RawQuery == "" && parsed.Fragment == "" && parsed.RawPath == "" && (parsed.Path == "" || parsed.Path == "/")
	if err != nil || (!loopbackHTTP && !remoteHTTPS) || !cleanOrigin {
		return nil, errors.New("data-runtime URL must be an HTTPS origin or a loopback HTTP origin")
	}
	content, err := os.ReadFile(keyFile)
	if err != nil {
		return nil, fmt.Errorf("read connector private key: %w", err)
	}
	block, _ := pem.Decode(content)
	if block == nil {
		return nil, errors.New("connector private key PEM is invalid")
	}
	parsedKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	key, ok := parsedKey.(*rsa.PrivateKey)
	if err != nil || !ok || key.N.BitLen() < 3072 {
		return nil, errors.New("connector private key must be RSA 3072 bits or stronger")
	}
	if strings.TrimSpace(connectorID) == "" {
		return nil, errors.New("connector ID is required")
	}
	return &DataRuntimeSink{
		baseURL:     strings.TrimRight(parsed.String(), "/"),
		connectorID: connectorID,
		key:         key,
		http: &http.Client{
			Timeout: 60 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func (s *DataRuntimeSink) Apply(ctx context.Context, batch Batch) (Counts, error) {
	body, err := json.Marshal(batch)
	if err != nil {
		return Counts{}, err
	}
	sum := sha256.Sum256(body)
	bodySHA := hex.EncodeToString(sum[:])
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonceBytes := make([]byte, 18)
	if _, err = rand.Read(nonceBytes); err != nil {
		return Counts{}, err
	}
	nonce := base64.RawURLEncoding.EncodeToString(nonceBytes)
	canonical := strings.Join([]string{http.MethodPost, peopleBatchPath, timestamp, nonce, bodySHA}, "\n")
	digest := sha256.Sum256([]byte(canonical))
	signature, err := rsa.SignPSS(rand.Reader, s.key, crypto.SHA256, digest[:], nil)
	if err != nil {
		return Counts{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+peopleBatchPath, bytes.NewReader(body))
	if err != nil {
		return Counts{}, err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("X-HZY-Connector-Runtime-ID", s.connectorID)
	req.Header.Set("X-HZY-Connector-Timestamp", timestamp)
	req.Header.Set("X-HZY-Connector-Nonce", nonce)
	req.Header.Set("X-HZY-Connector-Body-SHA256", bodySHA)
	req.Header.Set("X-HZY-Connector-Signature", base64.RawURLEncoding.EncodeToString(signature))
	resp, err := s.http.Do(req)
	if err != nil {
		return Counts{}, err
	}
	defer resp.Body.Close()
	content, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return Counts{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Counts{}, fmt.Errorf("data-runtime People batch returned HTTP %d", resp.StatusCode)
	}
	counts, err := decodeDataRuntimeCounts(content)
	if err != nil {
		return Counts{}, err
	}
	return counts, nil
}

func decodeDataRuntimeCounts(content []byte) (Counts, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(content, &raw); err != nil {
		return Counts{}, err
	}
	payload := raw
	if data, ok := raw["data"]; ok {
		if err := json.Unmarshal(data, &payload); err != nil {
			return Counts{}, errors.New("data-runtime People batch response data is invalid")
		}
	}
	if _, hasApplied := payload["applied"]; !hasApplied {
		if _, hasSkipped := payload["skipped"]; !hasSkipped {
			return Counts{}, errors.New("data-runtime People batch response is missing applied and skipped counts")
		}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return Counts{}, err
	}
	var counts Counts
	if err = json.Unmarshal(encoded, &counts); err != nil {
		return Counts{}, err
	}
	return counts, nil
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
