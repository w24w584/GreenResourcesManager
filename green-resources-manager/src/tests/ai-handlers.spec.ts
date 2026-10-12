import { afterEach, describe, expect, it } from 'vitest'
import aiHandlersModule from '../../electron/ipc/ai-handlers.js'
import { Other } from '../configs/resources/other'

const { createAiHandlers, parseResourceInfo, parseSearchResults } = aiHandlersModule as any
const temporaryDirectories: string[] = []

afterEach(async () => {
  const fs = await import('node:fs')
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('AI handler parsing', () => {
  it('parses web search RSS results and XML entities', () => {
    const results = parseSearchResults('<rss><channel><item><title><![CDATA[Game &amp; Story]]></title><link>https://example.com</link><description>Short &amp; useful</description></item></channel></rss>')

    expect(results).toEqual([{ title: 'Game & Story', url: 'https://example.com', summary: 'Short & useful' }])
  })

  it('normalizes resource fields and rejects malformed JSON', () => {
    expect(parseResourceInfo('```json\n{"title":"Example","tags":"RPG, Indie"}\n```')).toEqual({
      title: 'Example', summary: '', category: '', tags: ['RPG', 'Indie'], source: '', publishDate: ''
    })
    expect(() => parseResourceInfo('not json')).toThrow('AI 返回信息解析失败')
  })

  it('exposes and serializes the metadata fields on every resource type', () => {
    const resource = new Other()
    resource.category.value = 'Adventure'
    resource.sourceInfo.value = 'https://example.com'
    resource.publishDate.value = '2024-01-02'

    expect(resource.getSaveData()).toMatchObject({
      category: 'Adventure',
      sourceInfo: 'https://example.com',
      publishDate: '2024-01-02'
    })
  })

  it('keeps saved credentials out of config reads while using them for backend requests', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grm-ai-test-'))
    temporaryDirectories.push(userData)
    const requests: any[] = []
    const fetchStub = async (url: string, options: any = {}) => {
      requests.push({ url, options })
      if (url.includes('bing.com')) {
        return {
          ok: true,
          text: async () => '<rss><channel><item><title>Example source</title><link>https://example.com</link><description>Verified metadata</description></item></channel></rss>'
        }
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"title":"Example","summary":"Summary","tags":["indie"]}' } }] })
      }
    }
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString()
    }
    const handlers = createAiHandlers({ getPath: () => userData }, safeStorage, fetchStub)

    const saved = handlers.saveConfig({ provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com', apiKey: 'local-secret' })
    expect(saved).not.toHaveProperty('apiKey')
    expect(handlers.getConfig().hasApiKey).toBe(true)

    const result = await handlers.generateResourceInfo('Example')
    expect(result).toMatchObject({ ok: true, data: { title: 'Example', tags: ['indie'] } })
    expect(requests).toHaveLength(2)
    expect(requests[1].options.headers.Authorization).toBe('Bearer local-secret')
  })
})