<template>
  <div ref="container" class="plugin-settings-host"></div>
</template>

<script lang="ts">
/**
 * 插件设置页宿主。
 *
 * SettingsView 只负责选择分类；这个组件负责把插件 HTML 挂进来，并在
 * 切换分类 / 语言 / 卸载插件时调用 onUnmount，避免监听器和计时器泄漏。
 */
import type { PluginSettingsPage } from '../PluginContributions'

export default {
  name: 'PluginSettingsHost',
  props: {
    page: {
      type: Object as () => PluginSettingsPage | null | undefined,
      default: null
    }
  },
  data() {
    return {
      mountedSignature: '',
      mountedPage: null as PluginSettingsPage | null
    }
  },
  computed: {
    signature(): string {
      const page = this.page
      if (!page) return ''
      return `${page.pluginId}:${page.id}:${page.content}`
    }
  },
  watch: {
    signature: {
      immediate: true,
      handler() {
        this.$nextTick(() => this.syncPage())
      }
    }
  },
  beforeUnmount() {
    this.unmountCurrentPage()
  },
  methods: {
    async syncPage() {
      const container = this.$refs.container as HTMLElement | undefined
      if (!container) return
      if (this.signature === this.mountedSignature) return
      this.unmountCurrentPage()

      const page = this.page
      if (!page) {
        container.innerHTML = ''
        return
      }

      this.mountedSignature = this.signature
      this.mountedPage = page
      container.innerHTML = page.content
      if (!page.onMount) return
      try {
        await page.onMount(container)
      } catch (error) {
        console.error(`[插件 ${page.pluginId}] 设置页 onMount 失败:`, error)
      }
    },
    unmountCurrentPage() {
      const container = this.$refs.container as HTMLElement | undefined
      const page = this.mountedPage
      if (this.mountedSignature && page?.onUnmount && container) {
        try {
          page.onUnmount(container)
        } catch (error) {
          console.error(`[插件 ${page.pluginId}] 设置页 onUnmount 失败:`, error)
        }
      }
      this.mountedSignature = ''
      this.mountedPage = null
    }
  }
}
</script>

<style scoped>
.plugin-settings-host {
  display: block;
}
</style>
