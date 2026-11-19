import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostApi, destroyHostApi } from './PluginHost'
import pluginContributions from './PluginContributions'

interface BridgeMock {
  pluginCapabilityBind: ReturnType<typeof vi.fn>
  pluginCapabilityRevoke: ReturnType<typeof vi.fn>
  pluginConfigGet: ReturnType<typeof vi.fn>
  pluginConfigSave: ReturnType<typeof vi.fn>
  pluginConfigReset: ReturnType<typeof vi.fn>
  pluginRequest: ReturnType<typeof vi.fn>
}

function installBridge(overrides: Partial<BridgeMock> = {}): BridgeMock {
  const bridge: BridgeMock = {
    pluginCapabilityBind: vi.fn().mockResolvedValue({ ok: true }),
    pluginCapabilityRevoke: vi.fn().mockResolvedValue({ ok: true }),
    pluginConfigGet: vi.fn().mockResolvedValue({ config: {}, credentials: {} }),
    pluginConfigSave: vi.fn().mockResolvedValue({ ok: true, config: {}, credentials: {} }),
    pluginConfigReset: vi.fn().mockResolvedValue({ config: {}, credentials: {} }),
    pluginRequest: vi.fn().mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{}' }),
    ...overrides
  }
  ;(window as any).electronAPI = bridge
  return bridge
}

afterEach(async () => {
  await destroyHostApi('host-test')
  delete (window as any).electronAPI
  pluginContributions.clearByPluginId('host-test')
  vi.restoreAllMocks()
})

describe('PluginHost', () => {
  it('dispatches modal requests separately from full-page plugin views', async () => {
    installBridge()
    const api = await createHostApi('host-test')
    const listener = vi.fn()
    window.addEventListener('plugin-show-custom-modal', listener)

    api.ui.showCustomModal({ title: 'AI 填充', content: '<div>内容</div>', size: 'lg' })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].detail).toMatchObject({
      pluginId: 'host-test',
      title: 'AI 填充',
      content: '<div>内容</div>',
      size: 'lg'
    })
    window.removeEventListener('plugin-show-custom-modal', listener)
  })

  it('dispatches close events for the modal and full-page layers', async () => {
    installBridge()
    const api = await createHostApi('host-test')
    const modalListener = vi.fn()
    const viewListener = vi.fn()
    window.addEventListener('plugin-close-custom-modal', modalListener)
    window.addEventListener('plugin-close-custom-view', viewListener)

    api.ui.closeCustomModal()
    api.ui.closeCustomView()

    expect(modalListener).toHaveBeenCalledOnce()
    expect(viewListener).toHaveBeenCalledOnce()
    window.removeEventListener('plugin-close-custom-modal', modalListener)
    window.removeEventListener('plugin-close-custom-view', viewListener)
  })

  it('routes config and network calls through the bound capability token', async () => {
    const bridge = installBridge()
    const api = await createHostApi('host-test')
    const token = bridge.pluginCapabilityBind.mock.calls[0][1]

    bridge.pluginConfigGet.mockResolvedValue({ config: { model: 'gpt' }, credentials: { apiKey: true } })
    bridge.pluginConfigSave.mockResolvedValue({ ok: true, config: { model: 'gpt' }, credentials: { apiKey: true } })
    bridge.pluginRequest.mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"ok":true}' })

    await expect(api.config.get()).resolves.toEqual({ config: { model: 'gpt' }, credentials: { apiKey: true } })
    await expect(api.secrets.has('apiKey')).resolves.toBe(true)
    await expect(api.config.set({ model: 'gpt' }, { apiKey: 'secret' })).resolves.toMatchObject({ config: { model: 'gpt' } })
    await expect(api.net.request({ url: 'http://127.0.0.1:11434/v1/chat/completions', allowLocal: true }))
      .resolves.toMatchObject({ status: 200, ok: true })

    expect(bridge.pluginConfigSave).toHaveBeenCalledWith('host-test', token, { model: 'gpt' }, { apiKey: 'secret' })
    expect(bridge.pluginRequest).toHaveBeenCalledWith('host-test', token, {
      url: 'http://127.0.0.1:11434/v1/chat/completions',
      allowLocal: true
    })
  })

  it('rejects saving when the host reports a failure', async () => {
    installBridge({ pluginConfigSave: vi.fn().mockResolvedValue({ ok: false, error: '系统安全存储当前不可用' }) })
    const api = await createHostApi('host-test')

    await expect(api.config.set({})).rejects.toThrow('系统安全存储当前不可用')
  })

  it('clears plugin contributions and revokes the token on destroy', async () => {
    const bridge = installBridge()
    const api = await createHostApi('host-test')
    pluginContributions.registerSettingsPage({ id: 'page', pluginId: 'host-test', name: 'Page', content: '' })

    await destroyHostApi('host-test')

    expect(pluginContributions.getSettingsPages().some((page) => page.pluginId === 'host-test')).toBe(false)
    expect(bridge.pluginCapabilityRevoke).toHaveBeenCalledWith('host-test', bridge.pluginCapabilityBind.mock.calls[0][1])
  })
})
