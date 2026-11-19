<template>
  <teleport to="body">
    <div
      v-if="modal.visible"
      class="plugin-modal-overlay"
      @mousedown.self="close('backdrop')"
    >
      <section
        class="plugin-modal"
        :class="`plugin-modal--${modal.size}`"
        role="dialog"
        aria-modal="true"
        :aria-label="modal.title"
        @mousedown.stop
        @keydown.esc.stop.prevent="close('escape')"
      >
        <header class="plugin-modal-header">
          <h3>{{ modal.title }}</h3>
          <button type="button" class="plugin-modal-close" aria-label="关闭" @click="close('button')">✕</button>
        </header>
        <div class="plugin-modal-body" ref="body" v-html="modal.content"></div>
      </section>
    </div>
  </teleport>
</template>

<script lang="ts">
/**
 * 插件通用弹窗宿主。
 *
 * 上游 App.vue 只要挂一个 <PluginModalHost />，弹窗的显示、关闭、
 * onMount / onClose 生命周期都由这里负责，避免每次加插件都改 App.vue。
 */
export default {
  name: 'PluginModalHost',
  data() {
    return {
      modal: {
        visible: false,
        pluginId: '',
        title: '',
        content: '',
        size: 'md' as 'sm' | 'md' | 'lg',
        onMount: null as ((container: HTMLElement) => void) | null,
        onClose: null as (() => void) | null
      },
      onShowListener: null as ((event: Event) => void) | null,
      onCloseListener: null as ((event: Event) => void) | null,
      onKeydownListener: null as ((event: KeyboardEvent) => void) | null
    }
  },
  mounted() {
    this.onShowListener = (event: Event) => this.open((event as CustomEvent).detail || {})
    this.onCloseListener = (event: Event) => {
      const pluginId = (event as CustomEvent).detail?.pluginId
      if (!pluginId || pluginId === this.modal.pluginId) this.close('plugin')
    }
    this.onKeydownListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && this.modal.visible) this.close('escape')
    }
    window.addEventListener('plugin-show-custom-modal', this.onShowListener)
    window.addEventListener('plugin-close-custom-modal', this.onCloseListener)
    window.addEventListener('keydown', this.onKeydownListener)
  },
  beforeUnmount() {
    if (this.onShowListener) window.removeEventListener('plugin-show-custom-modal', this.onShowListener)
    if (this.onCloseListener) window.removeEventListener('plugin-close-custom-modal', this.onCloseListener)
    if (this.onKeydownListener) window.removeEventListener('keydown', this.onKeydownListener)
    this.teardown()
  },
  methods: {
    open(detail: any) {
      if (this.modal.visible) this.close('replaced')
      this.modal.visible = true
      this.modal.pluginId = detail.pluginId || ''
      this.modal.title = detail.title || ''
      this.modal.content = detail.content || ''
      this.modal.size = ['sm', 'lg'].includes(detail.size) ? detail.size : 'md'
      this.modal.onMount = typeof detail.onMount === 'function' ? detail.onMount : null
      this.modal.onClose = typeof detail.onClose === 'function' ? detail.onClose : null
      this.$nextTick(() => this.mountContent())
    },
    mountContent() {
      const body = this.$refs.body as HTMLElement | undefined
      if (!body) return
      body.innerHTML = this.modal.content
      if (!this.modal.onMount) return
      try {
        this.modal.onMount(body)
      } catch (error) {
        console.error('执行插件弹窗 onMount 回调失败:', error)
      }
    },
    close(reason: string) {
      if (!this.modal.visible) return
      const onClose = this.modal.onClose
      this.modal.visible = false
      this.modal.pluginId = ''
      this.modal.title = ''
      this.modal.content = ''
      this.modal.size = 'md'
      this.modal.onMount = null
      this.modal.onClose = null
      const body = this.$refs.body as HTMLElement | undefined
      if (body) body.innerHTML = ''
      if (onClose) {
        try {
          onClose()
        } catch (error) {
          console.error('执行插件弹窗 onClose 回调失败:', error)
        }
      }
      void reason
    },
    teardown() {
      const onClose = this.modal.onClose
      this.modal.visible = false
      this.modal.onMount = null
      this.modal.onClose = null
      if (onClose) {
        try {
          onClose()
        } catch {}
      }
    }
  }
}
</script>

<style>
.plugin-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, .58);
}

.plugin-modal {
  display: flex;
  flex-direction: column;
  width: min(760px, 96vw);
  max-height: 90vh;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .28);
}

.plugin-modal--sm { width: min(520px, 96vw); }
.plugin-modal--lg { width: min(960px, 96vw); }

.plugin-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 0 0 auto;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
}

.plugin-modal-header h3 { margin: 0; font-size: 1.05rem; }

.plugin-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 1.05rem;
  cursor: pointer;
}

.plugin-modal-close:hover {
  border-color: var(--border-color);
  background: var(--bg-tertiary);
}

.plugin-modal-body {
  padding: 18px 20px;
  overflow: auto;
  min-height: 0;
}

@media (max-width: 600px) {
  .plugin-modal-overlay { padding: 10px; }
  .plugin-modal { width: 100%; max-height: 94vh; }
  .plugin-modal-body { padding: 14px; }
}
</style>
