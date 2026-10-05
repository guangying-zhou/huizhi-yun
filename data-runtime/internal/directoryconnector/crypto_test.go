package directoryconnector

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"testing"
)

func TestConnectorSecretRoundTrip(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	plaintext := "a tenant LDAP password"
	ciphertext, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &key.PublicKey, []byte(plaintext), nil)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := decryptSecret(key, base64.StdEncoding.EncodeToString(ciphertext))
	if err != nil {
		t.Fatal(err)
	}
	if actual != plaintext {
		t.Fatalf("decrypted secret mismatch: got %q", actual)
	}
}

func TestEncodeADPasswordUsesQuotedUTF16LE(t *testing.T) {
	actual := hex.EncodeToString([]byte(encodeADPassword("P@ss")))
	const expected = "220050004000730073002200"
	if actual != expected {
		t.Fatalf("unexpected AD password encoding: got %s want %s", actual, expected)
	}
}

func TestUserDNEscapesUntrustedComponents(t *testing.T) {
	cfg := ldapRuntimeConfig{LDAPConfiguration: LDAPConfiguration{
		DirectoryType:  "openldap",
		UserBase:       "ou=people,dc=example,dc=com",
		UserDnTemplate: "uid={{uid}}," + "ou=people,dc=example,dc=com",
	}}
	actual := userDN(cfg, "evil,user", "Ignored")
	if actual != "uid=evil\\,user,ou=people,dc=example,dc=com" {
		t.Fatalf("unexpected escaped DN: %s", actual)
	}
}
