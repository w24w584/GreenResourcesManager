import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PluginModalHost from './PluginModalHost.vue'

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PluginModalHost', () => {
  it('opens from the host event, mounts the content and runs onClose when closed', async () => {
    const onMount = vi.fn()
    const onClose = vi.fn()
    const wrapper = mount(PluginModalHost, { attachTo: document.body })

    window.dispatchEvent(new CustomEvent('plugin-show-custom-modal', {
      detail: {
        pluginId: 'ai-assistant',
        title: 'AI 补全',
        content: '<div class="demo">demo</div>',
        size: 'lg',
        onMount,
        onClose
      }
    }))
    await flush()

    const body = document.querySelector('.plugin-modal-body') as HTMLElement
    expect(body.innerHTML).toBe('<div class="demo">demo</div>')
    expect(onMount).toHaveBeenCalledWith(body)
    expect(document.querySelector('.plugin-modal')?.classList.contains('plugin-modal--lg')).toBe(true)

    window.dispatchEvent(new CustomEvent('plugin-close-custom-modal', { detail: { pluginId: 'ai-assistant' } }))
    await flush()

    expect(document.querySelector('.plugin-modal')).toBeNull()
    expect(onClose).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('ignores close events from another plugin', async () => {
    const onClose = vi.fn()
    const wrapper = mount(PluginModalHost, { attachTo: document.body })

    window.dispatchEvent(new CustomEvent('plugin-show-custom-modal', {
      detail: { pluginId: 'ai-assistant', title: 'AI', content: '<div></div>', onClose }
    }))
    await flush()

    window.dispatchEvent(new CustomEvent('plugin-close-custom-modal', { detail: { pluginId: 'other-plugin' } }))
    await flush()

    expect(document.querySelector('.plugin-modal')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    window.dispatchEvent(new CustomEvent('plugin-close-custom-modal', { detail: { pluginId: 'ai-assistant' } }))
    await flush()
    wrapper.unmount()
  })
})
