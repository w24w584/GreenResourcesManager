import { afterEach, describe, expect, it } from 'vitest'
import pluginContributions from './PluginContributions'

describe('PluginContributions', () => {
  afterEach(() => {
    pluginContributions.clearByPluginId('test-plugin')
    pluginContributions.clearByPluginId('other-plugin')
  })

  it('sorts actions by order and filters them per plugin', () => {
    pluginContributions.registerResourceEditAction({
      id: 'later',
      pluginId: 'test-plugin',
      label: 'Later',
      order: 20,
      onClick: () => {}
    })
    pluginContributions.registerResourceEditAction({
      id: 'earlier',
      pluginId: 'test-plugin',
      label: 'Earlier',
      order: 10,
      onClick: () => {}
    })
    pluginContributions.registerResourceEditAction({
      id: 'other',
      pluginId: 'other-plugin',
      label: 'Other',
      onClick: () => {}
    })

    const actions = pluginContributions.getResourceEditActions()
    expect(actions.map((action) => action.id)).toEqual(['earlier', 'later', 'other'])
  })

  it('removes every contribution belonging to a plugin', () => {
    pluginContributions.registerSettingsPage({
      id: 'page',
      pluginId: 'test-plugin',
      name: 'Page',
      content: ''
    })
    pluginContributions.registerResourceEditAction({
      id: 'action',
      pluginId: 'test-plugin',
      label: 'Action',
      onClick: () => {}
    })

    pluginContributions.clearByPluginId('test-plugin')

    expect(pluginContributions.getSettingsPages()).toHaveLength(0)
    expect(pluginContributions.getResourceEditActions()).toHaveLength(0)
  })
})
