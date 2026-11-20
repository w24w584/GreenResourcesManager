import { describe, expect, it } from 'vitest'
import { findPluginSettingsPage, mergeSettingsCategories, toPluginCategoryId } from './settingsCategories'

const builtIn = [
  { id: 'general', name: '通用', icon: '⚙️', description: '' },
  { id: 'pageManagement', name: '页面管理', icon: '🧩', description: '' },
  { id: 'updates', name: '更新', icon: '🔄', description: '' }
]

describe('settingsCategories', () => {
  it('inserts plugin pages before the page management category', () => {
    const pages = [{ id: 'ai', pluginId: 'ai-assistant', name: 'AI 设置', content: '', order: 10 }]
    const merged = mergeSettingsCategories(builtIn, pages)

    expect(merged.map((category) => category.id)).toEqual([
      'general',
      'plugin:ai-assistant:ai',
      'pageManagement',
      'updates'
    ])
    expect(merged[1]).toMatchObject({ name: 'AI 设置', unlocalized: true, pluginPage: true })
  })

  it('finds a plugin page by its category id', () => {
    const pages = [{ id: 'ai', pluginId: 'ai-assistant', name: 'AI 设置', content: '' }]
    const categoryId = toPluginCategoryId(pages[0])

    expect(findPluginSettingsPage(pages, categoryId)).toBe(pages[0])
    expect(findPluginSettingsPage(pages, 'general')).toBeUndefined()
  })
})
