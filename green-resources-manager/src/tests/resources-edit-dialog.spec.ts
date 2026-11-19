import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ResourcesEditDialog from '../components/ResourcesEditDialog.vue'
import MediaCard from '../components/MediaCard.vue'
import { Software } from '../configs/resources/soft'
import { Video } from '../configs/resources/video'
import pluginContributionManager from '../mod-host/PluginContributions'

describe('ResourcesEditDialog', () => {
  it('shows the random cover action for video thumbnail fields when enabled', () => {
    const wrapper = mount(ResourcesEditDialog, {
      props: { visible: true, resourceClass: Video, enableRandomizeThumbnail: true },
      global: { mocks: { $lt: (text: string) => text } }
    })

    expect(wrapper.text()).toContain('随机封面')
    wrapper.unmount()
  })

  it('runs registered edit actions and only applies existing form fields', async () => {
    pluginContributionManager.registerResourceEditAction({
      id: 'test-fill',
      pluginId: 'test-plugin',
      label: '测试填充',
      onClick: ({ apply }) => apply({ name: 'Filled game', unknownField: 'ignored' })
    })
    const wrapper = mount(ResourcesEditDialog, {
      props: { visible: true, resourceClass: Software },
      global: { mocks: { $lt: (text: string) => text } }
    })
    const vm = wrapper.vm as any

    expect(wrapper.text()).toContain('测试填充')
    await wrapper.find('.plugin-edit-action').trigger('click')

    expect(vm.formData.name).toBe('Filled game')
    expect(vm.formData.unknownField).toBeUndefined()
    wrapper.unmount()
    pluginContributionManager.clearByPluginId('test-plugin')
  })
})

describe('MediaCard default image', () => {
  it('uses the resource detail panel default image when no cover is available', () => {
    const video = new Video()
    const defaultImage = (MediaCard as any).methods.getDefaultImage.call({ item: video })

    expect(defaultImage).toBe('./default-video.png')
  })
})
