import { Attribute, Change, Client, escapeFilter } from 'ldapts'
import type { Entry, SearchOptions } from 'ldapts'

export interface LdapUser {
  dn: string
  uid: string
  cn: string | null
  sn: string | null
  mail: string | null
  telephoneNumber: string | null
}

export interface LdapConfig {
  host: string
  port: number
  bindDN: string
  bindPassword: string
  baseDN: string
  userBase: string
  useTLS: boolean
}

const defaultConfig: LdapConfig = {
  host: 'ldap.wiztek.cn',
  port: 636,
  bindDN: 'cn=Manager,dc=wiztek,dc=cn',
  bindPassword: 'Wiztek@1902',
  baseDN: 'dc=wiztek,dc=cn',
  userBase: 'ou=People,dc=wiztek,dc=cn',
  useTLS: true
}

function createLdapClient(config: LdapConfig): Client {
  return new Client({
    url: `ldaps://${config.host}:${config.port}`,
    tlsOptions: {
      rejectUnauthorized: false // 跳过证书验证
    }
  })
}

async function closeLdapClient(client: Client): Promise<void> {
  if (!client.isConnected) return

  try {
    await client.unbind()
  } catch (error) {
    console.error('LDAP unbind error:', error)
  }
}

function getStringAttribute(entry: Entry, name: string): string | null {
  const value = entry[name]
  const firstValue = Array.isArray(value) ? value[0] : value

  if (typeof firstValue === 'string') return firstValue
  if (Buffer.isBuffer(firstValue)) return firstValue.toString('utf8')
  return null
}

export async function fetchLdapUsers(config: LdapConfig = defaultConfig): Promise<LdapUser[]> {
  const client = createLdapClient(config)

  try {
    await client.bind(config.bindDN, config.bindPassword)

    const searchOptions: SearchOptions = {
      filter: '(objectClass=inetOrgPerson)',
      scope: 'sub',
      attributes: ['uid', 'cn', 'sn', 'mail', 'telephoneNumber']
    }
    const { searchEntries } = await client.search(config.userBase, searchOptions)

    return searchEntries.flatMap((entry) => {
      const uid = getStringAttribute(entry, 'uid')
      if (!uid) return []

      return [{
        dn: entry.dn,
        uid,
        cn: getStringAttribute(entry, 'cn'),
        sn: getStringAttribute(entry, 'sn'),
        mail: getStringAttribute(entry, 'mail'),
        telephoneNumber: getStringAttribute(entry, 'telephoneNumber')
      }]
    })
  } catch (error) {
    console.error('LDAP fetch users error:', error)
    throw error
  } finally {
    await closeLdapClient(client)
  }
}

/**
 * 验证 LDAP 密码
 * @param dn 用户 DN
 * @param password 密码
 */
export async function verifyLdapPassword(dn: string, password: string, config: LdapConfig = defaultConfig): Promise<boolean> {
  const client = createLdapClient(config)

  try {
    await client.bind(dn, password)
    return true
  } catch (error) {
    console.error('LDAP verify bind error:', error)
    return false
  } finally {
    await closeLdapClient(client)
  }
}

/**
 * 修改 LDAP 密码
 * @param dn 用户 DN
 * @param newPassword 新密码
 */
export async function changeLdapPassword(dn: string, newPassword: string, config: LdapConfig = defaultConfig): Promise<boolean> {
  // MD5 加密
  const crypto = await import('crypto')
  const md5Hash = crypto.createHash('md5').update(newPassword).digest('base64')
  const userPassword = `{MD5}${md5Hash}`
  const client = createLdapClient(config)

  try {
    await client.bind(config.bindDN, config.bindPassword)
    await client.modify(dn, new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'userPassword',
        values: [userPassword]
      })
    }))
    return true
  } finally {
    await closeLdapClient(client)
  }
}

export async function getLdapUserDn(uid: string, config: LdapConfig = defaultConfig): Promise<string | null> {
  const client = createLdapClient(config)

  try {
    await client.bind(config.bindDN, config.bindPassword)
    const { searchEntries } = await client.search(config.userBase, {
      filter: escapeFilter`(uid=${uid})`,
      scope: 'sub',
      attributes: ['dn']
    })

    return searchEntries[0]?.dn ?? null
  } finally {
    await closeLdapClient(client)
  }
}
