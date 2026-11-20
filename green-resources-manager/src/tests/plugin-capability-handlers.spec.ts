import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import http from 'node:http'
import { promises as dns } from 'node:dns'
import pluginCapabilityModule from '../../electron/ipc/plugin-capability-handlers.js'

const { createPluginCapabilityHandlers, createPinnedLookup, isPrivateAddress, registerIpcHandlers } = pluginCapabilityModule as any
const temporaryDirectories: string[] = []
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
}

afterEach(async () => {
  vi.restoreAllMocks()
  const fs = await import('node:fs')
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

async function createHandlers() {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-plugin-cap-'))
  temporaryDirectories.push(userData)
  return { handlers: createPluginCapabilityHandlers({ getPath: () => userData }, safeStorage), userData }
}

describe('plugin host capabilities', () => {
  it('encrypts plugin secrets, never returns them, and keeps config scoped per plugin', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { handlers, userData } = await createHandlers()

    const saved = handlers.saveConfig('ai-assistant', { provider: 'custom' }, { apiKey: 'secret-value' })
    const loaded = handlers.getConfig('ai-assistant')
    const file = fs.readFileSync(path.join(userData, 'plugin-configs', 'ai-assistant.json'), 'utf8')

    expect(saved).toEqual({ config: { provider: 'custom' }, credentials: { apiKey: true } })
    expect(loaded).toEqual({ config: { provider: 'custom' }, credentials: { apiKey: true } })
    expect(file).not.toContain('secret-value')
    expect(handlers.getConfig('other-plugin')).toEqual({ config: {}, credentials: {} })
  })

  it('migrates the old AI config and removes the legacy file only after migration', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { handlers, userData } = await createHandlers()
    fs.writeFileSync(path.join(userData, 'ai-settings.json'), JSON.stringify({
      provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com',
      encryptedApiKey: Buffer.from('encrypted:old-secret').toString('base64')
    }))

    expect(handlers.getConfig('ai-assistant')).toEqual({
      config: { provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
      credentials: { apiKey: true }
    })
    expect(fs.existsSync(path.join(userData, 'ai-settings.json'))).toBe(false)
  })

  it('keeps the legacy encrypted config when system decryption is unavailable', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { userData } = await createHandlers()
    const legacyPath = path.join(userData, 'ai-settings.json')
    fs.writeFileSync(legacyPath, JSON.stringify({
      provider: 'deepseek', encryptedApiKey: Buffer.from('opaque-ciphertext').toString('base64')
    }))
    const unavailableStorage = { isEncryptionAvailable: () => false }
    const handlers = createPluginCapabilityHandlers({ getPath: () => userData }, unavailableStorage)

    expect(handlers.getConfig('ai-assistant')).toEqual({ config: {}, credentials: {} })
    expect(fs.existsSync(legacyPath)).toBe(true)
  })

  it('requires the bound plugin token for host capabilities', async () => {
    const registeredHandlers = new Map<string, Function>()
    const { userData } = await createHandlers()
    const app = { getPath: () => userData }
    const mainWebContents = {}
    registerIpcHandlers({ handle: (name: string, handler: Function) => registeredHandlers.set(name, handler) }, app, safeStorage, () => mainWebContents)
    const token = 'a'.repeat(64)
    const bind = registeredHandlers.get('plugin-capability:bind') as Function
    const getConfig = registeredHandlers.get('plugin-capability:get-config') as Function
    const revoke = registeredHandlers.get('plugin-capability:revoke') as Function

    expect(() => bind({ sender: {} }, 'ai-assistant', token)).toThrow('仅限主窗口')
    expect(await bind({ sender: mainWebContents }, 'ai-assistant', token)).toEqual({ ok: true })
    expect(() => getConfig({ sender: mainWebContents }, 'ai-assistant', 'b'.repeat(64))).toThrow('没有此项宿主能力的授权')
    expect(await getConfig({ sender: mainWebContents }, 'ai-assistant', token)).toEqual({ config: {}, credentials: {} })
    await revoke({ sender: mainWebContents }, 'ai-assistant', token)
    expect(() => getConfig({ sender: mainWebContents }, 'ai-assistant', token)).toThrow('没有此项宿主能力的授权')
  })

  it('rejects non-HTTPS, private-network and unsupported-method requests', async () => {
    const { handlers } = await createHandlers()
    await expect(handlers.request({ pluginId: 'test-plugin', url: 'http://example.com' })).rejects.toThrow('HTTPS')
    await expect(handlers.request({ pluginId: 'test-plugin', url: 'https://127.0.0.1' })).rejects.toThrow('私有网络')
    await expect(handlers.request({ pluginId: 'test-plugin', url: 'https://example.com', method: 'DELETE' })).rejects.toThrow('GET 或 POST')
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false)
  })

  it('returns the pinned DNS result in both Node lookup callback formats', () => {
    const lookup = createPinnedLookup('203.0.113.8', 4)
    const singleResult = vi.fn()
    const allResults = vi.fn()

    lookup('api.example.com', {}, singleResult)
    lookup('api.example.com', { all: true }, allResults)

    expect(singleResult).toHaveBeenCalledWith(null, '203.0.113.8', 4)
    expect(allResults).toHaveBeenCalledWith(null, [{ address: '203.0.113.8', family: 4 }])
  })

  it('allows explicit loopback HTTP for local models only', async () => {
    const { handlers } = await createHandlers()
    const requests: any[] = []
    vi.spyOn(http, 'request').mockImplementation(((url: any, options: any, callback: any) => {
      requests.push({ url: String(url), options })
      const request = new EventEmitter() as any
      request.write = vi.fn()
      request.end = () => {
        const response = new EventEmitter() as any
        response.statusCode = 200
        response.headers = {}
        response.resume = () => {}
        response.destroy = vi.fn()
        queueMicrotask(() => {
          callback(response)
          queueMicrotask(() => {
            response.emit('data', Buffer.from('local-ok'))
            response.emit('end')
          })
        })
      }
      request.destroy = vi.fn()
      return request
    }) as any)

    const result = await handlers.request({
      pluginId: 'ai-assistant',
      url: 'http://127.0.0.1:11434/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      allowLocal: true
    })

    expect(result).toMatchObject({ status: 200, ok: true, body: 'local-ok' })
    expect(requests).toHaveLength(1)
    expect(requests[0].options.lookup).toBeUndefined()
    await expect(handlers.request({ pluginId: 'ai-assistant', url: 'http://example.com' })).rejects.toThrow('HTTPS')
  })

  it('follows validated HTTPS redirects without forwarding credentials cross-origin', async () => {    const { handlers } = await createHandlers()
    handlers.saveConfig('ai-assistant', { baseUrl: 'https://api.example.com/v1' }, { apiKey: 'secret-value' })
    const requests: any[] = []
    vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any)
    vi.spyOn(https, 'request').mockImplementation(((url: any, options: any, callback: any) => {
      requests.push({ url: String(url), options })
      const request = new EventEmitter() as any
      request.write = vi.fn()
      request.end = () => {
        const response = new EventEmitter() as any
        response.statusCode = requests.length === 1 ? 302 : 200
        response.headers = requests.length === 1 ? { location: 'https://cdn.example.net/redirected' } : {}
        response.resume = () => {}
        response.destroy = vi.fn()
        queueMicrotask(() => {
          callback(response)
          queueMicrotask(() => {
            if (response.statusCode === 200) response.emit('data', Buffer.from('ok'))
            response.emit('end')
          })
        })
      }
      request.destroy = vi.fn()
      return request
    }) as any)

    const result = await handlers.request({
      pluginId: 'ai-assistant',
      url: 'https://api.example.com/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      credentialKey: 'apiKey'
    })

    expect(result).toMatchObject({ status: 200, ok: true, body: 'ok' })
    expect(requests).toHaveLength(2)
    expect(requests[0].options.headers.Authorization).toBe('Bearer secret-value')
    expect(requests[1].options.headers.Authorization).toBeUndefined()
    expect(requests[1].options.method).toBe('GET')
  })
})
