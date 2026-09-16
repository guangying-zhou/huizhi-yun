package directoryconnector

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	ldap "github.com/go-ldap/ldap/v3"
)

type LDAPUser struct {
	DN              string `json:"dn"`
	UID             string `json:"uid"`
	CN              string `json:"cn,omitempty"`
	SN              string `json:"sn,omitempty"`
	Mail            string `json:"mail,omitempty"`
	TelephoneNumber string `json:"telephoneNumber,omitempty"`
	ExternalID      string `json:"externalId,omitempty"`
	Status          string `json:"status,omitempty"`
}

type ldapRuntimeConfig struct {
	LDAPConfiguration
	BindPassword string
}

type LDAPConnectionTestResult struct {
	Connected     bool  `json:"connected"`
	Authenticated bool  `json:"authenticated"`
	BaseReadable  bool  `json:"baseReadable"`
	ElapsedMS     int64 `json:"elapsedMs"`
}

func tlsConfig(cfg ldapRuntimeConfig) (*tls.Config, error) {
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}
	if strings.TrimSpace(cfg.CAPem) != "" && !roots.AppendCertsFromPEM([]byte(cfg.CAPem)) {
		return nil, errors.New("LDAP CA PEM contains no valid certificate")
	}
	serverName := strings.TrimSpace(cfg.ServerName)
	if serverName == "" {
		serverName = strings.TrimSpace(cfg.Host)
	}
	return &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots, ServerName: serverName}, nil
}

func connectLDAP(ctx context.Context, cfg ldapRuntimeConfig) (*ldap.Conn, error) {
	tlsCfg, err := tlsConfig(cfg)
	if err != nil {
		return nil, err
	}
	address := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	var conn *ldap.Conn
	switch strings.ToLower(strings.TrimSpace(cfg.Transport)) {
	case "ldaps":
		conn, err = ldap.DialURL("ldaps://"+address, ldap.DialWithTLSConfig(tlsCfg), ldap.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}))
	case "starttls":
		conn, err = ldap.DialURL("ldap://"+address, ldap.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}))
		if err == nil {
			err = conn.StartTLS(tlsCfg)
		}
	default:
		return nil, errors.New("LDAP transport must be ldaps or starttls")
	}
	if err != nil {
		if conn != nil {
			conn.Close()
		}
		return nil, err
	}
	conn.SetTimeout(20 * time.Second)
	return conn, nil
}

func dialLDAP(ctx context.Context, cfg ldapRuntimeConfig, bindDN, password string) (*ldap.Conn, error) {
	conn, err := connectLDAP(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := conn.Bind(bindDN, password); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

func testLDAPConnection(ctx context.Context, cfg ldapRuntimeConfig) (LDAPConnectionTestResult, string, error) {
	startedAt := time.Now()
	result := LDAPConnectionTestResult{}
	conn, err := connectLDAP(ctx, cfg)
	if err != nil {
		return result, "ldap_connect_failed", fmt.Errorf("connect to LDAP: %w", err)
	}
	defer conn.Close()
	result.Connected = true

	if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
		result.ElapsedMS = time.Since(startedAt).Milliseconds()
		return result, "ldap_invalid_credentials", fmt.Errorf("authenticate LDAP Bind DN: %w", err)
	}
	result.Authenticated = true

	request := ldap.NewSearchRequest(
		cfg.UserBase,
		ldap.ScopeBaseObject,
		ldap.NeverDerefAliases,
		1,
		10,
		false,
		"(objectClass=*)",
		[]string{"dn"},
		nil,
	)
	if _, err := conn.Search(request); err != nil {
		result.ElapsedMS = time.Since(startedAt).Milliseconds()
		return result, "ldap_user_base_unreadable", fmt.Errorf("read LDAP User Base: %w", err)
	}
	result.BaseReadable = true
	result.ElapsedMS = time.Since(startedAt).Milliseconds()
	return result, "", nil
}

func userDN(cfg ldapRuntimeConfig, uid, cn string) string {
	template := strings.TrimSpace(cfg.UserDnTemplate)
	if template == "" {
		if cfg.DirectoryType == "active-directory" {
			template = "CN={{cn}}," + cfg.UserBase
		} else {
			template = "uid={{uid}}," + cfg.UserBase
		}
	}
	return strings.NewReplacer(
		"{{uid}}", ldap.EscapeDN(uid),
		"{{cn}}", ldap.EscapeDN(cn),
	).Replace(template)
}

func stringField(command map[string]any, key string) string {
	return strings.TrimSpace(fmt.Sprint(command[key]))
}

func createLDAPUser(ctx context.Context, cfg ldapRuntimeConfig, command map[string]any, password string) (LDAPUser, error) {
	uid := stringField(command, "uid")
	cn := stringField(command, "displayName")
	if cn == "" {
		cn = uid
	}
	sn := stringField(command, "realName")
	if sn == "" {
		sn = cn
	}
	dn := userDN(cfg, uid, cn)
	conn, err := dialLDAP(ctx, cfg, cfg.BindDN, cfg.BindPassword)
	if err != nil {
		return LDAPUser{}, err
	}
	defer conn.Close()

	if existing, lookupErr := readLDAPUser(conn, cfg, dn); lookupErr == nil {
		verification, bindErr := dialLDAP(ctx, cfg, dn, password)
		if bindErr == nil {
			verification.Close()
			return existing, nil
		}
		return LDAPUser{}, fmt.Errorf("LDAP entry already exists and does not accept the requested initial password: %w", bindErr)
	}
	if cfg.DirectoryType == "active-directory" {
		request := ldap.NewAddRequest(dn, nil)
		request.Attribute("objectClass", []string{"top", "person", "organizationalPerson", "user"})
		request.Attribute("cn", []string{cn})
		request.Attribute("sn", []string{sn})
		request.Attribute("displayName", []string{cn})
		request.Attribute("sAMAccountName", []string{uid})
		upn := uid
		if cfg.UserPrincipalNameSuffix != "" {
			upn += "@" + strings.TrimPrefix(cfg.UserPrincipalNameSuffix, "@")
		}
		request.Attribute("userPrincipalName", []string{upn})
		request.Attribute("userAccountControl", []string{"514"})
		addOptionalAttributes(request, command)
		if err := conn.Add(request); err != nil {
			return LDAPUser{}, err
		}
		passwordRequest := ldap.NewModifyRequest(dn, nil)
		passwordRequest.Replace("unicodePwd", []string{encodeADPassword(password)})
		passwordRequest.Replace("userAccountControl", []string{"512"})
		if err := conn.Modify(passwordRequest); err != nil {
			// AD creation is a two-step operation. Remove the disabled entry when
			// password initialization fails so a retry cannot report a half-created
			// account as successful. A failed rollback remains a visible permanent
			// error and requires operator inspection.
			if rollbackErr := conn.Del(ldap.NewDelRequest(dn, nil)); rollbackErr != nil {
				return LDAPUser{}, fmt.Errorf("initialize AD password: %v; rollback newly created entry: %w", err, rollbackErr)
			}
			return LDAPUser{}, err
		}
	} else {
		request := newOpenLDAPUserAddRequest(dn, uid, cn, sn, command)
		if err := conn.Add(request); err != nil {
			return LDAPUser{}, err
		}
		if _, err := conn.PasswordModify(newOpenLDAPInitialPasswordRequest(dn, password)); err != nil {
			return LDAPUser{}, rollbackNewLDAPUser(conn, dn, "initialize OpenLDAP password", err)
		}
	}
	verification, err := dialLDAP(ctx, cfg, dn, password)
	if err != nil {
		return LDAPUser{}, rollbackNewLDAPUser(conn, dn, "verify newly created LDAP credentials", err)
	}
	verification.Close()
	return readLDAPUser(conn, cfg, dn)
}

// resetLDAPPassword 以管理员绑定重设密码，不需要知道当前密码。
//
// 激活链接场景下员工从未见过初始密码：账号创建时用的是 Console 生成、
// 谁都不知道也不留存的一次性口令，员工凭激活凭据自行设定真实密码。
// changeLDAPPassword 要求以用户身份绑定当前密码，无法覆盖这一场景。
func resetLDAPPassword(ctx context.Context, cfg ldapRuntimeConfig, dn, newPassword string) error {
	conn, err := dialLDAP(ctx, cfg, cfg.BindDN, cfg.BindPassword)
	if err != nil {
		return err
	}
	defer conn.Close()

	if _, lookupErr := readLDAPUser(conn, cfg, dn); lookupErr != nil {
		return fmt.Errorf("read LDAP entry before password reset: %w", lookupErr)
	}
	if cfg.DirectoryType == "active-directory" {
		request := ldap.NewModifyRequest(dn, nil)
		request.Replace("unicodePwd", []string{encodeADPassword(newPassword)})
		if operationErr := conn.Modify(request); operationErr != nil {
			return operationErr
		}
	} else if _, operationErr := conn.PasswordModify(newOpenLDAPInitialPasswordRequest(dn, newPassword)); operationErr != nil {
		return operationErr
	}
	// 以新密码绑定确认生效。回执丢失后的重放会再次走到这里并同样成功，
	// 因此该操作是幂等的。
	verification, err := dialLDAP(ctx, cfg, dn, newPassword)
	if err != nil {
		return fmt.Errorf("verify reset LDAP credentials: %w", err)
	}
	verification.Close()
	return nil
}

func newOpenLDAPUserAddRequest(dn, uid, cn, sn string, command map[string]any) *ldap.AddRequest {
	request := ldap.NewAddRequest(dn, nil)
	request.Attribute("objectClass", []string{"top", "person", "organizationalPerson", "inetOrgPerson"})
	request.Attribute("uid", []string{uid})
	request.Attribute("cn", []string{cn})
	request.Attribute("sn", []string{sn})
	addOptionalAttributes(request, command)
	return request
}

func newOpenLDAPInitialPasswordRequest(dn, password string) *ldap.PasswordModifyRequest {
	return ldap.NewPasswordModifyRequest(dn, "", password)
}

func newOpenLDAPSelfPasswordRequest(currentPassword, newPassword string) *ldap.PasswordModifyRequest {
	return ldap.NewPasswordModifyRequest("", currentPassword, newPassword)
}

func rollbackNewLDAPUser(conn *ldap.Conn, dn, operation string, operationErr error) error {
	if rollbackErr := conn.Del(ldap.NewDelRequest(dn, nil)); rollbackErr != nil {
		return fmt.Errorf("%s: %v; rollback newly created entry: %w", operation, operationErr, rollbackErr)
	}
	return fmt.Errorf("%s: %w", operation, operationErr)
}

func addOptionalAttributes(request *ldap.AddRequest, command map[string]any) {
	if value := stringField(command, "email"); value != "" {
		request.Attribute("mail", []string{value})
	}
	if value := stringField(command, "mobile"); value != "" {
		request.Attribute("telephoneNumber", []string{value})
	}
}

func changeLDAPPassword(ctx context.Context, cfg ldapRuntimeConfig, dn, currentPassword, newPassword string) error {
	conn, err := dialLDAP(ctx, cfg, dn, currentPassword)
	if err != nil {
		// A lost completion response must not make a successfully changed password fail forever.
		if newConn, newErr := dialLDAP(ctx, cfg, dn, newPassword); newErr == nil {
			newConn.Close()
			return nil
		}
		return err
	}
	defer conn.Close()
	var operationErr error
	if cfg.DirectoryType == "active-directory" {
		request := ldap.NewModifyRequest(dn, nil)
		request.Delete("unicodePwd", []string{encodeADPassword(currentPassword)})
		request.Add("unicodePwd", []string{encodeADPassword(newPassword)})
		operationErr = conn.Modify(request)
	} else {
		_, operationErr = conn.PasswordModify(newOpenLDAPSelfPasswordRequest(currentPassword, newPassword))
	}
	verification, verificationErr := dialLDAP(ctx, cfg, dn, newPassword)
	if verificationErr == nil {
		verification.Close()
		return nil
	}
	if operationErr != nil {
		return operationErr
	}
	return fmt.Errorf("verify updated LDAP credentials: %w", verificationErr)
}

func encodeADPassword(password string) string {
	encoded := utf16.Encode([]rune(`"` + password + `"`))
	bytes := make([]byte, len(encoded)*2)
	for i, value := range encoded {
		binary.LittleEndian.PutUint16(bytes[i*2:], value)
	}
	return string(bytes)
}

func readLDAPUser(conn *ldap.Conn, cfg ldapRuntimeConfig, dn string) (LDAPUser, error) {
	attributes := []string{"uid", "cn", "sn", "displayName", "mail", "telephoneNumber", "entryUUID", "objectGUID", "sAMAccountName", "userAccountControl"}
	result, err := conn.Search(ldap.NewSearchRequest(dn, ldap.ScopeBaseObject, ldap.NeverDerefAliases, 1, 10, false, "(objectClass=*)", attributes, nil))
	if err != nil || len(result.Entries) != 1 {
		if err == nil {
			err = errors.New("LDAP user was not found after operation")
		}
		return LDAPUser{}, err
	}
	return mapLDAPEntry(cfg, result.Entries[0]), nil
}

func listLDAPUsers(ctx context.Context, cfg ldapRuntimeConfig) ([]LDAPUser, error) {
	conn, err := dialLDAP(ctx, cfg, cfg.BindDN, cfg.BindPassword)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	attributes := []string{"uid", "cn", "sn", "displayName", "mail", "telephoneNumber", "entryUUID", "objectGUID", "sAMAccountName", "userAccountControl"}
	request := ldap.NewSearchRequest(cfg.UserBase, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 30, false, cfg.UserFilter, attributes, nil)
	result, err := conn.SearchWithPaging(request, uint32(cfg.PageSize))
	if err != nil {
		return nil, err
	}
	users := make([]LDAPUser, 0, len(result.Entries))
	for _, entry := range result.Entries {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		user := mapLDAPEntry(cfg, entry)
		if user.UID != "" {
			users = append(users, user)
		}
	}
	return users, nil
}

func mapLDAPEntry(cfg ldapRuntimeConfig, entry *ldap.Entry) LDAPUser {
	uid := entry.GetAttributeValue("uid")
	cn := entry.GetAttributeValue("cn")
	if cfg.DirectoryType == "active-directory" {
		uid = entry.GetAttributeValue("sAMAccountName")
	}
	if value := entry.GetAttributeValue("displayName"); value != "" {
		cn = value
	}
	externalID := entry.GetAttributeValue("entryUUID")
	if cfg.DirectoryType == "active-directory" {
		externalID = formatObjectGUID(entry.GetRawAttributeValue("objectGUID"))
	}
	status := "active"
	if flags, err := strconv.Atoi(entry.GetAttributeValue("userAccountControl")); err == nil && flags&2 != 0 {
		status = "inactive"
	}
	return LDAPUser{
		DN: entry.DN, UID: uid, CN: cn, SN: entry.GetAttributeValue("sn"),
		Mail: entry.GetAttributeValue("mail"), TelephoneNumber: entry.GetAttributeValue("telephoneNumber"),
		ExternalID: externalID, Status: status,
	}
}

func formatObjectGUID(raw []byte) string {
	if len(raw) != 16 {
		return hex.EncodeToString(raw)
	}
	return fmt.Sprintf("%08x-%04x-%04x-%s-%s",
		binary.LittleEndian.Uint32(raw[0:4]), binary.LittleEndian.Uint16(raw[4:6]), binary.LittleEndian.Uint16(raw[6:8]),
		hex.EncodeToString(raw[8:10]), hex.EncodeToString(raw[10:16]))
}
