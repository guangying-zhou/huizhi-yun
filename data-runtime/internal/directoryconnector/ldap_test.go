package directoryconnector

import (
	"context"
	"net"
	"strings"
	"testing"

	ldap "github.com/go-ldap/ldap/v3"
)

func TestOpenLDAPProfilePrefersDisplayNameOverIdentifierCN(t *testing.T) {
	entry := &ldap.Entry{
		DN: "uid=caogaoqing,ou=People,dc=example,dc=com",
		Attributes: []*ldap.EntryAttribute{
			{Name: "uid", Values: []string{"caogaoqing"}},
			{Name: "cn", Values: []string{"caogaoqing"}},
			{Name: "sn", Values: []string{"曹"}},
			{Name: "displayName", Values: []string{"曹高庆"}},
		},
	}

	user := mapLDAPEntry(ldapRuntimeConfig{LDAPConfiguration: LDAPConfiguration{DirectoryType: "openldap"}}, entry)
	if user.CN != "曹高庆" {
		t.Fatalf("CN = %q, want displayName", user.CN)
	}
}

func TestOpenLDAPUserCreationUsesPasswordModifyInsteadOfCleartextAttribute(t *testing.T) {
	request := newOpenLDAPUserAddRequest(
		"uid=liukai,ou=People,dc=example,dc=com",
		"liukai",
		"Liu Kai",
		"Liu Kai",
		map[string]any{"email": "liukai@example.com"},
	)
	for _, attribute := range request.Attributes {
		if strings.EqualFold(attribute.Type, "userPassword") {
			t.Fatal("OpenLDAP add request must not store the initial password as a cleartext userPassword attribute")
		}
	}

	passwordRequest := newOpenLDAPInitialPasswordRequest(request.DN, "initial-password")
	if passwordRequest.UserIdentity != request.DN {
		t.Fatalf("expected password modify target %q, got %q", request.DN, passwordRequest.UserIdentity)
	}
	if passwordRequest.OldPassword != "" || passwordRequest.NewPassword != "initial-password" {
		t.Fatalf("unexpected initial password modify request: %+v", passwordRequest)
	}
}

func TestOpenLDAPSelfPasswordChangeUsesAuthenticatedIdentity(t *testing.T) {
	request := newOpenLDAPSelfPasswordRequest("current-password", "new-password")
	if request.UserIdentity != "" {
		t.Fatalf("self password modify must use the authenticated LDAP identity, got %q", request.UserIdentity)
	}
	if request.OldPassword != "current-password" || request.NewPassword != "new-password" {
		t.Fatalf("unexpected self password modify request: %+v", request)
	}
}

func TestLDAPConnectionReportsNetworkStageWithoutLeakingCredentials(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	result, code, err := testLDAPConnection(context.Background(), ldapRuntimeConfig{
		LDAPConfiguration: LDAPConfiguration{
			Host:       "127.0.0.1",
			Port:       port,
			Transport:  "ldaps",
			ServerName: "localhost",
			BindDN:     "cn=manager,dc=example,dc=com",
			UserBase:   "ou=people,dc=example,dc=com",
		},
		BindPassword: "must-not-appear-in-errors",
	})
	if err == nil {
		t.Fatal("expected the closed test port to reject the connection")
	}
	if code != "ldap_connect_failed" {
		t.Fatalf("expected ldap_connect_failed, got %q (%v)", code, err)
	}
	if result.Connected || result.Authenticated || result.BaseReadable {
		t.Fatalf("unexpected successful stage flags: %+v", result)
	}
	if message := err.Error(); strings.Contains(message, "must-not-appear-in-errors") {
		t.Fatalf("LDAP error leaked the bind password: %s", message)
	}
}
