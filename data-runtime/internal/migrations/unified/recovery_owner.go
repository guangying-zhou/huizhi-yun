package unified

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// SQLRecoveryOwnerVerifier consumes the exact Platform-signed preparation bytes,
// not a caller-asserted evidence hash. The principal must be a dedicated MySQL
// account. Administrative migration credentials are excluded only by CURRENT_USER.
// No network operation occurs while the activation transaction holds fences.
type SQLRecoveryOwnerVerifier struct {
	Payload                    []byte
	Signature                  []byte
	PlatformPublicKey          ed25519.PublicKey
	DatabaseUser, DatabaseHost string
}

func (v SQLRecoveryOwnerVerifier) VerifyRecoveryOwner(ctx context.Context, tx *sql.Tx, p RecoveryActivation) (string, error) {
	if len(v.PlatformPublicKey) != ed25519.PublicKeySize || !ed25519.Verify(v.PlatformPublicKey, v.Payload, v.Signature) {
		return "", errors.New("recovery preparation signature invalid")
	}
	var wire struct {
		Type     string `json:"type"`
		Revision uint64 `json:"revision"`
		Input    struct {
			Tenant           string `json:"tenantCode"`
			Environment      string `json:"environment"`
			RecoveryKey      string `json:"recoveryKey"`
			Review           string `json:"recoveryReviewHash"`
			Runtime          string `json:"runtimeCode"`
			Worker           string `json:"workerClient"`
			WorkerDeployment string `json:"workerDeployment"`
			Generation       string `json:"generation"`
			Aims             string `json:"aimsSchema"`
			Assets           string `json:"assetsSchema"`
			Instance         string `json:"instanceId"`
			DBUser           string `json:"databaseUser"`
			DBHost           string `json:"databaseHost"`
		} `json:"input"`
	}
	if err := json.Unmarshal(v.Payload, &wire); err != nil {
		return "", err
	}
	x := wire.Input
	hash := sha256.Sum256(v.Payload)
	if wire.Type != "enterprise-recovery-route.v1" || hex.EncodeToString(hash[:]) != p.RouteRevision || x.Tenant != p.Recovery.Final.Config.Tenant || x.Environment != p.Recovery.Final.Config.Environment || x.RecoveryKey != p.Recovery.RecoveryKey || x.Review != p.Recovery.ReviewHash || x.Runtime != p.RuntimeDeployment || x.Worker != p.WorkerClientID || x.WorkerDeployment != p.WorkerDeployment || x.Generation != fmt.Sprint(p.Generation) || x.Aims != p.Recovery.AimsTarget || x.Assets != p.Recovery.AssetsTarget || x.Instance != p.Recovery.Final.Config.InstanceID || x.DBUser != v.DatabaseUser || x.DBHost != v.DatabaseHost || x.DBUser == "" || x.DBHost == "" {
		return "", errors.New("recovery preparation owner mismatch")
	}
	// Dedicated account cannot inherit roles or global/table/procedure grants.
	var count int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM mysql.user WHERE User=? AND Host=? AND account_locked='N'", v.DatabaseUser, v.DatabaseHost).Scan(&count); err != nil || count != 1 {
		return "", errors.New("recovery database account unavailable")
	}
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM mysql.role_edges WHERE TO_USER=? AND TO_HOST=?", v.DatabaseUser, v.DatabaseHost).Scan(&count); err != nil || count != 0 {
		return "", errors.New("recovery inherited role prohibited")
	}
	grantee := fmt.Sprintf("'%s'@'%s'", v.DatabaseUser, v.DatabaseHost)
	for _, view := range []string{"USER_PRIVILEGES", "TABLE_PRIVILEGES", "COLUMN_PRIVILEGES"} {
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema."+view+" WHERE GRANTEE=? AND PRIVILEGE_TYPE<>'USAGE'", grantee).Scan(&count); err != nil || count != 0 {
			return "", errors.New("recovery broad privilege prohibited")
		}
	}
	rows, err := tx.QueryContext(ctx, "SELECT TABLE_SCHEMA,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=?", grantee)
	if err != nil {
		return "", err
	}
	grants := map[string]map[string]bool{x.Aims: {}, x.Assets: {}}
	for rows.Next() {
		var schema, privilege, grantable string
		if err = rows.Scan(&schema, &privilege, &grantable); err != nil {
			rows.Close()
			return "", err
		}
		if grants[schema] == nil || grantable != "NO" {
			rows.Close()
			return "", errors.New("recovery schema privilege mismatch")
		}
		switch privilege {
		case "SELECT", "INSERT", "UPDATE", "DELETE":
			grants[schema][privilege] = true
		default:
			rows.Close()
			return "", errors.New("recovery DDL privilege prohibited")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", err
	}
	for _, privileges := range grants {
		if len(privileges) != 4 {
			return "", errors.New("recovery DML grant incomplete")
		}
	}
	// Every other non-administrative unlocked account must lack a schema grant
	// matching either new schema. Global privileged accounts are rejected too.
	var admin string
	if err = tx.QueryRowContext(ctx, "SELECT CURRENT_USER()").Scan(&admin); err != nil {
		return "", err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM mysql.db d JOIN mysql.user u ON u.User=d.User AND u.Host=d.Host WHERE u.account_locked='N' AND CONCAT(u.User,'@',u.Host)<>? AND NOT(u.User=? AND u.Host=?) AND (? LIKE d.Db OR ? LIKE d.Db)`, admin, v.DatabaseUser, v.DatabaseHost, x.Aims, x.Assets).Scan(&count); err != nil || count != 0 {
		return "", errors.New("recovery schema has competing account")
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM mysql.user WHERE account_locked='N' AND CONCAT(User,'@',Host)<>? AND NOT(User=? AND Host=?) AND (Select_priv='Y' OR Insert_priv='Y' OR Update_priv='Y' OR Delete_priv='Y' OR Super_priv='Y' OR Grant_priv='Y')`, admin, v.DatabaseUser, v.DatabaseHost).Scan(&count); err != nil || count != 0 {
		return "", errors.New("recovery global competing account")
	}
	for _, view := range []string{"TABLE_PRIVILEGES", "COLUMN_PRIVILEGES"} {
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema."+view+" p JOIN mysql.user u ON p.GRANTEE=CONCAT(CHAR(39),u.User,CHAR(39),'@',CHAR(39),u.Host,CHAR(39)) WHERE u.account_locked='N' AND CONCAT(u.User,'@',u.Host)<>? AND NOT(u.User=? AND u.Host=?) AND p.TABLE_SCHEMA IN (?,?)", admin, v.DatabaseUser, v.DatabaseHost, x.Aims, x.Assets).Scan(&count); err != nil || count != 0 {
			return "", errors.New("recovery table has competing account")
		}
	}
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM mysql.role_edges r JOIN mysql.user u ON r.TO_USER=u.User AND r.TO_HOST=u.Host WHERE u.account_locked='N' AND CONCAT(u.User,'@',u.Host)<>?", admin).Scan(&count); err != nil || count != 0 {
		return "", errors.New("recovery competing inherited role")
	}
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM mysql.global_grants WHERE USER=? AND HOST=?", v.DatabaseUser, v.DatabaseHost).Scan(&count); err != nil || count != 0 {
		return "", errors.New("recovery dynamic privilege prohibited")
	}
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM mysql.procs_priv WHERE User=? AND Host=?", v.DatabaseUser, v.DatabaseHost).Scan(&count); err != nil || count != 0 {
		return "", errors.New("recovery routine privilege prohibited")
	}
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM mysql.proxies_priv WHERE (User=? AND Host=?) OR (Proxied_user=? AND Proxied_host=?)", v.DatabaseUser, v.DatabaseHost, v.DatabaseUser, v.DatabaseHost).Scan(&count); err != nil || count != 0 {
		return "", errors.New("recovery proxy privilege prohibited")
	}
	// Frozen unified authority cannot enqueue more work. Terminal rows/receipts
	// have already passed complete hash verification before this method executes.
	return hex.EncodeToString(hash[:]), nil
}
