package server

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	assets "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseassets"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestEnterpriseAssetsProductsHTTPMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_ASSETS_MASTER_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing nonisolated socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.ParseTime = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	exec := func(db *sql.DB, q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	schemaDB := func() (string, *sql.DB) {
		name := "hzy_assets_master_" + strings.ReplaceAll(uuid.NewString(), "-", "")
		exec(root, "CREATE DATABASE `"+name+"` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin")
		t.Cleanup(func() { exec(root, "DROP DATABASE `"+name+"`") })
		c := *mc
		c.DBName = name
		db, err := sql.Open("mysql", c.FormatDSN())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { db.Close() })
		return name, db
	}
	name, db := schemaDB()
	_, consoleDB := schemaDB()

	legacyName, legacyDB := schemaDB()
	var instance string
	var port int
	if err = root.QueryRow("SELECT @@server_uuid,@@port").Scan(&instance, &port); err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile("../../../assets/docs/assets_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range []string{"20260710_assets_integration_operations.sql", "20260711_assets_dead_letter_actionable_lifecycle.sql"} {
		more, err := os.ReadFile("../../../assets/docs/migrations/" + migration)
		if err != nil {
			t.Fatal(err)
		}
		source = append(source, more...)
	}
	tables := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1)
	if len(tables) < 20 {
		t.Fatal("canonical Assets schema missing")
	}
	mapping := map[string]string{}
	renames := []string{}
	for _, target := range []*sql.DB{db, legacyDB} {
		target.SetMaxOpenConns(1)
		exec(target, "SET FOREIGN_KEY_CHECKS=0")
		for _, table := range tables {
			exec(target, table[0])
		}
		exec(target, "SET FOREIGN_KEY_CHECKS=1")
		// Exercise the deployable upgrade from the old cross-app-only constraint.
		exec(target, "ALTER TABLE service_command_receipt DROP CHECK chk_scr_cross_app, ADD CONSTRAINT chk_scr_cross_app CHECK(source_app<>target_app)")
		upgrade, err := os.ReadFile("../../../assets/docs/migrations/20260913_assets_owned_product_receipts.sql")
		if err != nil {
			t.Fatal(err)
		}
		exec(target, string(upgrade))
		exec(target, string(upgrade))
	}
	for _, table := range tables {
		mapping[table[1]] = "assets_" + table[1]
		renames = append(renames, "`"+table[1]+"` TO `assets_"+table[1]+"`")
	}
	exec(db, "RENAME TABLE "+strings.Join(renames, ","))
	db.SetMaxOpenConns(5)
	// Separate same-name owning-domain tables are tripwires, not substitute business fixtures.
	for _, table := range []string{"system_parameters", "service_command_receipt", "asset_events", "product_assets"} {
		exec(db, "CREATE TABLE aims_"+table+" LIKE assets_"+table)
	}
	exec(db, `INSERT INTO assets_system_parameters(param_key,param_value) VALUES('dictionary.fixture','{"code":"assets-only","name":"Assets"}')`)
	exec(db, `INSERT INTO aims_system_parameters(param_key,param_value) VALUES('dictionary.fixture','{"code":"aims-secret","name":"Aims"}')`)

	exec(db, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec(db, "INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','isolated','runtime-test','v1',0)")
	for _, q := range []string{"CREATE TABLE service_clients(id BIGINT PRIMARY KEY,status VARCHAR(20),current_credential_id BIGINT)", "CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,service_client_id BIGINT,client_id VARCHAR(128),status VARCHAR(20),expires_at DATETIME)", "CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(64),status VARCHAR(20))", "INSERT INTO service_clients VALUES(1,'active',7),(2,'active',8)", "INSERT INTO service_client_credentials VALUES(7,1,'enterprise.runtime','active',NULL),(8,2,'assets.runtime','active',NULL)", "INSERT INTO service_client_grants VALUES(1,'assets:product','read','active'),(1,'assets:product','edit','active'),(1,'assets:admin','admin','active'),(2,'assets','write','active')"} {
		exec(consoleDB, q)
	}
	password := uuid.NewString()
	exec(root, "CREATE USER 'hzy_assets_master'@'127.0.0.1' IDENTIFIED BY '"+password+"'")
	t.Cleanup(func() { exec(root, "DROP USER 'hzy_assets_master'@'127.0.0.1'") })
	for _, schema := range []string{name, legacyName} {
		exec(root, "GRANT SELECT,INSERT,UPDATE,DELETE,SHOW VIEW ON `"+schema+"`.* TO 'hzy_assets_master'@'127.0.0.1'")
	}
	dbc := config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_assets_master", Password: password, Database: name, ConnectionLimit: 4}
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test", "assets": "assets-test"}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "isolated", SchemaVersion: "v1", Generation: 1, InstanceID: instance, DB: dbc, Domains: map[string]config.EnterpriseDomainConfig{"assets": {OwnerDeployment: "enterprise-test", Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled, Tables: mapping}}}}
	for _, logical := range []string{"integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable"} {
		delete(mapping, logical)
	}
	binding, err := cfg.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	views := append(enterpriseassets.ProductViewNames(), "digital_assets", "digital_asset_products", "asset_environments", "ip_assets", "ip_asset_products", "service_command_receipt")
	plan, err := e.PlanCompatibilityViews(context.Background(), db, binding, "assets", views)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(context.Background(), db, binding, "assets", views, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec(db, "UPDATE enterprise_schema_registry SET generation=1")
	registry, err := initializeEnterpriseRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.Close() })
	service, err := enterpriseassets.NewProductService(context.Background(), registry, binding, "assets-test")
	if err != nil {
		t.Fatal(err)
	}
	dbc.Database = legacyName
	legacy, err := assets.New(config.AssetsConfig{DB: dbc})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { legacy.DB().Close() })
	dbc.Database = name
	unifiedBase, err := compat.New(compat.Config{DB: dbc})
	if err != nil {
		t.Fatal(err)
	}
	unified := &assets.Adapter{Adapter: unifiedBase}
	t.Cleanup(func() { unified.DB().Close() })
	if err = unified.ConfigureEnterpriseWrites(context.Background(), registry, binding); err != nil {
		t.Fatal(err)
	}
	// The product-only receipt schema rejects digital commands. Upgrade the
	// registered physical table through the real link and digital migrations;
	// never synthesize a CHECK clause in this fixture.
	oldDigitalScope := url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}, "current_user_assets_permission_action": {"edit"}}
	oldDigitalIdentity := assets.ProductMasterCommandIdentity{Tenant: "tenant-a", CommandDeployment: "assets-test", ActorUID: "person-a", ClientID: "enterprise.runtime", RequestID: "digital-old", Key: "digital-old"}
	if _, oldErr := unified.EnterpriseDigitalAssetCommand(context.Background(), oldDigitalIdentity, "create", 0, map[string]any{"digital_name": "old schema"}, oldDigitalScope); oldErr == nil {
		t.Fatal("old receipt schema accepted a digital command")
	} else {
		var httpErr httperror.Error
		if !errors.As(oldErr, &httpErr) || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "assets_digital_asset_receipt_schema_unavailable" {
			t.Fatalf("old digital schema returned wrong failure: %#v", oldErr)
		}
	}
	if _, oldLinkErr := service.Link(context.Background(), oldDigitalIdentity, "link-base", 1, map[string]any{"technology_base_id": 1}, oldDigitalScope); oldLinkErr == nil {
		t.Fatal("old receipt schema accepted product link")
	} else {
		var httpErr httperror.Error
		if !errors.As(oldLinkErr, &httpErr) || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "assets_link_receipt_schema_unavailable" {
			t.Fatalf("old link schema returned wrong failure: %#v", oldLinkErr)
		}
	}
	if _, oldIPErr := unified.EnterpriseIPAssetCommand(context.Background(), oldDigitalIdentity, "create", 0, map[string]any{"ip_name": "old schema"}, oldDigitalScope); oldIPErr == nil {
		t.Fatal("old receipt schema accepted an IP command")
	} else {
		var httpErr httperror.Error
		if !errors.As(oldIPErr, &httpErr) || httpErr.Status != http.StatusServiceUnavailable || httpErr.Code != "assets_ip_asset_receipt_schema_unavailable" {
			t.Fatalf("old IP schema returned wrong failure: %#v", oldIPErr)
		}
	}
	for _, path := range []string{"20260914_assets_owned_product_link_receipts.sql", "20260915_assets_owned_digital_asset_receipts.sql", "20260916_assets_owned_ip_asset_receipts.sql", "20260917_assets_owned_ip_asset_product_link_receipts.sql"} {
		migration, migrationErr := os.ReadFile("../../../assets/docs/migrations/" + path)
		if migrationErr != nil {
			t.Fatal(migrationErr)
		}
		exec(db, strings.Replace(string(migration), "ALTER TABLE service_command_receipt", "ALTER TABLE assets_service_command_receipt", 1))
		exec(legacyDB, string(migration))
	}
	if _, wrongPairErr := db.Exec("INSERT INTO assets_service_command_receipt(receipt_id,operation_id,tenant_code,deployment_code,source_app,target_app,source_deployment_code,operation_code,required_capability,idempotency_key,command_schema_version,command_sha256,original_actor_uid) VALUES(UUID(),UUID(),'tenant-a','assets-test','assets','assets','assets-test','assets.digital-assets.create.v1','assets:digital-asset:edit','wrong-pair','assets-owned-command.v1',REPEAT('0',64),'person-a')"); wrongPairErr == nil {
		t.Fatal("digital receipt accepted mismatched capability")
	} else {
		var mysqlErr *mysql.MySQLError
		if !errors.As(wrongPairErr, &mysqlErr) || mysqlErr.Number != 3819 || !strings.Contains(mysqlErr.Message, "chk_scr_cross_app") {
			t.Fatalf("wrong receipt-pair failure: %#v", wrongPairErr)
		}
	}
	if _, wrongIPPairErr := db.Exec("INSERT INTO assets_service_command_receipt(receipt_id,operation_id,tenant_code,deployment_code,source_app,target_app,source_deployment_code,operation_code,required_capability,idempotency_key,command_schema_version,command_sha256,original_actor_uid) VALUES(UUID(),UUID(),'tenant-a','assets-test','assets','assets','assets-test','assets.ip-assets.create.v1','assets:ip-asset:edit','wrong-ip-pair','assets-owned-command.v1',REPEAT('0',64),'person-a')"); wrongIPPairErr == nil {
		t.Fatal("IP receipt accepted mismatched capability")
	} else {
		var mysqlErr *mysql.MySQLError
		if !errors.As(wrongIPPairErr, &mysqlErr) || mysqlErr.Number != 3819 || !strings.Contains(mysqlErr.Message, "chk_scr_cross_app") {
			t.Fatalf("wrong IP receipt-pair failure: %#v", wrongIPPairErr)
		}
	}
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	jwks, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "assets-master", "x": base64.RawURLEncoding.EncodeToString(public)}}})
	cfg.Auth = config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(jwks)}}
	srv := httptest.NewServer(&Server{cfg: cfg, auth: auth.New(cfg), enterpriseRegistry: registry, enterpriseAssetsProducts: service, assets: legacy, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", consoleDB)})
	defer srv.Close()
	call := func(legacyRoute bool, action, key string, id int64, payload map[string]any, mutate func(map[string]any, *http.Request)) (int, map[string]any) {
		t.Helper()
		scope := "assets:product:read"
		permission := "view"
		resource := "products"
		if action == "create" || action == "edit" || strings.HasPrefix(action, "link-") {
			scope = "assets:product:edit"
			permission = "edit"
		}
		if strings.HasPrefix(action, "category-") {
			scope = "assets:admin:admin"
			permission = "admin"
			resource = "admin"
		}
		app, client, deployment, credential := "enterprise", "enterprise.runtime", "enterprise-test", 7
		method, path := http.MethodPost, "/v1/enterprise/assets/products:"+action
		if action == "dictionaries" {
			path = "/v1/enterprise/assets/product-dictionaries:list"
		}
		if action == "categories" {
			path = "/v1/enterprise/assets/product-categories:list"
		}
		if action == "category-save" {
			path = "/v1/enterprise/assets/product-categories:save"
		}
		permit := map[string]any{"actorUid": "person-a", "tenant": "tenant-a", "deployment": "enterprise-test", "resource": resource, "action": permission, "expiresAt": time.Now().Add(10 * time.Second).UnixMilli(), "scope": map[string]string{"current_user_assets_object_access": "all"}}
		outer := map[string]any{"id": id, "input": payload, "authorization": permit}
		if legacyRoute {
			app, client, deployment, credential = "assets", "assets.runtime", "assets-test", 8
			scope = "assets.write"
			path = "/v1/assets/products"
			if action == "edit" {
				method = http.MethodPatch
				path += "/" + strconv.FormatInt(id, 10)
			}
			if strings.HasPrefix(action, "link-") {
				path += "/" + strconv.FormatInt(id, 10) + "/" + map[string]string{"link-base": "bases", "link-asset": "assets", "link-document": "documents"}[action]
			}
			path += "?current_user_assets_object_access=all&current_user_assets_permission_action=edit&current_user_product_target_access=all"
			if action == "category-save" {
				path = "/v1/assets/admin/asset-categories"
				if id > 0 {
					method = http.MethodPut
					path += "/" + strconv.FormatInt(id, 10)
				}
				path += "?current_user_assets_object_access=all&current_user_assets_permission_action=admin"
			}
			outer = payload
		}
		now := time.Now()
		claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:" + client, "tenant": "tenant-a", "deployment": deployment, "source_app": app, "target_app": "data-runtime", "client_id": client, "token_use": "service", "scope": scope, "hzy": map[string]any{"credentialId": credential, "appCode": app}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "assets-master"
		bearer, err := token.SignedString(private)
		if err != nil {
			t.Fatal(err)
		}
		req, _ := http.NewRequest(method, srv.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("Idempotency-Key", key)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-HZY-Actor-Uid", "person-a")
		req.Header.Set("X-HZY-Actor-Signed-At", "1760000000000")
		req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, method, req.URL.RequestURI(), "person-a", nil, "1760000000000"))
		if mutate != nil {
			mutate(outer, req)
		}
		raw, _ := json.Marshal(outer)
		req.Body = io.NopCloser(bytes.NewReader(raw))
		req.ContentLength = int64(len(raw))
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ = io.ReadAll(response.Body)
		out := map[string]any{}
		if json.Unmarshal(raw, &out) != nil {
			t.Fatalf("nonJSON %d %s", response.StatusCode, raw)
		}
		return response.StatusCode, out
	}
	expect := func(code int, out map[string]any, want int) {
		t.Helper()
		if code != want {
			t.Fatalf("status %d want %d: %#v", code, want, out)
		}
	}
	count := func(table string) int {
		t.Helper()
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	// Digital assets use their own registered physical receipt table and must
	// retain replay, partial-null, scope and rollback guarantees under a real
	// random temporary MySQL instance.
	digitalScope := url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}, "current_user_assets_permission_action": {"edit"}}
	digitalIdentity := assets.ProductMasterCommandIdentity{Tenant: "tenant-a", CommandDeployment: "assets-test", ActorUID: "person-a", ClientID: "enterprise.runtime", RequestID: "digital-test", Key: "digital-create"}
	digitalID, err := unified.EnterpriseDigitalAssetCommand(context.Background(), digitalIdentity, "create", 0, map[string]any{"digital_code": "DIG-A", "digital_name": "Digital A", "storage_location": "oss://a", "owner_uid": "person-a", "status": "active"}, digitalScope)
	if err != nil || digitalID <= 0 {
		t.Fatalf("digital create: %d %v", digitalID, err)
	}
	if replay, replayErr := unified.EnterpriseDigitalAssetCommand(context.Background(), digitalIdentity, "create", 0, map[string]any{"digital_code": "DIG-A", "digital_name": "Digital A", "storage_location": "oss://a", "owner_uid": "person-a", "status": "active"}, digitalScope); replayErr != nil || replay != digitalID {
		t.Fatalf("digital replay: %d %v", replay, replayErr)
	}
	if _, mismatchErr := unified.EnterpriseDigitalAssetCommand(context.Background(), digitalIdentity, "create", 0, map[string]any{"digital_code": "DIG-A", "digital_name": "different"}, digitalScope); mismatchErr == nil {
		t.Fatal("digital idempotency mismatch accepted")
	}
	editIdentity := digitalIdentity
	editIdentity.Key = "digital-edit"
	if _, err = unified.EnterpriseDigitalAssetCommand(context.Background(), editIdentity, "edit", digitalID, map[string]any{"notes": "retained"}, digitalScope); err != nil {
		t.Fatal(err)
	}
	clearIdentity := digitalIdentity
	clearIdentity.Key = "digital-clear"
	if _, err = unified.EnterpriseDigitalAssetCommand(context.Background(), clearIdentity, "edit", digitalID, map[string]any{"storage_location": nil}, digitalScope); err != nil {
		t.Fatal(err)
	}
	var location, notes sql.NullString
	if err = db.QueryRow("SELECT storage_location,notes FROM assets_digital_assets WHERE id=?", digitalID).Scan(&location, &notes); err != nil || location.Valid || !notes.Valid || notes.String != "retained" {
		t.Fatalf("digital partial/null failed: %#v %#v %v", location, notes, err)
	}
	moveIdentity := digitalIdentity
	moveIdentity.Key = "digital-move"
	if _, err = unified.EnterpriseDigitalAssetCommand(context.Background(), moveIdentity, "edit", digitalID, map[string]any{"owner_uid": "person-b"}, digitalScope); err != nil {
		t.Fatal(err)
	}
	relationScope := url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"relation"}, "current_user_assets_permission_action": {"edit"}, "current_user_assets_scope_units": {`[{"directRelation":true,"relationPredicates":["owner"]}]`}}
	deniedIdentity := digitalIdentity
	deniedIdentity.Key = "digital-denied"
	if _, err = unified.EnterpriseDigitalAssetCommand(context.Background(), deniedIdentity, "edit", digitalID, map[string]any{"notes": "forbidden"}, relationScope); err == nil {
		t.Fatal("digital moved outside scope accepted")
	}
	beforeDigital, beforeReceipts := count("assets_digital_assets"), count("assets_service_command_receipt")
	exec(db, "CREATE TRIGGER fail_digital_event BEFORE INSERT ON assets_asset_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced digital audit failure'")
	failIdentity := digitalIdentity
	failIdentity.Key = "digital-rollback"
	if _, err = unified.EnterpriseDigitalAssetCommand(context.Background(), failIdentity, "create", 0, map[string]any{"digital_code": "DIG-ROLL", "digital_name": "rollback"}, digitalScope); err == nil {
		t.Fatal("digital audit failure accepted")
	}
	if count("assets_digital_assets") != beforeDigital || count("assets_service_command_receipt") != beforeReceipts {
		t.Fatal("digital audit failure did not roll back")
	}
	exec(db, "DROP TRIGGER fail_digital_event")
	list, err := unified.EnterpriseDigitalAssetsList(context.Background(), url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}, "page": {"1"}, "pageSize": {"1"}})
	if err != nil || list["total"].(int) != 1 || len(list["items"].([]map[string]any)) != 1 {
		t.Fatalf("digital snapshot list: %#v %v", list, err)
	}
	// IP commands use the same registered receipt table, with their own exact
	// operation/capability CHECK clauses and transaction-scoped object fence.
	ipWriteScope := url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}, "current_user_assets_permission_action": {"edit"}}
	ipIdentity := assets.ProductMasterCommandIdentity{Tenant: "tenant-a", CommandDeployment: "assets-test", ActorUID: "person-a", ClientID: "enterprise.runtime", RequestID: "ip-test", Key: "ip-create"}
	ipID, ipWriteErr := unified.EnterpriseIPAssetCommand(context.Background(), ipIdentity, "create", 0, map[string]any{"ip_code": "IP-WRITE-A", "ip_name": "IP Write A", "owner_uid": "person-a", "registration_no": "REG-A"}, ipWriteScope)
	if ipWriteErr != nil || ipID <= 0 {
		t.Fatalf("IP create: %d %v", ipID, ipWriteErr)
	}
	if replay, replayErr := unified.EnterpriseIPAssetCommand(context.Background(), ipIdentity, "create", 0, map[string]any{"ip_code": "IP-WRITE-A", "ip_name": "IP Write A", "owner_uid": "person-a", "registration_no": "REG-A"}, ipWriteScope); replayErr != nil || replay != ipID {
		t.Fatalf("IP replay: %d %v", replay, replayErr)
	}
	if _, mismatchErr := unified.EnterpriseIPAssetCommand(context.Background(), ipIdentity, "create", 0, map[string]any{"ip_code": "IP-WRITE-A", "ip_name": "changed"}, ipWriteScope); mismatchErr == nil {
		t.Fatal("IP idempotency mismatch accepted")
	}
	ipEdit := ipIdentity
	ipEdit.Key = "ip-edit"
	if _, ipWriteErr = unified.EnterpriseIPAssetCommand(context.Background(), ipEdit, "edit", ipID, map[string]any{"notes": "retained"}, ipWriteScope); ipWriteErr != nil {
		t.Fatal(ipWriteErr)
	}
	ipClear := ipIdentity
	ipClear.Key = "ip-clear"
	if _, ipWriteErr = unified.EnterpriseIPAssetCommand(context.Background(), ipClear, "edit", ipID, map[string]any{"registration_no": nil}, ipWriteScope); ipWriteErr != nil {
		t.Fatal(ipWriteErr)
	}
	var registration, ipNotes sql.NullString
	if err = db.QueryRow("SELECT registration_no,notes FROM assets_ip_assets WHERE id=?", ipID).Scan(&registration, &ipNotes); err != nil || registration.Valid || !ipNotes.Valid || ipNotes.String != "retained" {
		t.Fatalf("IP partial/null failed: %#v %#v %v", registration, ipNotes, err)
	}
	ipMove := ipIdentity
	ipMove.Key = "ip-move"
	if _, ipWriteErr = unified.EnterpriseIPAssetCommand(context.Background(), ipMove, "edit", ipID, map[string]any{"owner_uid": "person-b"}, ipWriteScope); ipWriteErr != nil {
		t.Fatal(ipWriteErr)
	}
	if _, ipWriteErr = unified.EnterpriseIPAssetCommand(context.Background(), assets.ProductMasterCommandIdentity{Tenant: "tenant-a", CommandDeployment: "assets-test", ActorUID: "person-a", ClientID: "enterprise.runtime", RequestID: "ip-denied", Key: "ip-denied"}, "edit", ipID, map[string]any{"notes": "forbidden"}, relationScope); ipWriteErr == nil {
		t.Fatal("IP moved outside relation scope accepted")
	}
	beforeIP, beforeIPReceipts := count("assets_ip_assets"), count("assets_service_command_receipt")
	exec(db, "CREATE TRIGGER fail_ip_event BEFORE INSERT ON assets_asset_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced IP audit failure'")
	ipRollback := ipIdentity
	ipRollback.Key = "ip-rollback"
	if _, ipWriteErr = unified.EnterpriseIPAssetCommand(context.Background(), ipRollback, "create", 0, map[string]any{"ip_code": "IP-ROLL", "ip_name": "rollback"}, ipWriteScope); ipWriteErr == nil {
		t.Fatal("IP audit failure accepted")
	}
	if count("assets_ip_assets") != beforeIP || count("assets_service_command_receipt") != beforeIPReceipts {
		t.Fatal("IP audit failure did not roll back")
	}
	exec(db, "DROP TRIGGER fail_ip_event")
	// IP reads use the same Registry snapshot, but their relation and project
	// predicates must remain conjunctive rather than widening either dimension.
	exec(db, "INSERT INTO assets_product_assets(id,product_code,product_name,product_line,customer_domain,business_domain,project_code,business_owner_uid,status) VALUES(81,'IP-P1','IP scope product','LINE','internal','internal','IP-PROJ','person-a','active'),(82,'IP-P2','other product','LINE','internal','internal','OTHER','person-a','active')")
	exec(db, "INSERT INTO assets_ip_assets(id,ip_code,ip_name,ip_type,status,owner_uid) VALUES(81,'IP-A','Scoped IP','software_copyright','active','person-a'),(82,'IP-B','Wrong project','software_copyright','active','person-a'),(83,'IP-C','Wrong owner','software_copyright','active','person-b')")
	exec(db, "INSERT INTO assets_ip_asset_products(ip_asset_id,product_asset_id) VALUES(81,81),(82,82),(83,82)")
	ipScope := url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"relation"}, "current_user_assets_scope_units": {`[{"directRelation":true,"relationPredicates":["owner"],"projectCodes":["IP-PROJ"]}]`}, "page": {"1"}, "pageSize": {"1"}}
	ipList, ipErr := unified.EnterpriseIPAssetsList(context.Background(), ipScope)
	if ipErr != nil || ipList["total"].(int) != 1 || len(ipList["items"].([]map[string]any)) != 1 || ipList["items"].([]map[string]any)[0]["id"] != int64(81) {
		t.Fatalf("IP snapshot conjunction/pagination failed: %#v %v", ipList, ipErr)
	}
	if _, present := ipList["items"].([]map[string]any)[0]["product_count"]; present {
		t.Fatal("IP list leaked or fabricated product association count")
	}
	if _, ipErr = unified.EnterpriseIPAssetsList(context.Background(), url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}, "page": {"not-a-page"}}); ipErr == nil {
		t.Fatal("IP list accepted malformed pagination")
	}
	if _, ipErr = unified.EnterpriseIPAssetsList(context.Background(), url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}, "page": {"1000001"}}); ipErr == nil {
		t.Fatal("IP list accepted overflowing pagination")
	}
	if _, ipErr = unified.EnterpriseIPAssetView(context.Background(), ipScope, 82); ipErr == nil {
		t.Fatal("IP detail ignored project conjunction")
	}
	if _, ipErr = unified.EnterpriseIPAssetView(context.Background(), ipScope, 83); ipErr == nil {
		t.Fatal("IP detail ignored owner relation")
	}
	productScope := url.Values{"current_user": {"person-a"}, "current_user_assets_permission_action": {"view"}, "current_user_assets_object_access": {"relation"}, "current_user_assets_scope_units": {`[{"projectCodes":["IP-PROJ"]}]`}}
	linked, linkErr := unified.EnterpriseIPAssetProductsView(context.Background(), ipScope, productScope, 81)
	if linkErr != nil || linked["total"] != 1 || linked["items"].([]map[string]any)[0]["product_code"] != "IP-P1" {
		t.Fatalf("IP product relation scope failed: %#v %v", linked, linkErr)
	}
	productScope.Set("current_user_assets_scope_units", `[{"projectCodes":["OTHER"]}]`)
	linked, linkErr = unified.EnterpriseIPAssetProductsView(context.Background(), ipScope, productScope, 81)
	if linkErr != nil || linked["total"] != 0 {
		t.Fatalf("IP product relation leaked outside product scope: %#v %v", linked, linkErr)
	}
	if _, linkErr = unified.EnterpriseIPAssetProductsView(context.Background(), ipScope, productScope, 82); linkErr == nil {
		t.Fatal("IP products ignored source object scope")
	}
	productsBeforeCreate, receiptsBeforeCreate := count("assets_product_assets"), count("assets_service_command_receipt")
	first := map[string]any{"product_code": "PROD-A", "product_name": "First", "product_line": "FC", "business_owner_uid": "person-a"}
	code, out := call(false, "create", "fixed-non-v4-key", 0, first, nil)
	if code != 200 {
		_, diagnostic := service.Command(context.Background(), assets.ProductMasterCommandIdentity{Tenant: "tenant-a", CommandDeployment: "assets-test", ActorUID: "person-a", ClientID: "enterprise.runtime", RequestID: "diagnostic", Key: "diagnostic"}, "create", 0, first, url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}, "current_user_assets_permission_action": {"edit"}})
		t.Fatalf("first command HTTP %d, internal: %v", code, diagnostic)
	}
	expect(code, out, 200)
	id := int64(out["data"].(map[string]any)["id"].(float64))
	code, out = call(true, "create", "fixed-non-v4-key", 0, first, nil)
	expect(code, out, 200)
	if int64(out["data"].(map[string]any)["id"].(float64)) != id || count("assets_product_assets") != productsBeforeCreate+1 || count("assets_service_command_receipt") != receiptsBeforeCreate+1 {
		t.Fatal("cross-entry replay duplicated")
	}
	// The migration grants only these owning commands, never arbitrary same-app receipts.
	if _, err := db.Exec("UPDATE assets_service_command_receipt SET operation_code='assets.unregistered.v1'"); err == nil {
		t.Fatal("same-app unregistered receipt accepted")
	}
	if _, err := db.Exec("UPDATE assets_service_command_receipt SET required_capability='assets:admin:admin'"); err == nil {
		t.Fatal("owned receipt wrong capability accepted")
	}
	second := map[string]any{"product_code": "PROD-B", "product_name": "Second", "product_line": "FC", "business_owner_uid": "person-a"}
	code, out = call(true, "create", "legacy-first", 0, second, nil)
	expect(code, out, 200)
	code, out = call(false, "create", "legacy-first", 0, second, nil)
	expect(code, out, 200)
	changed := map[string]any{"product_code": "PROD-A", "product_name": "Different"}
	code, out = call(false, "create", "fixed-non-v4-key", 0, changed, nil)
	expect(code, out, 409)
	code, out = call(false, "view", "", id, nil, nil)
	expect(code, out, 200)
	code, out = call(false, "list", "", 0, nil, nil)
	expect(code, out, 200)
	code, out = call(false, "dictionaries", "", 0, nil, nil)
	expect(code, out, 200)
	dictionaryJSON, _ := json.Marshal(out)
	if !bytes.Contains(dictionaryJSON, []byte("assets-only")) || bytes.Contains(dictionaryJSON, []byte("aims-secret")) {
		t.Fatal("dictionary owning table isolation failed")
	}

	code, out = call(false, "create", "actor-tamper", 0, first, func(body map[string]any, _ *http.Request) {
		body["authorization"].(map[string]any)["actorUid"] = "other"
	})
	expect(code, out, 403)
	edit := map[string]any{"product_name": "Renamed"}
	eventsBeforeEdit, receiptsBeforeEdit := count("assets_asset_events"), count("assets_service_command_receipt")
	code, out = call(false, "edit", "edit-key", id, edit, nil)
	expect(code, out, 200)
	code, out = call(true, "edit", "edit-key", id, edit, nil)
	expect(code, out, 200)
	var productName string
	if err = db.QueryRow("SELECT product_name FROM assets_product_assets WHERE id=?", id).Scan(&productName); err != nil || productName != "Renamed" {
		t.Fatalf("edit %s %v", productName, err)
	}
	if count("assets_asset_events") != eventsBeforeEdit+1 || count("assets_service_command_receipt") != receiptsBeforeEdit+1 {
		t.Fatal("edit/replay must produce exactly one audit event and receipt")
	}
	var editEvents int
	if err = db.QueryRow("SELECT COUNT(*) FROM assets_asset_events WHERE object_type='product_asset' AND object_id=? AND event_type='updated' AND operator_uid='person-a'", id).Scan(&editEvents); err != nil || editEvents != 1 {
		t.Fatalf("edit audit actor/object binding: count=%d err=%v", editEvents, err)
	}
	exec(db, "CREATE TRIGGER fail_product_edit_event BEFORE INSERT ON assets_asset_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced edit audit failure'")
	code, out = call(false, "edit", "edit-audit-failure", id, map[string]any{"product_name": "Must roll back"}, nil)
	expect(code, out, 503)
	exec(db, "DROP TRIGGER fail_product_edit_event")
	if err = db.QueryRow("SELECT product_name FROM assets_product_assets WHERE id=?", id).Scan(&productName); err != nil || productName != "Renamed" || count("assets_asset_events") != eventsBeforeEdit+1 || count("assets_service_command_receipt") != receiptsBeforeEdit+1 {
		t.Fatal("edit audit failure did not roll back mutation and receipt")
	}
	category := map[string]any{"scope": "product", "label": "Current Line", "value": "LINE", "shortCode": "LN"}
	code, out = call(false, "category-save", "category-key", 0, category, nil)
	expect(code, out, 200)
	code, out = call(true, "category-save", "category-key", 0, category, nil)
	expect(code, out, 200)
	if count("assets_asset_category_groups") != 1 {
		t.Fatal("category replay duplicated")
	}
	code, out = call(false, "create", "tenant-denied", 0, first, func(body map[string]any, _ *http.Request) {
		body["authorization"].(map[string]any)["tenant"] = "tenant-b"
	})
	expect(code, out, 403)
	code, out = call(false, "edit", "edit-key", id, edit, func(body map[string]any, _ *http.Request) {
		body["authorization"].(map[string]any)["scope"] = map[string]string{"current_user_assets_object_access": "none"}
	})
	expect(code, out, 403)

	// Link migration is independently required; the previous master migration
	// remains sufficient for master writes and was not silently changed.
	exec(db, "INSERT INTO assets_technology_bases(id,base_code,base_name,base_type,owner_uid) VALUES(11,'BASE-A','Visible base','platform','person-a'),(12,'BASE-B','Hidden base','platform','person-b')")
	exec(db, "INSERT INTO assets_asset_items(id,asset_code,asset_name,asset_subtype,dept_code,status,owner_uid) VALUES(21,'ASSET-A','Visible asset','server','D-A','active','person-a'),(22,'ASSET-B','Hidden asset','server','D-B','active','person-b')")
	targetPermit := func(kind string, relation bool) map[string]any {
		scope := map[string]string{"current_user_assets_object_access": "all"}
		if relation {
			scope = map[string]string{"current_user_assets_object_access": "relation", "current_user_assets_scope_units": `[{"directRelation":true,"relationPredicates":["owner"]}]`}
		}
		return map[string]any{"actorUid": "person-a", "tenant": "tenant-a", "deployment": "enterprise-test", "resource": map[string]string{"base": "technology_bases", "asset": "asset_items"}[kind], "action": "view", "expiresAt": time.Now().Add(10 * time.Second).UnixMilli(), "scope": scope}
	}
	withTarget := func(kind string, relation bool) func(map[string]any, *http.Request) {
		return func(body map[string]any, _ *http.Request) { body["targetAuthorization"] = targetPermit(kind, relation) }
	}
	for _, tc := range []struct {
		kind   string
		target int64
		field  string
	}{{"base", 11, "technology_base_id"}, {"asset", 21, "asset_id"}} {
		payload := map[string]any{tc.field: tc.target}
		before := count("assets_service_command_receipt")
		code, out = call(false, "link-"+tc.kind, tc.kind+"-link", id, payload, withTarget(tc.kind, true))
		expect(code, out, 200)
		code, out = call(true, "link-"+tc.kind, tc.kind+"-link", id, payload, nil)
		expect(code, out, 200)
		if count("assets_service_command_receipt") != before+1 {
			t.Fatal("link cross-entry replay duplicated")
		}
		code, out = call(false, "link-"+tc.kind, tc.kind+"-hidden", id, map[string]any{tc.field: tc.target + 1}, withTarget(tc.kind, true))
		expect(code, out, 403)
		code, out = call(false, tc.kind+"-candidates", "", 0, nil, withTarget(tc.kind, true))
		expect(code, out, 200)
		if out["data"].(map[string]any)["total"] != float64(1) {
			t.Fatalf("candidate scope leaked: %#v", out)
		}
	}
	// A hidden target linked by another authorized actor must not leak through
	// product detail or aggregate counts; product ownership alone is insufficient.
	exec(db, "INSERT INTO assets_product_asset_bases(product_asset_id,technology_base_id) VALUES(?,12)", id)
	exec(db, "INSERT INTO assets_product_asset_resources(product_asset_id,asset_id,relation_type) VALUES(?,22,'runtime')", id)
	readScopes := func(body map[string]any, _ *http.Request) {
		body["baseAuthorization"] = targetPermit("base", true)
		body["assetAuthorization"] = targetPermit("asset", true)
	}
	code, out = call(false, "view", "", id, nil, readScopes)
	expect(code, out, 200)
	detail := out["data"].(map[string]any)
	if len(detail["linked_assets"].([]any)) != 1 || len(detail["linked_bases"].([]any)) != 1 || detail["asset_count"] != float64(1) || detail["base_count"] != float64(1) {
		t.Fatalf("linked target scope leaked %#v", detail)
	}
	code, out = call(false, "view", "", id, nil, nil)
	expect(code, out, 200)
	if len(out["data"].(map[string]any)["linked_assets"].([]any)) != 0 {
		t.Fatal("missing target permission exposed links")
	}
	code, out = call(false, "list", "", 0, nil, readScopes)
	expect(code, out, 200)
	for _, item := range out["data"].(map[string]any)["items"].([]any) {
		row := item.(map[string]any)
		if row["id"] == float64(id) && row["asset_count"] != float64(1) {
			t.Fatalf("list count leaked %#v", row)
		}
	}
	code, out = call(false, "link-base", "base-link", id, map[string]any{"technology_base_id": 12}, withTarget("base", false))
	expect(code, out, 409)
	code, out = call(false, "link-base", "wrong-resource", id, map[string]any{"technology_base_id": 11}, withTarget("asset", false))
	expect(code, out, 403)
	beforeLinks, beforeLinkReceipts := count("assets_product_asset_bases"), count("assets_service_command_receipt")
	exec(db, "INSERT INTO assets_technology_bases(id,base_code,base_name,base_type,owner_uid) VALUES(13,'BASE-LATE','Late base','platform','person-a')")
	exec(db, "CREATE TRIGGER fail_link_event BEFORE INSERT ON assets_asset_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced link audit failure'")
	code, out = call(false, "link-base", "base-late", id, map[string]any{"technology_base_id": 13}, withTarget("base", true))
	expect(code, out, 503)
	if count("assets_product_asset_bases") != beforeLinks || count("assets_service_command_receipt") != beforeLinkReceipts {
		t.Fatal("late link audit failed to roll back receipt and relation")
	}
	exec(db, "DROP TRIGGER fail_link_event")
	code, out = call(true, "link-base", "legacy-link-first", id, map[string]any{"technology_base_id": 13}, nil)
	expect(code, out, 200)
	code, out = call(false, "link-base", "legacy-link-first", id, map[string]any{"technology_base_id": 13}, withTarget("base", true))
	expect(code, out, 200)
	docUUID := "00000000-0000-4000-8000-000000000001"
	proof := func(body map[string]any, _ *http.Request) {
		body["documentAuthorization"] = map[string]any{"actorUid": "person-a", "productId": id, "productCode": "PROD-A", "documentUuid": docUUID, "expiresAt": time.Now().Add(10 * time.Second).UnixMilli()}
	}
	code, out = call(false, "link-document", "doc-link", id, map[string]any{"document_id": docUUID}, nil)
	expect(code, out, 403)
	code, out = call(false, "link-document", "doc-link", id, map[string]any{"document_id": docUUID}, proof)
	expect(code, out, 200)
	code, out = call(false, "link-document", "doc-link", id, map[string]any{"document_id": docUUID}, proof)
	expect(code, out, 200)
	code, out = call(false, "link-document", "doc-link", id, map[string]any{"document_id": docUUID}, func(body map[string]any, r *http.Request) {
		proof(body, r)
		body["documentAuthorization"].(map[string]any)["expiresAt"] = time.Now().Add(-time.Second).UnixMilli()
	})
	expect(code, out, 403)
	if count("assets_asset_documents") != 1 {
		t.Fatal("document replay duplicated")
	}
	exec(db, "UPDATE assets_technology_bases SET owner_uid='person-b' WHERE id=11")
	code, out = call(false, "link-base", "base-link", id, map[string]any{"technology_base_id": 11}, withTarget("base", true))
	expect(code, out, 403)
	receiptCount := count("assets_service_command_receipt")
	productCount := count("assets_product_assets")
	exec(db, "ALTER TABLE assets_service_command_receipt ALTER CHECK chk_scr_cross_app NOT ENFORCED")
	code, out = call(false, "create", "unenforced", 0, map[string]any{"product_code": "UNENFORCED", "product_name": "Reject"}, nil)
	expect(code, out, 503)
	if count("assets_product_assets") != productCount || count("assets_service_command_receipt") != receiptCount {
		t.Fatal("unenforced CHECK allowed mutation")
	}
	exec(db, "ALTER TABLE assets_service_command_receipt ALTER CHECK chk_scr_cross_app ENFORCED")
	exec(db, "CREATE TRIGGER fail_product_event BEFORE INSERT ON assets_asset_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced audit failure'")
	code, out = call(false, "create", "late-failure", 0, map[string]any{"product_code": "LATE", "product_name": "Late"}, nil)
	expect(code, out, 503)
	if count("assets_product_assets") != productCount || count("assets_service_command_receipt") != receiptCount {
		t.Fatal("late audit left receipt or business row")
	}
	exec(db, "DROP TRIGGER fail_product_event")
	for _, table := range []string{"aims_service_command_receipt", "aims_asset_events", "aims_product_assets"} {
		if count(table) != 0 {
			t.Fatalf("unexpected Aims domain mutation: %s", table)
		}
	}
	var legacyCount int
	if err = legacyDB.QueryRow("SELECT COUNT(*) FROM product_assets").Scan(&legacyCount); err != nil || legacyCount != 0 {
		t.Fatalf("legacy store written %d %v", legacyCount, err)
	}
	exec(consoleDB, "UPDATE service_client_grants SET status='revoked' WHERE service_client_id=2")
	code, out = call(true, "create", "fixed-non-v4-key", 0, first, nil)
	expect(code, out, 403)
	exec(consoleDB, "UPDATE service_client_credentials SET status='revoked' WHERE id=7")
	code, out = call(false, "create", "fixed-non-v4-key", 0, first, nil)
	expect(code, out, 403)
	exec(consoleDB, "UPDATE service_client_credentials SET status='active' WHERE id=7")
	code, out = call(false, "link-document", "doc-link", id, map[string]any{"document_id": docUUID}, proof)
	expect(code, out, 200)
	exec(db, "UPDATE enterprise_schema_registry SET generation=2")
	if _, err = unified.EnterpriseIPAssetsList(context.Background(), ipScope); err == nil {
		t.Fatal("stale generation allowed IP snapshot read")
	}
	if _, err = unified.EnterpriseDigitalAssetsList(context.Background(), url.Values{"current_user": {"person-a"}, "current_user_assets_object_access": {"all"}}); err == nil {
		t.Fatal("stale generation allowed digital snapshot read")
	}
	staleIdentity := digitalIdentity
	staleIdentity.Key = "digital-stale"
	if _, err = unified.EnterpriseDigitalAssetCommand(context.Background(), staleIdentity, "create", 0, map[string]any{"digital_code": "DIG-STALE", "digital_name": "stale"}, digitalScope); err == nil {
		t.Fatal("stale generation allowed digital write")
	}
	staleIPIdentity := ipIdentity
	staleIPIdentity.Key = "ip-stale"
	if _, err = unified.EnterpriseIPAssetCommand(context.Background(), staleIPIdentity, "create", 0, map[string]any{"ip_code": "IP-STALE", "ip_name": "stale"}, ipWriteScope); err == nil {
		t.Fatal("stale generation allowed IP write")
	}
	code, out = call(false, "link-document", "doc-link", id, map[string]any{"document_id": docUUID}, proof)
	expect(code, out, 503)
	code, out = call(false, "list", "", 0, nil, nil)
	expect(code, out, 503)
}
