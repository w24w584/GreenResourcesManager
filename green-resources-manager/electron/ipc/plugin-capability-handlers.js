const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const dns = require('dns').promises
const net = require('net')

const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 35000
const MAX_TIMEOUT_MS = 60000
const ALLOWED_METHODS = new Set(['GET', 'POST'])
const ALLOWED_HEADERS = new Set(['accept', 'content-type', 'user-agent'])

function isLoopbackHostname(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isPrivateAddress(address) {
  const normalized = String(address).toLowerCase().split('%')[0]
  if (net.isIPv4(normalized)) {
    const octets = normalized.split('.').map(Number)
    const [first, second] = octets
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 88 && octets[2] === 99) ||
      (first === 198 && second === 51 && octets[2] === 100) ||
      (first === 203 && second === 0 && octets[2] === 113) ||
      (first === 198 && (second === 18 || second === 19))
  }
  if (!net.isIPv6(normalized)) return true
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7)
    if (net.isIPv4(mapped)) return isPrivateAddress(mapped)
    const groups = mapped.split(':')
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0], 16)
      const low = Number.parseInt(groups[1], 16)
      if (Number.isFinite(high) && Number.isFinite(low)) {
        return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
      }
    }
    return true
  }
  if (normalized.startsWith('2001:0:') || normalized.startsWith('2002:') || normalized.startsWith('2001:db8:')) return true
  const firstGroup = Number.parseInt(normalized.split(':')[0], 16)
  return !Number.isFinite(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff
}

function validatePluginId(pluginId) {
  if (typeof pluginId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(pluginId)) {
    throw new Error('无效的插件编号')
  }
  return pluginId
}

function validateCredentialKey(key) {
  if (typeof key !== 'string' || !/^[a-z][a-zA-Z0-9-]{0,63}$/.test(key)) {
    throw new Error('无效的凭据编号')
  }
  return key
}

function createPinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    if (options && typeof options === 'object' && options.all) {
      callback(null, [{ address, family }])
      return
    }
    callback(null, address, family)
  }
}

function createPluginCapabilityHandlers(app, safeStorage) {
  const configDirectory = path.join(app.getPath('userData'), 'plugin-configs')
  const legacyAiConfigPath = path.join(app.getPath('userData'), 'ai-settings.json')

  function configPath(pluginId) {
    return path.join(configDirectory, `${validatePluginId(pluginId)}.json`)
  }

  function readStored(pluginId) {
    try {
      const stored = JSON.parse(fs.readFileSync(configPath(pluginId), 'utf8'))
      const credentials = {}
      const credentialKeys = Object.keys(stored.encryptedCredentials || {})
      const encryptionAvailable = safeStorage.isEncryptionAvailable()
      if (credentialKeys.length && encryptionAvailable) {
        for (const [key, encrypted] of Object.entries(stored.encryptedCredentials)) {
          credentials[key] = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
        }
      }
      return {
        config: stored.config || {},
        credentials,
        credentialKeys,
        credentialsUnavailable: credentialKeys.length > 0 && !encryptionAvailable
      }
    } catch {
      return { config: {}, credentials: {}, credentialKeys: [], credentialsUnavailable: false }
    }
  }

  function writeStored(pluginId, value) {
    if (value.credentialsUnavailable) throw new Error('系统安全存储当前不可用，未覆盖现有凭据')
    if (!safeStorage.isEncryptionAvailable() && Object.keys(value.credentials).length) {
      throw new Error('系统安全存储当前不可用，未保存凭据')
    }
    const encryptedCredentials = Object.fromEntries(Object.entries(value.credentials).map(([key, secret]) => [
      key,
      safeStorage.encryptString(String(secret)).toString('base64')
    ]))
    fs.mkdirSync(configDirectory, { recursive: true })
    fs.writeFileSync(configPath(pluginId), JSON.stringify({
      config: value.config,
      encryptedCredentials
    }, null, 2), { mode: 0o600 })
  }

  function loadConfig(pluginId) {
    const current = readStored(pluginId)
    if (pluginId !== 'ai-assistant' || current.config.provider || !fs.existsSync(legacyAiConfigPath)) return current
    try {
      const old = JSON.parse(fs.readFileSync(legacyAiConfigPath, 'utf8'))
      const credentials = { ...current.credentials }
      if (old.encryptedApiKey) {
        if (!safeStorage.isEncryptionAvailable()) return current
        credentials.apiKey = safeStorage.decryptString(Buffer.from(old.encryptedApiKey, 'base64'))
      }
      const migrated = {
        config: {
          provider: old.provider || 'doubao',
          model: old.model || '',
          baseUrl: old.baseUrl || ''
        },
        credentials
      }
      writeStored(pluginId, migrated)
      fs.unlinkSync(legacyAiConfigPath)
      return migrated
    } catch (error) {
      console.warn('迁移旧 AI 配置失败，保留原配置文件:', error)
      return current
    }
  }

  function publicConfig(stored) {
    const credentialKeys = new Set([...(stored.credentialKeys || []), ...Object.keys(stored.credentials)])
    return {
      config: stored.config,
      credentials: Object.fromEntries(Array.from(credentialKeys).map((key) => [key, true]))
    }
  }

  async function resolvePublicAddress(hostname, allowLocal) {
    if (allowLocal && isLoopbackHostname(hostname)) {
      return { address: hostname === 'localhost' ? '127.0.0.1' : hostname, family: net.isIPv6(hostname) ? 6 : 4 }
    }
    if (net.isIP(hostname)) {
      if (isPrivateAddress(hostname)) throw new Error('网络请求不允许访问本机或私有网络地址')
      return { address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }
    }
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true })
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('网络请求目标解析到本机或私有网络地址，已拒绝')
    }
    return addresses[0]
  }

  async function performRequest(url, method, headers, body, timeoutMs, redirectsRemaining, credentialOrigin, allowLocal) {
    const isLocal = allowLocal && url.protocol === 'http:' && isLoopbackHostname(url.hostname)
    const { address, family } = await resolvePublicAddress(url.hostname, allowLocal)
    return new Promise((resolve, reject) => {
      const requestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        timeout: timeoutMs,
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        lookup: isLocal ? undefined : createPinnedLookup(address, family)
      }
      const transport = url.protocol === 'http:' ? http : https
      const outgoing = transport.request(url, requestOptions, (response) => {
        const status = response.statusCode || 0
        const location = response.headers?.location
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          if (redirectsRemaining <= 0) {
            response.resume()
            reject(new Error('插件网络请求重定向次数超过限制'))
            return
          }
          let nextUrl
          try {
            nextUrl = new URL(location, url)
            const nextIsLocal = allowLocal && nextUrl.protocol === 'http:' && isLoopbackHostname(nextUrl.hostname)
            if ((nextUrl.protocol !== 'https:' && !nextIsLocal) || nextUrl.username || nextUrl.password) {
              throw new Error('插件网络请求重定向只允许 HTTPS（本地模型允许回环 HTTP）')
            }
          } catch (error) {
            response.resume()
            reject(error)
            return
          }

          const nextHeaders = { ...headers }
          if (credentialOrigin && nextUrl.origin !== credentialOrigin) delete nextHeaders.Authorization
          const changesToGet = status === 303 || ((status === 301 || status === 302) && method === 'POST')
          if (changesToGet) delete nextHeaders['Content-Type']
          response.on('error', reject)
          response.on('end', () => {
            performRequest(
              nextUrl,
              changesToGet ? 'GET' : method,
              nextHeaders,
              changesToGet ? '' : body,
              timeoutMs,
              redirectsRemaining - 1,
              credentialOrigin,
              allowLocal
            ).then(resolve, reject)
          })
          response.resume()
          return
        }

        const chunks = []
        let size = 0
        response.on('data', (chunk) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('网络响应超过 2 MB 限制'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        }))
        response.on('error', reject)
      })
      outgoing.on('timeout', () => outgoing.destroy(new Error('插件网络请求超时')))
      outgoing.on('error', reject)
      if (body) outgoing.write(body)
      outgoing.end()
    })
  }

  async function request(options) {
    options = options || {}
    const allowLocal = options.allowLocal === true
    const url = new URL(String(options?.url || ''))
    const isLocal = allowLocal && url.protocol === 'http:' && isLoopbackHostname(url.hostname)
    if (!isLocal && (url.protocol !== 'https:' || url.username || url.password)) {
      throw new Error('插件网络请求只允许不含凭据的 HTTPS URL（本地模型可显式允许回环 HTTP）')
    }
    const method = String(options.method || 'GET').toUpperCase()
    if (!ALLOWED_METHODS.has(method)) throw new Error('插件网络请求只允许 GET 或 POST')
    const headers = {}
    for (const [name, value] of Object.entries(options.headers || {})) {
      const normalizedName = name.toLowerCase()
      if (!ALLOWED_HEADERS.has(normalizedName) || typeof value !== 'string' || /[\r\n]/.test(value)) {
        throw new Error(`不允许的网络请求头: ${name}`)
      }
      headers[name] = value
    }
    const body = options.body == null ? '' : String(options.body)
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new Error('网络请求内容超过 1 MB 限制')
    const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS))
    const credentialKey = options.credentialKey ? validateCredentialKey(String(options.credentialKey)) : ''
    const credentialPrefix = options.credentialPrefix === undefined ? 'Bearer ' : String(options.credentialPrefix)
    if (/[\r\n]/.test(credentialPrefix) || credentialPrefix.length > 128) throw new Error('无效的凭据请求前缀')
    const stored = loadConfig(validatePluginId(options.pluginId))
    let credentialOrigin = ''
    if (credentialKey) {
      const secret = stored.credentials[credentialKey]
      if (!secret) throw new Error('尚未配置该插件凭据')
      if (/[\r\n]/.test(secret) || Buffer.byteLength(secret, 'utf8') > 8192) throw new Error('该插件凭据格式无效')
      let configuredOrigin = ''
      try { configuredOrigin = new URL(String(stored.config.baseUrl || '')).origin } catch {}
      if (!configuredOrigin || configuredOrigin !== url.origin) throw new Error('凭据只能发送到插件配置的服务地址')
      headers.Authorization = `${credentialPrefix}${secret}`
      credentialOrigin = url.origin
    }
    return performRequest(url, method, headers, body, timeoutMs, 3, credentialOrigin, allowLocal)
  }

  return {
    getConfig(pluginId) {
      return publicConfig(loadConfig(validatePluginId(pluginId)))
    },
    saveConfig(pluginId, config, credentials) {
      const current = loadConfig(validatePluginId(pluginId))
      if (current.credentialsUnavailable) throw new Error('系统安全存储当前不可用，未覆盖现有凭据')
      const next = {
        config: { ...current.config, ...(config && typeof config === 'object' ? config : {}) },
        credentials: { ...current.credentials },
        credentialKeys: current.credentialKeys,
        credentialsUnavailable: false
      }
      for (const [key, value] of Object.entries(credentials || {})) {
        validateCredentialKey(key)
        if (value === null || value === '') delete next.credentials[key]
        else if (typeof value === 'string' && !/[\r\n]/.test(value) && Buffer.byteLength(value, 'utf8') <= 8192) next.credentials[key] = value
        else if (typeof value === 'string') throw new Error('凭据格式无效或超过 8 KB 限制')
        else throw new Error('凭据值必须是字符串')
      }
      writeStored(validatePluginId(pluginId), next)
      return publicConfig(next)
    },
    resetConfig(pluginId) {
      try { fs.unlinkSync(configPath(pluginId)) } catch {}
      if (pluginId === 'ai-assistant') {
        try { fs.unlinkSync(legacyAiConfigPath) } catch {}
      }
      return { config: {}, credentials: {} }
    },
    request
  }
}

function registerIpcHandlers(ipcMain, app, safeStorage, getMainWebContents = () => null) {
  const handlers = createPluginCapabilityHandlers(app, safeStorage)
  const capabilityTokens = new Map()
  const assertMainWindow = (event) => {
    const mainWebContents = getMainWebContents()
    if (mainWebContents && event.sender !== mainWebContents) {
      throw new Error('插件宿主能力仅限主窗口使用')
    }
  }
  const authorize = (event, pluginId, token) => {
    assertMainWindow(event)
    validatePluginId(pluginId)
    if (!capabilityTokens.has(pluginId) || capabilityTokens.get(pluginId) !== token) {
      throw new Error('插件没有此项宿主能力的授权')
    }
  }
  ipcMain.handle('plugin-capability:bind', (event, pluginId, token) => {
    assertMainWindow(event)
    validatePluginId(pluginId)
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || capabilityTokens.has(pluginId)) {
      return { ok: false }
    }
    capabilityTokens.set(pluginId, token)
    return { ok: true }
  })
  ipcMain.handle('plugin-capability:revoke', (event, pluginId, token) => {
    authorize(event, pluginId, token)
    capabilityTokens.delete(pluginId)
    return { ok: true }
  })
  ipcMain.handle('plugin-capability:get-config', (event, pluginId, token) => {
    authorize(event, pluginId, token)
    return handlers.getConfig(pluginId)
  })
  ipcMain.handle('plugin-capability:save-config', (event, pluginId, token, config, credentials) => {
    authorize(event, pluginId, token)
    try { return { ok: true, ...handlers.saveConfig(pluginId, config, credentials) } }
    catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('plugin-capability:reset-config', (event, pluginId, token) => {
    authorize(event, pluginId, token)
    return handlers.resetConfig(pluginId)
  })
  ipcMain.handle('plugin-capability:request', (event, pluginId, token, options) => {
    authorize(event, pluginId, token)
    return handlers.request({ ...options, pluginId })
  })
}

module.exports = { registerIpcHandlers, createPluginCapabilityHandlers, createPinnedLookup, isPrivateAddress }
