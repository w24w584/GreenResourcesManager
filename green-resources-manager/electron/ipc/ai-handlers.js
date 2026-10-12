const fs = require('fs')
const path = require('path')

const PROVIDER_DEFAULTS = {
  doubao: {
    model: 'doubao-seed-1-6-251015',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
  },
  deepseek: {
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com'
  },
  custom: {
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1'
  }
}

const SEARCH_INTERVAL_MS = 3000
const REQUEST_TIMEOUT_MS = 35000
const SEARCH_TIMEOUT_MS = 10000
let lastSearchAt = 0

function normalizeBaseUrl(value, provider) {
  return String(value || PROVIDER_DEFAULTS[provider]?.baseUrl || PROVIDER_DEFAULTS.custom.baseUrl).trim().replace(/\/+$/, '')
}

function getChatCompletionsUrl(baseUrl) {
  return /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`
}

function classifyError(error, responseStatus) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return '请求超时，请检查网络后重试'
  if (responseStatus === 401 || responseStatus === 403) return 'API 密钥无效或无权访问该模型，请检查 AI 设置'
  if (responseStatus === 402) return '账号额度不足，请检查服务商账户余额'
  if (responseStatus === 429) return '请求过于频繁或账号额度已用完，请稍后重试并检查服务商配额'
  if (responseStatus >= 500) return 'AI 服务暂时不可用，请稍后重试'
  if (error?.cause?.code || error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') return '网络无法连接，请检查网络和 API 地址'
  return error?.message || 'AI 请求失败，请检查配置和网络'
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim()
}

function parseSearchResults(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => {
    const item = match[1]
    const readTag = (tag) => decodeXml(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '')
    return { title: readTag('title'), url: readTag('link'), summary: readTag('description') }
  }).filter((item) => item.title && item.url)
}

function parseResourceInfo(content) {
  const text = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : part?.text || '').join('\n')
    : String(content || '')
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 返回信息解析失败：未找到 JSON 对象')

  let result
  try {
    result = JSON.parse(normalized.slice(start, end + 1))
  } catch {
    throw new Error('AI 返回信息解析失败：JSON 格式不正确')
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('AI 返回信息解析失败：结果不是对象')
  }

  const tags = Array.isArray(result.tags)
    ? result.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : String(result.tags || '').split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean)
  return {
    title: String(result.title || ''),
    summary: String(result.summary || ''),
    category: String(result.category || ''),
    tags,
    source: String(result.source || ''),
    publishDate: String(result.publishDate || '')
  }
}

function createAiHandlers(app, safeStorage, fetchImpl = global.fetch) {
  const configPath = path.join(app.getPath('userData'), 'ai-settings.json')

  function readStoredConfig() {
    try {
      const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const apiKey = stored.encryptedApiKey && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64'))
        : ''
      return { ...stored, apiKey }
    } catch {
      return { provider: 'doubao', ...PROVIDER_DEFAULTS.doubao, apiKey: '' }
    }
  }

  function saveStoredConfig(config) {
    const previous = readStoredConfig()
    const provider = PROVIDER_DEFAULTS[config.provider] ? config.provider : 'doubao'
    const apiKey = String(config.apiKey || previous.apiKey || '').trim()
    if (apiKey && !safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储当前不可用，未保存 API 密钥')
    }

    const stored = {
      provider,
      model: String(config.model || PROVIDER_DEFAULTS[provider].model).trim(),
      baseUrl: normalizeBaseUrl(config.baseUrl, provider),
      encryptedApiKey: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : ''
    }
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(stored, null, 2), { mode: 0o600 })
    return stored
  }

  async function requestCompletion(config, messages, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(getChatCompletionsUrl(normalizeBaseUrl(config.baseUrl, config.provider)), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: config.model, messages, temperature: 0.2 }),
        signal: controller.signal
      })
      if (!response.ok) {
        let detail = ''
        try {
          const body = await response.json()
          detail = body?.error?.message || body?.message || ''
        } catch {}
        throw new Error(detail ? `${classifyError(null, response.status)}：${detail}` : classifyError(null, response.status))
      }
      return await response.json()
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('AI 返回信息解析失败：响应不是有效 JSON')
      throw new Error(classifyError(error))
    } finally {
      clearTimeout(timeout)
    }
  }

  async function searchWeb(query) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)
    try {
      const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': 'GreenResourcesManager/1.0' },
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`联网搜索服务返回 HTTP ${response.status}`)
      const results = parseSearchResults(await response.text())
      if (!results.length) throw new Error('联网搜索没有找到可用资料，请尝试更具体的名称')
      return results
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? '联网搜索超时，请检查网络后重试' : `联网搜索失败：${error.message}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    getConfig() {
      const config = readStoredConfig()
      return {
        provider: config.provider,
        model: config.model || PROVIDER_DEFAULTS[config.provider]?.model,
        baseUrl: normalizeBaseUrl(config.baseUrl, config.provider),
        hasApiKey: Boolean(config.apiKey)
      }
    },
    saveConfig(config) {
      saveStoredConfig(config || {})
      return this.getConfig()
    },
    resetConfig() {
      try { fs.unlinkSync(configPath) } catch {}
      return this.getConfig()
    },
    async testConnection(config) {
      const stored = readStoredConfig()
      const candidate = {
        provider: PROVIDER_DEFAULTS[config?.provider] ? config.provider : stored.provider,
        model: String(config?.model || stored.model || '').trim(),
        baseUrl: normalizeBaseUrl(config?.baseUrl || stored.baseUrl, config?.provider || stored.provider),
        apiKey: String(config?.apiKey || stored.apiKey || '').trim()
      }
      if (!candidate.apiKey) return { ok: false, error: '请先填写 API 密钥' }
      if (!candidate.model) return { ok: false, error: '请填写模型名称' }
      try {
        const response = await requestCompletion(candidate, [{ role: 'user', content: '只回复 OK' }], 15000)
        if (!response?.choices?.[0]?.message) return { ok: false, error: '连接已建立，但 AI 返回格式不符合 OpenAI 兼容接口规范' }
        return { ok: true, message: '连接成功，AI 服务已正常响应' }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },
    async generateResourceInfo(query) {
      const now = Date.now()
      if (now - lastSearchAt < SEARCH_INTERVAL_MS) {
        return { ok: false, error: `检索间隔至少为 3 秒，请等待 ${Math.ceil((SEARCH_INTERVAL_MS - (now - lastSearchAt)) / 1000)} 秒后重试` }
      }
      lastSearchAt = now

      const config = readStoredConfig()
      if (!config.apiKey) return { ok: false, error: '尚未配置 API 密钥，请前往 AI 设置页面填写' }
      if (!config.model) return { ok: false, error: '尚未配置模型名称，请前往 AI 设置页面检查配置' }
      const userQuery = String(query || '').trim().slice(0, 2000)
      if (!userQuery) return { ok: false, error: '请输入资源名称或描述' }

      try {
        const searchResults = await searchWeb(userQuery)
        const messages = [
          {
            role: 'system',
            content: '你是资源元信息整理助手。请仅依据用户描述和联网搜索资料，识别真实资源信息；不确定或资料缺失的字段填写空字符串，标签使用字符串数组。只输出一个合法 JSON 对象，不要输出解释或 Markdown。结构必须为：{"title":"资源标题","summary":"简短简介","category":"资源分类","tags":["标签"],"source":"来源信息或来源网址","publishDate":"发布日期，使用 YYYY-MM-DD 或原始精度"}。'
          },
          {
            role: 'user',
            content: `用户描述：\n${userQuery}\n\n联网搜索结果：\n${JSON.stringify(searchResults, null, 2)}\n\n请根据以上内容核对资料并按指定 JSON 结构返回。`
          }
        ]
        const response = await requestCompletion(config, messages)
        const content = response?.choices?.[0]?.message?.content
        if (!content) return { ok: false, error: 'AI 返回信息解析失败：响应中没有文本内容' }
        return { ok: true, data: parseResourceInfo(content) }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    }
  }
}

function registerIpcHandlers(ipcMain, app, safeStorage) {
  const handlers = createAiHandlers(app, safeStorage)
  ipcMain.handle('ai:get-config', () => handlers.getConfig())
  ipcMain.handle('ai:save-config', (_event, config) => {
    try { return { ok: true, config: handlers.saveConfig(config) } }
    catch (error) { return { ok: false, error: error.message } }
  })
  ipcMain.handle('ai:reset-config', () => ({ ok: true, config: handlers.resetConfig() }))
  ipcMain.handle('ai:test-connection', (_event, config) => handlers.testConnection(config))
  ipcMain.handle('ai:generate-resource-info', (_event, query) => handlers.generateResourceInfo(query))
}

module.exports = { registerIpcHandlers, createAiHandlers, parseResourceInfo, parseSearchResults }