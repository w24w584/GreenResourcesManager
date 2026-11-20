import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

function loadAiMod() {
  const source = readFileSync(resolve(process.cwd(), 'mods/ai-assistant/index.js'), 'utf8')
    .replace(/export\s+default\s+/, 'module.exports = ')
  const module = { exports: {} as any }
  new Function('module', 'exports', source)(module, module.exports)
  return module.exports
}

const resourceFields = [
  { key: 'name', label: '名称', type: 'TextFormField', required: true },
  { key: 'description', label: '说明', type: 'TextFormField', required: false },
  { key: 'category', label: '分类', type: 'TextFormField', required: false },
  { key: 'tags', label: '标签', type: 'TagsFormField', required: false },
  // 打包压缩后宿主导出的类名会变成 Yt 这类短名，这里用短名模拟正式版。
  { key: 'developers', label: '开发商', type: 'Yt', required: false }
]

function waitForAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('AI assistant mod', () => {
  it('searches with the generic host API and only fills the resource fields that exist', async () => {
    const aiMod = loadAiMod()
    let editAction: any
    let settingsPage: any
    let modal: any
    const apply = vi.fn()
    const requests: any[] = []
    const api = {
      settings: { registerPage: (page: any) => { settingsPage = page }, unregisterPage: vi.fn() },
      resources: { registerEditAction: (action: any) => { editAction = action }, unregisterEditAction: vi.fn() },
      config: {
        get: async () => ({
          config: { provider: 'custom', model: 'test-model', baseUrl: 'https://api.example.com/v1' },
          credentials: { apiKey: true }
        }),
        set: vi.fn(async () => ({
          config: { provider: 'custom', model: 'test-model', baseUrl: 'https://api.example.com/v1' },
          credentials: { apiKey: true }
        }))
      },
      secrets: { has: async () => true },
      net: {
        request: async (options: any) => {
          requests.push(options)
          if (options.url.includes('bing.com')) {
            return { ok: true, status: 200, body: '<rss><channel><item><title>Example</title><link>https://example.test</link><description>Metadata</description></item></channel></rss>' }
          }
          return { ok: true, status: 200, body: JSON.stringify({ choices: [{ message: { content: '```json\n{"title":"Example title","summary":"Short summary","category":"RPG","tags":["Indie"],"developers":"米哈游","unknown":"ignored"}\n```' } }] }) }
        }
      },
      ui: {
        showNotification: vi.fn(),
        showCustomModal: (config: any) => { modal = config },
        closeCustomModal: vi.fn()
      }
    }

    aiMod.onLoad(api)
    expect(settingsPage.name).toBe('AI 设置')

    const settingsContainer = document.createElement('div')
    settingsContainer.innerHTML = settingsPage.content
    await settingsPage.onMount(settingsContainer)
    expect((settingsContainer.querySelector('[data-field="model"]') as HTMLInputElement).value).toBe('test-model')
    expect(settingsContainer.querySelector('[data-field="keyStatus"]')?.textContent).toContain('已保存密钥')

    ;(settingsContainer.querySelector('[data-field="apiKey"]') as HTMLInputElement).value = 'new-secret'
    ;(settingsContainer.querySelector('[data-action="save"]') as HTMLButtonElement).click()
    await waitForAsyncWork()
    expect(api.config.set).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'test-model', baseUrl: 'https://api.example.com/v1' }),
      { apiKey: 'new-secret' }
    )

    await editAction.onClick({
      resourceName: 'Game',
      formData: { name: 'Example', description: '', category: '', tags: [], developers: [] },
      fields: resourceFields,
      apply
    })
    const container = document.createElement('div')
    container.innerHTML = modal.content
    await modal.onMount(container)
    expect(modal.size).toBe('lg')
    ;(container.querySelector('[data-action="search"]') as HTMLButtonElement).click()
    await waitForAsyncWork()

    expect((container.querySelector('[data-step="preview"]') as HTMLElement).hidden).toBe(false)
    expect((container.querySelector('[data-include="name"]') as HTMLInputElement).checked).toBe(false)
    expect((container.querySelector('[data-include="description"]') as HTMLInputElement).checked).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[0].url).toContain('bing.com/search')
    expect(requests[1]).toMatchObject({
      method: 'POST',
      credentialKey: 'apiKey',
      credentialPrefix: 'Bearer '
    })
    expect(requests[1].body).toContain('资源元信息整理助手')
    expect(requests[1].body).toContain('联网搜索结果')

    ;(container.querySelector('[data-action="select-all"]') as HTMLButtonElement).click()
    ;(container.querySelector('[data-action="apply"]') as HTMLButtonElement).click()
    expect(apply).toHaveBeenCalledWith({
      name: 'Example title',
      description: 'Short summary',
      category: 'RPG',
      tags: ['Indie'],
      // 类名在正式版里被压缩成 Yt，仍要靠表单值形态认出这是多值字段，不能拆成逐字数组。
      developers: ['米哈游']
    })

    await editAction.onClick({
      resourceName: 'Game',
      formData: { name: 'Example game', description: '', tags: [] },
      fields: resourceFields.filter((field) => field.key !== 'category'),
      apply
    })
    expect(editAction.when({
      resourceName: 'Game',
      formData: { name: 'Example game' },
      fields: resourceFields
    })).toBe(true)
    expect(editAction.when({
      resourceName: 'Game',
      formData: { name: 'Example game' },
      fields: [{ key: 'coverPath', label: '封面', type: 'TextFormField', required: false }]
    })).toBe(false)

    aiMod.onUnload(api)
  })

  it('updates its settings translations when the app language changes', () => {
    const previousLanguage = localStorage.getItem('app-language')
    localStorage.setItem('app-language', 'en')
    const aiMod = loadAiMod()
    let settingsPage: any
    const api = {
      settings: {
        registerPage: (page: any) => { settingsPage = page },
        unregisterPage: vi.fn()
      },
      resources: { registerEditAction: vi.fn(), unregisterEditAction: vi.fn() }
    }

    aiMod.onLoad(api)
    expect(settingsPage.name).toBe('AI Settings')
    expect(settingsPage.description).toBe('Configure AI providers, models, and local API keys')
    expect(settingsPage.content).toContain('Provider')

    localStorage.setItem('app-language', 'zh-TW')
    window.dispatchEvent(new CustomEvent('app-language-changed', { detail: { locale: 'zh-TW' } }))

    expect(settingsPage.name).toBe('AI 設定')
    expect(settingsPage.description).toBe('設定 AI 服務商、模型和本機金鑰')
    aiMod.onUnload(api)
    if (previousLanguage === null) localStorage.removeItem('app-language')
    else localStorage.setItem('app-language', previousLanguage)
  })
})
