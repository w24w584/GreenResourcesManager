import { describe, expect, it } from 'vitest'
import { Game } from '../configs/resources/game'
import { Other } from '../configs/resources/other'

describe('resource category fields', () => {
  it('keeps the existing category field on Other resources', () => {
    const resource = new Other()
    resource.category.value = 'Adventure'

    expect(resource.getSaveData()).toMatchObject({
      category: 'Adventure',
    })
  })

  it('does not add generic AI metadata fields to other resource types', () => {
    const game = new Game()
    expect(game).not.toHaveProperty('category')
    expect(game).not.toHaveProperty('sourceInfo')
    expect(game).not.toHaveProperty('publishDate')
  })
})