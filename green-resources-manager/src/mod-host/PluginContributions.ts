/**
 * 插件贡献注册表（宿主侧）
 *
 * 这个文件属于「宿主扩展层」，不是上游代码。插件通过 PluginHost 暴露的
 * api.resources / api.settings 把按钮和设置页注册到这里，上游的
 * ResourcesEditDialog / SettingsView 只负责渲染这里的内容。
 *
 * 卸载插件时 PluginHost 会调用 clearByPluginId 统一清理，避免残留贡献。
 */

export interface PluginResourceField {
  key: string
  label: string
  type: string
  required: boolean
  options?: string[]
}

export interface PluginResourceEditContext {
  resourceName: string
  formData: Record<string, unknown>
  fields: PluginResourceField[]
  apply: (patch: Record<string, unknown>) => void
}

export interface PluginResourceEditAction {
  id: string
  pluginId: string
  label: string
  icon?: string
  /** 越小越靠前，默认 100 */
  order?: number
  /** 返回 false 时该按钮在当前资源上隐藏 */
  when?: (context: Pick<PluginResourceEditContext, 'resourceName' | 'formData' | 'fields'>) => boolean
  onClick: (context: PluginResourceEditContext) => void | Promise<void>
}

export interface PluginSettingsPage {
  id: string
  pluginId: string
  name: string
  description?: string
  icon?: string
  /** 越小越靠前，默认 100 */
  order?: number
  content: string
  onMount?: (container: HTMLElement) => void | Promise<void>
  /** 切换到别的设置页或卸载插件时调用，用于清理计时器 / 全局监听 */
  onUnmount?: (container: HTMLElement) => void
}

export const PLUGIN_CONTRIBUTIONS_UPDATED = 'plugin-contributions-updated'

function byOrderThenName(a: { order?: number; name?: string; label?: string }, b: { order?: number; name?: string; label?: string }) {
  const orderA = a.order ?? 100
  const orderB = b.order ?? 100
  if (orderA !== orderB) return orderA - orderB
  return String(a.name ?? a.label ?? '').localeCompare(String(b.name ?? b.label ?? ''))
}

export class PluginContributionManager {
  private resourceEditActions = new Map<string, PluginResourceEditAction>()
  private settingsPages = new Map<string, PluginSettingsPage>()

  private getKey(pluginId: string, id: string): string {
    return `${pluginId}:${id}`
  }

  private notifyUpdated(pluginId?: string): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(PLUGIN_CONTRIBUTIONS_UPDATED, { detail: { pluginId } }))
    }
  }

  registerResourceEditAction(action: PluginResourceEditAction): void {
    this.resourceEditActions.set(this.getKey(action.pluginId, action.id), action)
    this.notifyUpdated(action.pluginId)
  }

  getResourceEditActions(): PluginResourceEditAction[] {
    return Array.from(this.resourceEditActions.values()).sort(byOrderThenName)
  }

  unregisterResourceEditAction(pluginId: string, id: string): void {
    if (this.resourceEditActions.delete(this.getKey(pluginId, id))) {
      this.notifyUpdated(pluginId)
    }
  }

  registerSettingsPage(page: PluginSettingsPage): void {
    this.settingsPages.set(this.getKey(page.pluginId, page.id), page)
    this.notifyUpdated(page.pluginId)
  }

  getSettingsPages(): PluginSettingsPage[] {
    return Array.from(this.settingsPages.values()).sort(byOrderThenName)
  }

  unregisterSettingsPage(pluginId: string, id: string): void {
    if (this.settingsPages.delete(this.getKey(pluginId, id))) {
      this.notifyUpdated(pluginId)
    }
  }

  clearByPluginId(pluginId: string): void {
    let changed = false
    for (const [key, action] of this.resourceEditActions) {
      if (action.pluginId === pluginId) {
        this.resourceEditActions.delete(key)
        changed = true
      }
    }
    for (const [key, page] of this.settingsPages) {
      if (page.pluginId === pluginId) {
        this.settingsPages.delete(key)
        changed = true
      }
    }
    if (changed) this.notifyUpdated(pluginId)
  }
}

const pluginContributionManager = new PluginContributionManager()
export default pluginContributionManager
