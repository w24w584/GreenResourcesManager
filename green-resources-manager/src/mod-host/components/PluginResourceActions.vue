<template>
  <div v-if="visibleActions.length" class="plugin-edit-actions">
    <button
      v-for="action in visibleActions"
      :key="`${action.pluginId}:${action.id}`"
      type="button"
      class="plugin-edit-action"
      :disabled="runningActionKey === `${action.pluginId}:${action.id}`"
      :title="action.label"
      @click="runAction(action)"
    >
      <span v-if="action.icon" class="plugin-action-icon">{{ action.icon }}</span>
      <span class="plugin-action-label">{{ action.label }}</span>
    </button>
  </div>
</template>

<script lang="ts">
/**
 * 资源编辑窗里的插件动作条。
 *
 * 上游 ResourcesEditDialog 只引用这一个组件；按钮渲染、上下文构造、
 * 生命周期监听都在这里，避免我们的逻辑散落到上游文件里。
 */
import pluginContributions, {
  PLUGIN_CONTRIBUTIONS_UPDATED,
  type PluginResourceEditAction,
  type PluginResourceEditContext,
  type PluginResourceField
} from '../PluginContributions'

export default {
  name: 'PluginResourceActions',
  props: {
    formData: {
      type: Object,
      default: () => ({})
    },
    formFields: {
      type: Object,
      default: () => ({})
    },
    resourceName: {
      type: String,
      default: ''
    }
  },
  emits: ['apply'],
  data() {
    return {
      actions: [] as PluginResourceEditAction[],
      runningActionKey: '',
      contributionsListener: null as (() => void) | null
    }
  },
  computed: {
    fields(): PluginResourceField[] {
      return Object.entries(this.formFields as Record<string, any>).map(([key, field]) => {
        const described: PluginResourceField = {
          key,
          label: field?.fieldName || key,
          type: field?.constructor?.name || 'FormField',
          required: field?.required !== false
        }
        const options = (field as any)?.options
        if (Array.isArray(options) && options.length && options.every((option: unknown) => typeof option === 'string')) {
          described.options = [...options]
        }
        return described
      })
    },
    baseContext(): Pick<PluginResourceEditContext, 'resourceName' | 'formData' | 'fields'> {
      return {
        resourceName: this.resourceName,
        formData: { ...(this.formData as Record<string, unknown>) },
        fields: this.fields
      }
    },
    visibleActions(): PluginResourceEditAction[] {
      return this.actions.filter((action) => {
        if (typeof action.when !== 'function') return true
        try {
          return Boolean(action.when(this.baseContext))
        } catch (error) {
          console.error(`[插件 ${action.pluginId}] 判断编辑动作 ${action.id} 是否显示失败:`, error)
          return false
        }
      })
    }
  },
  created() {
    this.contributionsListener = () => this.refreshActions()
    window.addEventListener(PLUGIN_CONTRIBUTIONS_UPDATED, this.contributionsListener)
    this.refreshActions()
  },
  beforeUnmount() {
    if (this.contributionsListener) {
      window.removeEventListener(PLUGIN_CONTRIBUTIONS_UPDATED, this.contributionsListener)
      this.contributionsListener = null
    }
  },
  methods: {
    refreshActions() {
      this.actions = pluginContributions.getResourceEditActions()
    },
    async runAction(action: PluginResourceEditAction) {
      const key = `${action.pluginId}:${action.id}`
      if (this.runningActionKey) return
      this.runningActionKey = key
      const context: PluginResourceEditContext = {
        ...this.baseContext,
        apply: (patch: Record<string, unknown>) => {
          const safePatch: Record<string, unknown> = {}
          for (const [fieldKey, value] of Object.entries(patch || {})) {
            if (Object.prototype.hasOwnProperty.call(this.formFields, fieldKey)) {
              safePatch[fieldKey] = value
            }
          }
          if (Object.keys(safePatch).length) this.$emit('apply', safePatch)
        }
      }
      try {
        await action.onClick(context)
      } catch (error: any) {
        console.error(`[插件 ${action.pluginId}] 编辑动作 ${action.id} 执行失败:`, error)
        window.dispatchEvent(new CustomEvent('plugin-action-error', {
          detail: { pluginId: action.pluginId, actionId: action.id, error }
        }))
      } finally {
        this.runningActionKey = ''
      }
    }
  }
}
</script>

<style scoped>
.plugin-edit-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 16px;
}

.plugin-edit-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color .2s ease, background .2s ease;
}

.plugin-edit-action:hover:not(:disabled) {
  border-color: var(--accent-color);
  background: var(--bg-secondary);
}

.plugin-edit-action:disabled {
  opacity: .6;
  cursor: progress;
}

.plugin-action-icon {
  font-weight: 700;
  color: var(--accent-color);
}
</style>
