package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/version"
)

type enrollmentResponse struct {
	Data struct {
		RuntimeCode         string            `json:"runtimeCode"`
		TenantCode          string            `json:"tenantCode"`
		Environment         string            `json:"environment"`
		DesiredVersion      string            `json:"desiredVersion"`
		ReleaseSigningKeyID string            `json:"releaseSigningKeyId"`
		RuntimeToken        string            `json:"runtimeToken"`
		ControlToken        string            `json:"controlToken"`
		DeploymentBindings  map[string]string `json:"deploymentBindings"`
	} `json:"data"`
}

func runEnrollment(args []string) error {
	platformURL := strings.TrimRight(strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_PLATFORM_URL")), "/")
	code := strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_ENROLLMENT_CODE"))
	runtimeCode := strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_INSTANCE"))
	runtimeEndpoint := strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_PUBLIC_ENDPOINT"))
	expectedVersion := strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_VERSION"))
	expectedKeyID := strings.TrimSpace(os.Getenv("HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID"))
	output := ""

	flags := flag.NewFlagSet("enroll", flag.ContinueOnError)
	flags.StringVar(&platformURL, "platform-url", platformURL, "Platform control-plane base URL")
	flags.StringVar(&code, "code", code, "single-use enrollment code")
	flags.StringVar(&runtimeCode, "runtime-code", runtimeCode, "tenant runtime instance code")
	flags.StringVar(&runtimeEndpoint, "runtime-endpoint", runtimeEndpoint, "public runtime endpoint")
	flags.StringVar(&expectedVersion, "expected-version", expectedVersion, "approved exact runtime version")
	flags.StringVar(&expectedKeyID, "release-signing-key-id", expectedKeyID, "approved release signing key ID")
	flags.StringVar(&output, "output-env", output, "write the redeemed environment fragment to this file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if platformURL == "" || code == "" || runtimeCode == "" || expectedVersion == "" || expectedKeyID == "" || output == "" {
		return errors.New("platform-url, code, runtime-code, expected-version, release-signing-key-id and output-env are required")
	}
	parsed, err := url.Parse(platformURL)
	if err != nil || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost"))) {
		return errors.New("platform-url must use HTTPS (loopback HTTP is allowed for development)")
	}

	payload, _ := json.Marshal(map[string]string{
		"code": code, "runtimeCode": runtimeCode, "runtimeVersion": expectedVersion,
		"releaseSigningKeyId": expectedKeyID, "runtimeEndpoint": runtimeEndpoint,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, platformURL+"/api/v1/runtime/enroll", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("redeem enrollment: %w", err)
	}
	defer resp.Body.Close()
	content, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("redeem enrollment returned HTTP %d", resp.StatusCode)
	}
	var result enrollmentResponse
	if err := json.Unmarshal(content, &result); err != nil {
		return fmt.Errorf("decode enrollment response: %w", err)
	}
	if result.Data.RuntimeCode != runtimeCode || result.Data.RuntimeToken == "" || result.Data.ControlToken == "" {
		return errors.New("enrollment response binding or credentials are invalid")
	}
	if expectedVersion != "" && result.Data.DesiredVersion != expectedVersion {
		return fmt.Errorf("enrollment desired version %s does not match installer version %s", result.Data.DesiredVersion, expectedVersion)
	}
	if version.Version != "dev" && version.Version != "" && result.Data.DesiredVersion != version.Version {
		return fmt.Errorf("installed binary version %s does not match enrollment version %s", version.Version, result.Data.DesiredVersion)
	}
	if expectedKeyID != "" && result.Data.ReleaseSigningKeyID != expectedKeyID {
		return errors.New("enrollment release signing key ID mismatch")
	}
	bindingsJSON, err := json.Marshal(result.Data.DeploymentBindings)
	if err != nil {
		return err
	}
	lines := []string{
		envLine("HZY_DATA_RUNTIME_STATIC_TOKEN", result.Data.RuntimeToken),
		envLine("HZY_DATA_RUNTIME_CONTROL_TOKEN", result.Data.ControlToken),
		envLine("HZY_DATA_RUNTIME_PLATFORM_URL", platformURL),
		envLine("HZY_DATA_RUNTIME_INSTANCE", runtimeCode),
		envLine("HZY_DATA_RUNTIME_DEPLOYMENT", runtimeCode),
		envLine("HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64", base64.StdEncoding.EncodeToString(bindingsJSON)),
		envLine("HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_ID", result.Data.ReleaseSigningKeyID),
	}
	if runtimeEndpoint != "" {
		lines = append(lines, envLine("HZY_DATA_RUNTIME_PUBLIC_ENDPOINT", runtimeEndpoint))
	}
	if err := os.WriteFile(output, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		return fmt.Errorf("write enrollment environment: %w", err)
	}
	return nil
}

func envLine(key, value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	value = strings.ReplaceAll(value, "\n", "")
	return key + "=\"" + value + "\""
}
