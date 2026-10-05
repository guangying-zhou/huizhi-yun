package directoryconnector

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

func loadOrCreatePrivateKey(path string) (*rsa.PrivateKey, error) {
	content, err := os.ReadFile(path)
	if err == nil {
		block, _ := pem.Decode(content)
		if block == nil {
			return nil, errors.New("directory connector private key PEM is invalid")
		}
		key, parseErr := x509.ParsePKCS8PrivateKey(block.Bytes)
		if parseErr != nil {
			return nil, fmt.Errorf("parse directory connector private key: %w", parseErr)
		}
		rsaKey, ok := key.(*rsa.PrivateKey)
		if !ok || rsaKey.N.BitLen() < 3072 {
			return nil, errors.New("directory connector private key must be RSA 3072 bits or stronger")
		}
		return rsaKey, nil
	}
	if !os.IsNotExist(err) {
		return nil, fmt.Errorf("read directory connector private key: %w", err)
	}
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, fmt.Errorf("generate directory connector private key: %w", err)
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	temporary := path + ".new"
	if err := os.WriteFile(temporary, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0600); err != nil {
		return nil, err
	}
	if err := os.Rename(temporary, path); err != nil {
		return nil, err
	}
	return key, nil
}

func publicKeyPEM(key *rsa.PrivateKey) (string, error) {
	encoded, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return "", err
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: encoded})), nil
}

func decryptSecret(key *rsa.PrivateKey, ciphertext string) (string, error) {
	decoded, err := decodeBase64(ciphertext)
	if err != nil {
		return "", errors.New("directory connector secret ciphertext is invalid")
	}
	plaintext, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, key, decoded, nil)
	if err != nil {
		return "", errors.New("directory connector secret cannot be decrypted")
	}
	return string(plaintext), nil
}
