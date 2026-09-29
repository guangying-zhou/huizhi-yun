// hzy-enterprise-recover activates a reviewed recovery and then publishes its
// receipt using the enrolled Runtime control credential. Default is plan only.
package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/go-sql-driver/mysql"
	runtimeconfig "github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

type config struct {
	Activation                           unified.RecoveryActivation
	Database                             mysql.Config
	Preparation                          struct{ Payload, Signature string }
	PinnedPlatformPublicKey              string
	OwnerDatabaseUser, OwnerDatabaseHost string
	PlatformBaseURL, RuntimeControlToken string
	RuntimeConfigPath                    string
}

func run() error {
	path := flag.String("config", "", "protected local config")
	apply := flag.Bool("apply", false, "activate reviewed owner")
	publish := flag.Bool("publish", false, "publish committed receipt via Runtime control authentication")
	review := flag.String("review-hash", "", "exact reviewed activation hash")
	flag.Parse()
	if *path == "" {
		return errors.New("protected configuration required")
	}
	raw, err := os.ReadFile(*path)
	if err != nil {
		return errors.New("cannot read recovery configuration")
	}
	var c config
	if err = json.Unmarshal(raw, &c); err != nil {
		return errors.New("invalid recovery configuration")
	}
	hash := unified.RecoveryActivationHash(c.Activation)
	if !*apply {
		if *publish {
			return errors.New("publish requires explicit apply")
		}
		fmt.Println("recovery activation plan", hash)
		return nil
	}
	if *review != hash || c.Activation.ReviewHash != hash {
		return errors.New("activation review mismatch")
	}
	key, err := base64.RawURLEncoding.DecodeString(c.PinnedPlatformPublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return errors.New("invalid pinned Platform public key")
	}
	signature, err := base64.RawURLEncoding.DecodeString(c.Preparation.Signature)
	if err != nil {
		return errors.New("invalid preparation signature")
	}
	runtimeBytes, readErr := os.ReadFile(c.RuntimeConfigPath)
	if readErr != nil {
		return errors.New("actual replacement Runtime config required")
	}
	var runtime runtimeconfig.Config
	if json.Unmarshal(runtimeBytes, &runtime) != nil {
		return errors.New("invalid replacement Runtime config")
	}
	p := c.Activation
	binding, bindingErr := runtime.EnterpriseBinding()
	if bindingErr != nil || runtime.Tenant != p.Recovery.Final.Config.Tenant || runtime.Deployment != p.RuntimeDeployment || runtime.Control.RuntimeCode != p.RuntimeDeployment || runtime.Enterprise.InstanceID != p.Recovery.Final.Config.InstanceID || binding.Generation != p.Generation || binding.Storage.Database != p.Recovery.AimsTarget || runtime.Enterprise.DB.User != c.OwnerDatabaseUser || runtime.Apps.Aims.DB.User != c.OwnerDatabaseUser || runtime.Apps.Assets.DB.User != c.OwnerDatabaseUser || runtime.Apps.Aims.DB.Database != p.Recovery.AimsTarget || runtime.Apps.Assets.DB.Database != p.Recovery.AssetsTarget || binding.Domains["aims"].Scheduler != enterprise.PathUnified || runtime.Enterprise.AimsDeliveryWorker == nil || runtime.Enterprise.AimsDeliveryWorker.Deployment != p.WorkerDeployment || runtime.Enterprise.AimsDeliveryWorker.ServiceClientID != p.WorkerClientID {
		return errors.New("replacement Runtime configuration differs from reviewed owner")
	}
	for _, table := range p.Recovery.Tables {
		if table.Domain == "aims" && binding.Domains["aims"].Tables[table.Name] != table.Name {
			return errors.New("recovery logical table mapping incomplete")
		}
	}
	db, err := sql.Open("mysql", c.Database.FormatDSN())
	if err != nil {
		return errors.New("cannot open recovery database")
	}
	defer db.Close()
	db.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	verifier := unified.SQLRecoveryOwnerVerifier{Payload: []byte(c.Preparation.Payload), Signature: signature, PlatformPublicKey: ed25519.PublicKey(key), DatabaseUser: c.OwnerDatabaseUser, DatabaseHost: c.OwnerDatabaseHost}
	if err = unified.ActivateRecovery(ctx, db, c.Activation, verifier); err != nil {
		return err
	}
	if !*publish {
		fmt.Println("owner activated; route publication pending", hash)
		return nil
	}
	base, err := url.Parse(c.PlatformBaseURL)
	if err != nil || base.Scheme != "https" || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || c.RuntimeControlToken == "" {
		return errors.New("protected Platform HTTPS endpoint and Runtime control token required")
	}
	body, _ := json.Marshal(map[string]string{"tenantCode": p.Recovery.Final.Config.Tenant, "environment": p.Recovery.Final.Config.Environment, "recoveryKey": p.Recovery.RecoveryKey, "preparationSha256": p.RouteRevision, "activationSha256": hash, "runtimeCode": p.RuntimeDeployment, "generation": fmt.Sprint(p.Generation)})
	endpoint := base.ResolveReference(&url.URL{Path: "/api/v1/runtime/recovery-route"})
	client := http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("recovery publication redirect refused") }}
	for attempt := 0; attempt < 2; attempt++ {
		req, requestErr := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
		if requestErr != nil {
			return errors.New("cannot create recovery publication request")
		}
		req.Header.Set("Authorization", "Bearer "+c.RuntimeControlToken)
		req.Header.Set("Content-Type", "application/json")
		response, sendErr := client.Do(req)
		if sendErr != nil {
			return errors.New("recovery publication unavailable; owner remains activated and receipt can retry")
		}
		var result struct {
			Success bool `json:"success"`
			Data    struct {
				Published bool `json:"published"`
				Verified  bool `json:"verified"`
			} `json:"data"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 65536)).Decode(&result)
		response.Body.Close()
		if response.StatusCode != http.StatusOK || decodeErr != nil || !result.Success || !result.Data.Published || (attempt == 1 && !result.Data.Verified) {
			return errors.New("recovery publication or read-back verification rejected; receipt retained")
		}
	}
	fmt.Println("recovery owner and route published", hash)
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
