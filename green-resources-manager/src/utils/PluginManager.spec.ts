import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginManager } from './PluginManager'

describe('PluginManager enable state', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('does not report enabled when plugin loading fails', async () => {
    const manager = new PluginManager()
    const plugin = { id: 'ai-assistant', enabled: false } as any
    ;(manager as any).plugins = [plugin]
    const loadPlugin = vi.spyOn(manager, 'loadPlugin').mockResolvedValue(false)

    const result = await manager.setPluginEnabled('ai-assistant', true)

    expect(loadPlugin).toHaveBeenCalledWith('ai-assistant')
    expect(result).toBe(false)
    expect(plugin.enabled).toBe(false)
    expect(localStorage.getItem('plugin-ai-assistant-enabled')).toBeNull()
  })
})