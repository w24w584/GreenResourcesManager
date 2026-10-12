<template>
  <section class="ai-settings">
    <p class="privacy-note">AI 配置仅保存在此电脑的本地安全存储中，不会上传到 GreenResourcesManager 服务器。</p>

    <label class="ai-setting-field">
      <span>AI 服务商</span>
      <select v-model="draft.provider" @change="applyProviderDefaults">
        <option value="doubao">豆包 API</option>
        <option value="deepseek">DeepSeek API</option>
        <option value="custom">自定义 OpenAI 兼容接口</option>
      </select>
    </label>

    <label class="ai-setting-field">
      <span>API 密钥</span>
      <input
        v-model="draft.apiKey"
        type="password"
        autocomplete="new-password"
        placeholder="留空则保留已保存的密钥"
      >
      <small>{{ hasApiKey ? '密钥已保存在本机；输入新密钥可替换。' : '尚未配置密钥。' }}</small>
    </label>

    <label class="ai-setting-field">
      <span>模型名称</span>
      <input v-model.trim="draft.model" type="text" placeholder="请输入模型名称">
    </label>

    <label class="ai-setting-field">
      <span>API 地址</span>
      <input v-model.trim="draft.baseUrl" type="url" placeholder="https://...">
    </label>

    <div class="ai-settings-actions">
      <button type="button" class="ai-secondary-button" :disabled="busy" @click="testConnection">
        {{ testing ? '正在测试…' : '测试连接' }}
      </button>
      <span class="ai-status" :class="statusType" role="status">{{ statusMessage }}</span>
      <span class="ai-actions-spacer"></span>
      <button type="button" class="ai-secondary-button" :disabled="busy" @click="resetConfig">重置</button>
      <button type="button" class="ai-primary-button" :disabled="busy" @click="saveConfig">
        {{ saving ? '正在保存…' : '保存' }}
      </button>
    </div>
  </section>
</template>

<script lang="ts">
const providerDefaults = {
  doubao: { model: 'doubao-seed-1-6-251015', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  deepseek: { model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' },
  custom: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' }
}

export default {
  name: 'AISettings',
  data() {
    return {
      draft: { provider: 'doubao', model: providerDefaults.doubao.model, baseUrl: providerDefaults.doubao.baseUrl, apiKey: '' },
      hasApiKey: false,
      testing: false,
      saving: false,
      statusMessage: '',
      statusType: ''
    }
  },
  computed: {
    busy() {
      return this.testing || this.saving
    }
  },
  async mounted() {
    await this.loadConfig()
  },
  methods: {
    async loadConfig() {
      if (!window.electronAPI?.aiGetConfig) {
        this.statusMessage = 'AI 设置仅在 Electron 桌面版中可用。'
        this.statusType = 'error'
        return
      }
      try {
        const config = await window.electronAPI.aiGetConfig()
        this.draft.provider = config.provider || 'doubao'
        this.draft.model = config.model || providerDefaults[this.draft.provider].model
        this.draft.baseUrl = config.baseUrl || providerDefaults[this.draft.provider].baseUrl
        this.hasApiKey = config.hasApiKey
      } catch (error: any) {
        this.setStatus(error.message || '读取 AI 配置失败', 'error')
      }
    },
    applyProviderDefaults() {
      const defaults = providerDefaults[this.draft.provider] || providerDefaults.custom
      this.draft.model = defaults.model
      this.draft.baseUrl = defaults.baseUrl
    },
    async testConnection() {
      if (!this.draft.apiKey && !this.hasApiKey) {
        this.setStatus('请先填写 API 密钥。', 'error')
        return
      }
      this.testing = true
      this.setStatus('', '')
      try {
        const result = await window.electronAPI.aiTestConnection({ ...this.draft })
        this.setStatus(result.ok ? result.message : result.error, result.ok ? 'success' : 'error')
      } catch (error: any) {
        this.setStatus(error.message || '测试连接失败', 'error')
      } finally {
        this.testing = false
      }
    },
    async saveConfig() {
      if (!this.draft.apiKey && !this.hasApiKey) {
        this.setStatus('请填写 API 密钥后再保存。', 'error')
        return
      }
      this.saving = true
      this.setStatus('', '')
      try {
        const result = await window.electronAPI.aiSaveConfig({ ...this.draft })
        if (!result.ok) throw new Error(result.error)
        this.hasApiKey = result.config.hasApiKey
        this.draft.apiKey = ''
        this.setStatus('AI 配置已安全保存在本机。', 'success')
      } catch (error: any) {
        this.setStatus(error.message || '保存 AI 配置失败', 'error')
      } finally {
        this.saving = false
      }
    },
    async resetConfig() {
      if (!window.confirm('确定要重置 AI 配置并删除本机保存的 API 密钥吗？')) return
      this.saving = true
      this.setStatus('', '')
      try {
        const result = await window.electronAPI.aiResetConfig()
        this.draft.provider = result.config.provider
        this.draft.model = result.config.model
        this.draft.baseUrl = result.config.baseUrl
        this.draft.apiKey = ''
        this.hasApiKey = false
        this.setStatus('AI 配置已重置。', 'success')
      } catch (error: any) {
        this.setStatus(error.message || '重置 AI 配置失败', 'error')
      } finally {
        this.saving = false
      }
    },
    setStatus(message: string, type: string) {
      this.statusMessage = message
      this.statusType = type
    }
  }
}
</script>

<style scoped>
.ai-settings { max-width: 900px; }
.privacy-note { margin: 0 0 20px; padding: 12px 14px; border-left: 3px solid var(--primary-color, #4d8b66); background: var(--bg-tertiary, rgba(80, 120, 90, .08)); color: var(--text-secondary); }
.ai-setting-field { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 8px 16px; align-items: center; margin-bottom: 18px; color: var(--text-primary); }
.ai-setting-field > span { font-weight: 600; }
.ai-setting-field input, .ai-setting-field select { min-width: 0; width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-primary); color: var(--text-primary); }
.ai-setting-field small { grid-column: 2; color: var(--text-secondary); }
.ai-settings-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding-top: 8px; }
.ai-actions-spacer { flex: 1; }
.ai-settings-actions button { min-height: 38px; padding: 0 14px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; }
.ai-settings-actions .ai-primary-button { border-color: var(--primary-color, #4d8b66); background: var(--primary-color, #4d8b66); color: #fff; }
.ai-settings-actions button:disabled { opacity: .55; cursor: wait; }
.ai-status { flex: 1 1 240px; }
.ai-status.error { color: var(--color-danger, #c0392b); }
.ai-status.success { color: var(--color-success, #218653); }
@media (max-width: 600px) {
  .ai-setting-field { grid-template-columns: 1fr; }
  .ai-setting-field small { grid-column: 1; }
  .ai-actions-spacer { display: none; }
}
</style>