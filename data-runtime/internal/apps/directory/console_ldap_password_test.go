package directory

import (
	"strings"
	"testing"
)

func TestConsoleLDAPPasswordGeneratesWhenCallerSuppliesNone(t *testing.T) {
	// People 受控入职要求 People 不经手明文密码，因此缺省必须由 Console 生成，
	// 而不是像以前那样返回 400 directory_password_invalid。
	for _, absent := range []any{nil, "", "   "} {
		password, generated, err := consoleLDAPPassword(absent, "liukai")
		if err != nil {
			t.Fatalf("absent=%#v err=%v", absent, err)
		}
		if !generated {
			t.Fatalf("absent=%#v must be reported as generated", absent)
		}
		if len(password) != consoleLDAPPasswordLength {
			t.Fatalf("password length=%d", len(password))
		}
		if strings.Contains(strings.ToLower(password), "liukai") {
			t.Fatalf("generated password must not contain the uid: %q", password)
		}
	}
}

func TestGeneratedConsoleLDAPPasswordSatisfiesComplexityAndIsUnpredictable(t *testing.T) {
	seen := map[string]bool{}
	for range 32 {
		password, err := generateConsoleLDAPPassword("liukai")
		if err != nil {
			t.Fatal(err)
		}
		if seen[password] {
			t.Fatalf("generated a repeated password: %q", password)
		}
		seen[password] = true

		var upper, lower, digit, symbol bool
		for _, character := range []byte(password) {
			switch {
			case strings.IndexByte(consoleLDAPPasswordUpper, character) >= 0:
				upper = true
			case strings.IndexByte(consoleLDAPPasswordLower, character) >= 0:
				lower = true
			case strings.IndexByte(consoleLDAPPasswordDigit, character) >= 0:
				digit = true
			case strings.IndexByte(consoleLDAPPasswordSymbol, character) >= 0:
				symbol = true
			default:
				t.Fatalf("unexpected character %q in %q", character, password)
			}
		}
		if !upper || !lower || !digit || !symbol {
			t.Fatalf("password %q does not satisfy the four character classes", password)
		}
		// 易混字符会让人工转交的初始密码变成一次登录失败。
		if strings.ContainsAny(password, "O0lI1") {
			t.Fatalf("password %q contains ambiguous characters", password)
		}
	}
}

func TestCallerSuppliedConsoleLDAPPasswordKeepsExistingValidation(t *testing.T) {
	if _, generated, err := consoleLDAPPassword("Str0ng-Passw0rd!", "liukai"); err != nil || generated {
		t.Fatalf("generated=%v err=%v", generated, err)
	}
	if _, _, err := consoleLDAPPassword("short", "liukai"); err == nil {
		t.Fatal("a too short password must still be rejected")
	}
	if _, _, err := consoleLDAPPassword("prefix-liukai-suffix", "liukai"); err == nil {
		t.Fatal("a password containing the uid must still be rejected")
	}
}
