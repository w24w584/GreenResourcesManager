import { describe, expect, it } from 'vitest'
import { extractPeIconBuffer } from '../../electron/utils/pe-icon-extractor.js'

function makePeWithNamedIconResource(iconData: Buffer, secondIconData?: Buffer) {
  const buffer = Buffer.alloc(secondIconData ? 0x600 : 0x500)
  buffer.write('MZ', 0, 'ascii')
  buffer.writeUInt32LE(0x80, 0x3c)
  buffer.write('PE\0\0', 0x80, 'ascii')
  buffer.writeUInt16LE(1, 0x86)
  buffer.writeUInt16LE(0xf0, 0x94)
  const optionalOffset = 0x98
  buffer.writeUInt16LE(0x20b, optionalOffset)
  buffer.writeUInt32LE(0x1000, optionalOffset + 112 + 16)
  const sectionOffset = optionalOffset + 0xf0
  buffer.writeUInt32LE(0x400, sectionOffset + 8)
  buffer.writeUInt32LE(0x1000, sectionOffset + 12)
  buffer.writeUInt32LE(0x400, sectionOffset + 16)
  buffer.writeUInt32LE(0x200, sectionOffset + 20)

  const resourceOffset = 0x200
  buffer.writeUInt16LE(1, resourceOffset + 12)
  buffer.writeUInt32LE(0x80000080, resourceOffset + 16)
  buffer.writeUInt32LE(0x80000020, resourceOffset + 20)
  buffer.writeUInt16LE(secondIconData ? 2 : 1, resourceOffset + 0x20 + 14)
  buffer.writeUInt32LE(7, resourceOffset + 0x20 + 16)
  buffer.writeUInt32LE(0x80000040, resourceOffset + 0x20 + 20)
  buffer.writeUInt16LE(1, resourceOffset + 0x40 + 14)
  buffer.writeUInt32LE(1033, resourceOffset + 0x40 + 16)
  buffer.writeUInt32LE(0x60, resourceOffset + 0x40 + 20)
  buffer.writeUInt32LE(0x1200, resourceOffset + 0x60)
  buffer.writeUInt32LE(iconData.length, resourceOffset + 0x64)
  buffer.writeUInt16LE(4, resourceOffset + 0x80)
  buffer.write('ICON', resourceOffset + 0x82, 'utf16le')
  iconData.copy(buffer, 0x400)
  if (secondIconData) {
    buffer.writeUInt32LE(8, resourceOffset + 0x38)
    buffer.writeUInt32LE(0x800000a0, resourceOffset + 0x3c)
    buffer.writeUInt16LE(1, resourceOffset + 0xa0 + 14)
    buffer.writeUInt32LE(1033, resourceOffset + 0xb0)
    buffer.writeUInt32LE(0xc0, resourceOffset + 0xb4)
    buffer.writeUInt32LE(0x1300, resourceOffset + 0xc0)
    buffer.writeUInt32LE(secondIconData.length, resourceOffset + 0xc4)
    secondIconData.copy(buffer, 0x500)
  }
  return buffer
}

function makeSingleFrameIco(width: number) {
  const ico = Buffer.alloc(23)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico[6] = width === 256 ? 0 : width
  ico[7] = width === 256 ? 0 : width
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(1, 14)
  ico.writeUInt32LE(22, 18)
  ico[22] = width
  return ico
}

describe('extractPeIconBuffer', () => {
  it('reads a named ICON resource and keeps the highest-resolution ICO frame', () => {
    const multiFrameIco = Buffer.alloc(6 + 2 * 16 + 2)
    multiFrameIco.writeUInt16LE(1, 2)
    multiFrameIco.writeUInt16LE(2, 4)
    multiFrameIco[6] = 16
    multiFrameIco[7] = 16
    multiFrameIco.writeUInt16LE(32, 12)
    multiFrameIco.writeUInt32LE(1, 14)
    multiFrameIco.writeUInt32LE(38, 18)
    multiFrameIco[22] = 64
    multiFrameIco[23] = 64
    multiFrameIco.writeUInt16LE(32, 28)
    multiFrameIco.writeUInt32LE(1, 30)
    multiFrameIco.writeUInt32LE(39, 34)
    multiFrameIco[38] = 1
    multiFrameIco[39] = 2
    const result = extractPeIconBuffer(makePeWithNamedIconResource(multiFrameIco))

    expect(result?.readUInt16LE(4)).toBe(1)
    expect(result?.[6]).toBe(64)
    expect(result?.[7]).toBe(64)
    expect(result?.[22]).toBe(2)
  })

  it('chooses the clearest icon across multiple named ICON resources', () => {
    const result = extractPeIconBuffer(makePeWithNamedIconResource(
      makeSingleFrameIco(16),
      makeSingleFrameIco(64)
    ))

    expect(result?.[6]).toBe(64)
    expect(result?.[7]).toBe(64)
  })
})