import { afterEach, describe, expect, it } from 'vitest'
import SettingsView from './SettingsView.vue'
import pluginContributionManager from '../mod-host/PluginContributions'

function createViewModel(component: any) {
  const vm: any = {
    ...component.data(),
    t: (key: string) => key
  }
  for (const [name, method] of Object.entries(component.methods)) {
    vm[name] = (method as Function).bind(vm)
  }
  return vm
}

describe('SettingsView plugin pages', () => {
  afterEach(() => {
    pluginContributionManager.clearByPluginId('settings-view-test')
    pluginContributionManager.clearByPluginId('ai-assistant')
  })

  it('merges plugin settings pages into the built-in categories', () => {
    pluginContributionManager.registerSettingsPage({
      id: 'ai',
      pluginId: 'settings-view-test',
      name: 'AI 设置',
      description: '配置 AI 服务商和本地密钥',
      content: '<section>API 配置表单</section>'
    })

    const component = SettingsView as any
    const vm = createViewModel(component)
    vm.refreshPluginSettingsPages()

    const category = vm.settingsCategories.find((item: any) => item.id === 'plugin:settings-view-test:ai')
    expect(category).toMatchObject({ name: 'AI 设置', unlocalized: true, pluginPage: true })

    vm.currentCategory = category.id
    expect(vm.getCurrentCategoryName()).toBe('AI 设置')
    expect(vm.getPluginSettingsPage()?.content).toBe('<section>API 配置表单</section>')
  })

  it('drops plugin categories that disappear and falls back to the general page', () => {
    pluginContributionManager.registerSettingsPage({
      id: 'ai',
      pluginId: 'settings-view-test',
      name: 'AI 设置',
      content: '<section>API 配置表单</section>'
    })

    const component = SettingsView as any
    const vm = createViewModel(component)
    vm.refreshPluginSettingsPages()
    vm.currentCategory = 'plugin:settings-view-test:ai'

    pluginContributionManager.clearByPluginId('settings-view-test')
    vm.refreshPluginSettingsPages()

    expect(vm.settingsCategories.some((item: any) => item.id === 'plugin:settings-view-test:ai')).toBe(false)
    expect(vm.currentCategory).toBe('general')
  })

  it('keeps the AI page before the built-in page management category', () => {
    pluginContributionManager.registerSettingsPage({
      id: 'ai',
      pluginId: 'ai-assistant',
      name: 'AI 设置',
      content: '<section>真实 AI 配置</section>'
    })

    const component = SettingsView as any
    const vm = createViewModel(component)
    vm.refreshPluginSettingsPages()

    const aiCategoryIndex = vm.settingsCategories.findIndex((item: any) => item.id === 'plugin:ai-assistant:ai')
    const pageManagementIndex = vm.settingsCategories.findIndex((item: any) => item.id === 'pageManagement')
    expect(aiCategoryIndex).toBeGreaterThanOrEqual(0)
    expect(aiCategoryIndex).toBeLessThan(pageManagementIndex)
  })
})
