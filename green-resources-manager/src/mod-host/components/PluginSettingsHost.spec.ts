import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PluginSettingsHost from './PluginSettingsHost.vue'

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('PluginSettingsHost', () => {
  it('mounts the page content and calls onUnmount with the previously mounted page', async () => {
    const onMount = vi.fn()
    const onUnmount = vi.fn()
    const wrapper = mount(PluginSettingsHost, {
      props: {
        page: {
          id: 'ai',
          pluginId: 'ai-assistant',
          name: 'AI 设置',
          content: '<section>first</section>',
          onMount,
          onUnmount
        }
      }
    })
    await flush()

    const container = wrapper.find('.plugin-settings-host').element as HTMLElement
    expect(container.innerHTML).toBe('<section>first</section>')
    expect(onMount).toHaveBeenCalledWith(container)

    await wrapper.setProps({
      page: { id: 'other', pluginId: 'ai-assistant', name: 'Other', content: '<section>second</section>' }
    })
    await flush()

    expect(onUnmount).toHaveBeenCalledWith(container)
    expect(container.innerHTML).toBe('<section>second</section>')

    await wrapper.setProps({ page: null })
    await flush()
    expect(container.innerHTML).toBe('')
    wrapper.unmount()
  })
})
