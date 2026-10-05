package providers

import "testing"

func TestValidateWeComBaseURLAllowsOnlyCompiledProviderOrigin(t *testing.T) {
	for _, value := range []string{"https://qyapi.weixin.qq.com", "https://qyapi.weixin.qq.com/", "https://qyapi.weixin.qq.com:443"} {
		got, err := ValidateWeComBaseURL(value)
		if err != nil || got != DefaultWeComBaseURL {
			t.Fatalf("ValidateWeComBaseURL(%q)=(%q,%v)", value, got, err)
		}
	}

	for _, value := range []string{
		"http://qyapi.weixin.qq.com",
		"https://qyapi.weixin.qq.com.attacker.example",
		"https://attacker.example",
		"https://qyapi.weixin.qq.com:8443",
		"https://user@qyapi.weixin.qq.com",
		"https://qyapi.weixin.qq.com/cgi-bin/gettoken",
		"https://qyapi.weixin.qq.com?target=attacker",
	} {
		if got, err := ValidateWeComBaseURL(value); err == nil || got != "" {
			t.Fatalf("ValidateWeComBaseURL(%q)=(%q,%v), want rejection", value, got, err)
		}
	}
}
