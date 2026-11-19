import type { PluginSettingsPage } from './PluginContributions'

export const PLUGIN_CATEGORY_PREFIX = 'plugin:'

export interface SettingsCategory {
  id: string
  name: string
  icon: string
  description: string
  unlocalized?: boolean
  pluginPage?: boolean
}

export function toPluginCategoryId(page: Pick<PluginSettingsPage, 'pluginId' | 'id'>): string {
  return `${PLUGIN_CATEGORY_PREFIX}${page.pluginId}:${page.id}`
}

export function isPluginCategoryId(categoryId: string): boolean {
  return categoryId.startsWith(PLUGIN_CATEGORY_PREFIX)
}

/**
 * 把插件设置页插到内置分类里。
 * 默认放在「页面管理」之前，这样常用配置和插件配置都在导航上半部分。
 */
export function mergeSettingsCategories(
  builtInCategories: SettingsCategory[],
  pages: PluginSettingsPage[]
): SettingsCategory[] {
  const pluginCategories: SettingsCategory[] = pages.map((page) => ({
    id: toPluginCategoryId(page),
    name: page.name,
    icon: page.icon || '🧩',
    description: page.description || '',
    unlocalized: true,
    pluginPage: true
  }))

  const anchorIndex = builtInCategories.findIndex((category) => category.id === 'pageManagement')
  const insertAt = anchorIndex < 0 ? builtInCategories.length : anchorIndex
  return [
    ...builtInCategories.slice(0, insertAt),
    ...pluginCategories,
    ...builtInCategories.slice(insertAt)
  ]
}

export function findPluginSettingsPage(
  pages: PluginSettingsPage[],
  categoryId: string
): PluginSettingsPage | undefined {
  if (!isPluginCategoryId(categoryId)) return undefined
  return pages.find((page) => toPluginCategoryId(page) === categoryId)
}
