import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ResourcesEditDialog from '../components/ResourcesEditDialog.vue'
import { Game } from '../configs/resources/game'
import { Software } from '../configs/resources/soft'

describe('ResourcesEditDialog', () => {
  it('prefills AI search with the current resource name and description', () => {
    const wrapper = mount(ResourcesEditDialog, {
      props: { visible: false, resourceClass: Game }
    })
    const vm = wrapper.vm as any
    vm.formData.name = 'Example game'
    vm.formData.description = 'Existing description'

    vm.openAiSearch()

    expect(vm.aiQuery).toBe('Example game\n\nExisting description')
    wrapper.unmount()
  })

  it('uses only the selected executable name when no metadata has been entered', () => {
    const wrapper = mount(ResourcesEditDialog, {
      props: { visible: false, resourceClass: Software }
    })
    const vm = wrapper.vm as any
    vm.formData.resourcePath = 'C:\\Apps\\OpenSourceTool.exe'

    vm.openAiSearch()

    expect(vm.aiQuery).toBe('OpenSourceTool')
    expect(vm.aiQuery).not.toContain('可执行文件')
    wrapper.unmount()
  })

  it('loads the executable icon into the cover field when selecting an exe', async () => {
    const previousElectronApi = (window as any).electronAPI
    const iconDataUrl = 'data:image/png;base64,aWNvbg=='
    ;(window as any).electronAPI = {
      selectFileWithExtensions: vi.fn().mockResolvedValue('C:\\Apps\\OpenSourceTool.exe'),
      getFileIcon: vi.fn().mockResolvedValue({ success: true, icon: iconDataUrl })
    }
    const wrapper = mount(ResourcesEditDialog, {
      props: { visible: false, resourceClass: Software, isElectronEnvironment: true }
    })
    const vm = wrapper.vm as any

    await vm.handleBrowseFile('resourcePath', vm.formFields.resourcePath)

    expect((window as any).electronAPI.getFileIcon).toHaveBeenCalledWith('C:\\Apps\\OpenSourceTool.exe', 64)
    expect(vm.formData.coverPath).toBe(iconDataUrl)
    wrapper.unmount()
    if (previousElectronApi === undefined) delete (window as any).electronAPI
    else (window as any).electronAPI = previousElectronApi
  })

  it('uses the executable icon as cover when saving without a cover', async () => {
    const previousElectronApi = (window as any).electronAPI
    const iconDataUrl = 'data:image/png;base64,aWNvbg=='
    const getFileIcon = vi.fn().mockResolvedValue({ success: true, icon: iconDataUrl })
    ;(window as any).electronAPI = { getFileIcon }
    const wrapper = mount(ResourcesEditDialog, {
      props: { visible: false, resourceClass: Game, isElectronEnvironment: true }
    })
    const vm = wrapper.vm as any
    vm.formData.name = 'Example game'
    vm.formData.resourcePath = 'C:\\Games\\example.exe'
    vm.formData.coverPath = ''

    await vm.handleConfirm()

    expect(getFileIcon).toHaveBeenCalledWith('C:\\Games\\example.exe', 64)
    expect(wrapper.emitted('confirm')?.[0][0]).toMatchObject({ coverPath: iconDataUrl })
    wrapper.unmount()
    if (previousElectronApi === undefined) delete (window as any).electronAPI
    else (window as any).electronAPI = previousElectronApi
  })
})