/**
 * 插件宿主扩展层
 *
 * 目标：把「我们自己的功能」和「上游原项目代码」隔离开。
 * 上游代码里只保留一处：PluginManager 调用 createHostApi / destroyHostApi。
 * 其余的 UI、配置、密钥、网络能力都在这里实现，新增功能不需要再改上游文件。
 */

import { createPluginAPI } from '../utils/PluginAPI'
import pluginContributions, {
  type PluginResourceEditAction,
  type PluginSettingsPage
} from './PluginContributions'

export interface PluginConfigSnapshot {
  config: Record<string, unknown>
  credentials: Record<string, boolean>
}

export interface PluginRequestOptions {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  credentialKey?: string
  credentialPrefix?: string
  /** 允许访问本机回环地址（仅 http(s)://127.0.0.1、localhost、[::1]），供本地模型使用 */
  allowLocal?: boolean
}

export interface PluginCustomModalConfig {
  title: string
  content: string
  /** sm | md | lg，默认 md */
  size?: 'sm' | 'md' | 'lg'
  onMount?: (container: HTMLElement) => void
  onClose?: () => void
}

/** 插件拿到的 API 对象。保留上游已有字段，并追加宿主通用能力。 */
export interface HostPluginApi {
  pluginId: string
  ui: {
    showNotification: (title: string, type?: string, options?: any) => void
    showCustomView: (config: { title: string; content: string; onMount?: (container: HTMLElement) => void }) => void
    closeCustomView: () => void
    showCustomModal: (config: PluginCustomModalConfig) => void
    closeCustomModal: () => void
  }
  storage: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<void>
    remove: (key: string) => Promise<void>
  }
  navigation: {
    register: (config: any) => void
    unregister: (id: string) => void
  }
  resources: {
    registerEditAction: (config: Omit<PluginResourceEditAction, 'pluginId'>) => void
    unregisterEditAction: (id: string) => void
  }
  settings: {
    registerPage: (config: Omit<PluginSettingsPage, 'pluginId'>) => void
    unregisterPage: (id: string) => void
  }
  config: {
    get: () => Promise<PluginConfigSnapshot>
    set: (config: Record<string, unknown>, credentials?: Record<string, string | null>) => Promise<PluginConfigSnapshot>
    reset: () => Promise<PluginConfigSnapshot>
  }
  secrets: {
    has: (key: string) => Promise<boolean>
    set: (key: string, value: string) => Promise<void>
    remove: (key: string) => Promise<void>
  }
  net: {
    request: (options: PluginRequestOptions) => Promise<{ status: number; ok: boolean; headers: Record<string, string>; body: string }>
  }
  i18n: {
    /** 当前界面语言，例如 zh-CN / en / ja */
    getLocale: () => string
    /** 语言切换回调，返回取消监听的函数 */
    onChange: (listener: (locale: string) => void) => () => void
  }
}

const capabilityTokens = new Map<string, string>()

const CREDENTIAL_KEY_PATTERN = /^[a-z][a-zA-Z0-9-]{0,63}$/

function getElectronBridge(): any {
  const bridge = (window as any).electronAPI
  if (!bridge) throw new Error('插件宿主能力在当前环境不可用（仅 Electron 桌面版支持）')
  return bridge
}

function createCapabilityToken(): string {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function ensureCapabilityToken(pluginId: string): Promise<string> {
  const existing = capabilityTokens.get(pluginId)
  if (existing) return existing
  const bridge = getElectronBridge()
  if (typeof bridge.pluginCapabilityBind !== 'function') {
    throw new Error('插件宿主能力未注册，请确认应用版本')
  }
  const token = createCapabilityToken()
  const result = await bridge.pluginCapabilityBind(pluginId, token)
  if (!result?.ok) throw new Error('插件宿主能力绑定失败')
  capabilityTokens.set(pluginId, token)
  return token
}

function requireCredentialKey(key: string): string {
  if (!CREDENTIAL_KEY_PATTERN.test(key)) throw new Error(`无效的凭据编号: ${key}`)
  return key
}

function eventDetail(detail: Record<string, unknown>) {
  return { detail }
}

/**
 * 为插件创建 API 实例。任何一步失败都抛错，PluginManager 会把插件标记为加载失败。
 */
export async function createHostApi(pluginId: string): Promise<HostPluginApi> {
  const base: any = createPluginAPI(pluginId)
  const bridge = getElectronBridge()
  const token = await ensureCapabilityToken(pluginId)

  const call = async (method: string, ...args: unknown[]) => {
    const fn = bridge[method]
    if (typeof fn !== 'function') throw new Error(`宿主能力 ${method} 不可用`)
    return fn.call(bridge, pluginId, token, ...args)
  }

  const api: HostPluginApi = {
    pluginId,
    ui: {
      ...base.ui,
      closeCustomView: () => {
        window.dispatchEvent(new CustomEvent('plugin-close-custom-view', eventDetail({ pluginId })))
      },
      showCustomModal: (config) => {
        window.dispatchEvent(new CustomEvent('plugin-show-custom-modal', eventDetail({
          pluginId,
          title: config.title,
          content: config.content,
          size: config.size || 'md',
          onMount: config.onMount,
          onClose: config.onClose
        })))
      },
      closeCustomModal: () => {
        window.dispatchEvent(new CustomEvent('plugin-close-custom-modal', eventDetail({ pluginId })))
      }
    },
    storage: base.storage,
    navigation: base.navigation,
    resources: {
      registerEditAction: (config) => pluginContributions.registerResourceEditAction({ ...config, pluginId }),
      unregisterEditAction: (id) => pluginContributions.unregisterResourceEditAction(pluginId, id)
    },
    settings: {
      registerPage: (config) => pluginContributions.registerSettingsPage({ ...config, pluginId }),
      unregisterPage: (id) => pluginContributions.unregisterSettingsPage(pluginId, id)
    },
    config: {
      get: async () => await call('pluginConfigGet') as PluginConfigSnapshot,
      set: async (config, credentials = {}) => {
        const result = await call('pluginConfigSave', config, credentials)
        if (!result?.ok) throw new Error(result?.error || '保存插件配置失败')
        return { config: result.config || {}, credentials: result.credentials || {} }
      },
      reset: async () => await call('pluginConfigReset') as PluginConfigSnapshot
    },
    secrets: {
      has: async (key) => {
        requireCredentialKey(key)
        const snapshot = await api.config.get()
        return Boolean(snapshot.credentials[key])
      },
      set: async (key, value) => {
        requireCredentialKey(key)
        await api.config.set({}, { [key]: value })
      },
      remove: async (key) => {
        requireCredentialKey(key)
        await api.config.set({}, { [key]: null })
      }
    },
    net: {
      request: async (options) => await call('pluginRequest', options)
    },
    i18n: {
      getLocale: () => {
        try {
          return localStorage.getItem('app-language') || 'zh-CN'
        } catch {
          return 'zh-CN'
        }
      },
      onChange: (listener) => {
        const handler = (event: Event) => {
          const locale = (event as CustomEvent).detail?.locale
          listener(typeof locale === 'string' && locale ? locale : api.i18n.getLocale())
        }
        window.addEventListener('app-language-changed', handler)
        return () => window.removeEventListener('app-language-changed', handler)
      }
    }
  }

  return api
}

/**
 * 插件卸载 / 加载失败时调用：清理它注册的 UI 贡献，并回收宿主能力令牌。
 */
export async function destroyHostApi(pluginId: string): Promise<void> {
  pluginContributions.clearByPluginId(pluginId)
  const token = capabilityTokens.get(pluginId)
  capabilityTokens.delete(pluginId)
  if (!token) return
  try {
    const bridge = (window as any).electronAPI
    await bridge?.pluginCapabilityRevoke?.(pluginId, token)
  } catch (error) {
    console.warn(`回收插件 ${pluginId} 的宿主能力失败:`, error)
  }
}

/** 设置页 / 编辑窗判断宿主是否可用（用于在浏览器里跑 dev server 时降级） */
export function isPluginHostAvailable(): boolean {
  return Boolean((window as any).electronAPI?.pluginCapabilityBind)
}
