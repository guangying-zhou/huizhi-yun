package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/version"
)

func runDirectoryConnectorEnrollment(args []string) error {
	consoleURL := strings.TrimRight(strings.TrimSpace(os.Getenv("HZY_DIRECTORY_CONNECTOR_CONSOLE_URL")), "/")
	token := strings.TrimSpace(os.Getenv("HZY_DIRECTORY_CONNECTOR_ENROLLMENT_TOKEN"))
	privateKeyFile := envDefault("HZY_DIRECTORY_CONNECTOR_PRIVATE_KEY_FILE", "/etc/hzy-data-runtime/directory/directory-connector-private.pem")
	runtimeURL := envDefault("HZY_DIRECTORY_CONNECTOR_RUNTIME_URL", "http://127.0.0.1:"+envDefault("HZY_DATA_RUNTIME_PORT", "18080"))
	output := ""
	flags := flag.NewFlagSet("directory-connector-enroll", flag.ContinueOnError)
	flags.StringVar(&consoleURL, "console-url", consoleURL, "tenant Console base URL")
	flags.StringVar(&token, "token", token, "Platform-signed single-use connector enrollment token")
	flags.StringVar(&privateKeyFile, "private-key-file", privateKeyFile, "connector RSA private key file")
	flags.StringVar(&output, "output-env", output, "write connector credentials to this env file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if consoleURL == "" || token == "" || output == "" {
		return errors.New("console-url, token and output-env are required")
	}
	parsed, err := url.Parse(consoleURL)
	if err != nil || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return errors.New("Console URL must use HTTPS (loopback HTTP is allowed for development)")
	}
	key, err := loadOrCreateConnectorEnrollmentKey(privateKeyFile)
	if err != nil {
		return err
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return err
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	payload, _ := json.Marshal(map[string]any{
		"enrollmentToken": token,
		"publicKeyPem":    publicPEM,
		"version":         version.Version,
		"capabilities":    []string{"ldap.read", "ldap.user.create", "ldap.password.change", "ldap.connection.test"},
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, consoleURL+"/api/v1/console/directory-connectors/enroll", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("redeem Directory Connector enrollment: %w", err)
	}
	defer resp.Body.Close()
	content, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Directory Connector enrollment returned HTTP %d", resp.StatusCode)
	}
	var result struct {
		ConnectorID string `json:"connectorId"`
	}
	if err := json.Unmarshal(content, &result); err != nil || result.ConnectorID == "" {
		return errors.New("Directory Connector enrollment response is invalid")
	}
	lines := []string{
		envLine("HZY_DIRECTORY_CONNECTOR_ID", result.ConnectorID),
		envLine("HZY_DIRECTORY_CONNECTOR_PRIVATE_KEY_FILE", privateKeyFile),
		envLine("HZY_DIRECTORY_CONNECTOR_STATE_CACHE_FILE", filepath.Join(filepath.Dir(privateKeyFile), "state-cache.json")),
		envLine("HZY_DIRECTORY_CONNECTOR_RUNTIME_URL", runtimeURL),
		envLine("HZY_DIRECTORY_CONNECTOR_POLL_SECONDS", "3"),
		envLine("HZY_DIRECTORY_CONNECTOR_HTTP_TIMEOUT_SECONDS", "30"),
		envLine("HZY_DIRECTORY_CONNECTOR_CONFIG_RETRY_SECONDS", "300"),
	}
	if err := os.WriteFile(output, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		return fmt.Errorf("write Directory Connector environment: %w", err)
	}
	return nil
}

func loadOrCreateConnectorEnrollmentKey(path string) (*rsa.PrivateKey, error) {
	content, err := os.ReadFile(path)
	if err == nil {
		block, _ := pem.Decode(content)
		if block == nil {
			return nil, errors.New("Directory Connector private key PEM is invalid")
		}
		parsed, parseErr := x509.ParsePKCS8PrivateKey(block.Bytes)
		key, ok := parsed.(*rsa.PrivateKey)
		if parseErr != nil || !ok || key.N.BitLen() < 3072 {
			return nil, errors.New("Directory Connector private key must be RSA 3072 bits or stronger")
		}
		return key, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, err
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0600); err != nil {
		return nil, err
	}
	return key, nil
}
