const ICO_SIGNATURE = Buffer.from([0, 0, 1, 0])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readResourceName(buffer, resourceOffset, nameValue) {
  if ((nameValue & 0x80000000) === 0) return { id: nameValue & 0xffff, text: '' }
  const stringOffset = resourceOffset + (nameValue & 0x7fffffff)
  if (stringOffset + 2 > buffer.length) return null
  const length = buffer.readUInt16LE(stringOffset)
  const start = stringOffset + 2
  const end = start + length * 2
  if (end > buffer.length) return null
  return { id: null, text: buffer.toString('utf16le', start, end) }
}

function readDirectoryEntries(buffer, resourceOffset, directoryOffset) {
  const headerOffset = resourceOffset + directoryOffset
  if (headerOffset + 16 > buffer.length) return []
  const namedCount = buffer.readUInt16LE(headerOffset + 12)
  const idCount = buffer.readUInt16LE(headerOffset + 14)
  const count = namedCount + idCount
  const entries = []
  for (let index = 0; index < count; index++) {
    const entryOffset = headerOffset + 16 + index * 8
    if (entryOffset + 8 > buffer.length) break
    entries.push({
      name: readResourceName(buffer, resourceOffset, buffer.readUInt32LE(entryOffset)),
      target: buffer.readUInt32LE(entryOffset + 4)
    })
  }
  return entries
}

function findSectionOffset(buffer, sectionsOffset, sectionCount, optionalHeaderSize, rva) {
  for (let index = 0; index < sectionCount; index++) {
    const sectionOffset = sectionsOffset + optionalHeaderSize + index * 40
    if (sectionOffset + 40 > buffer.length) return null
    const virtualSize = buffer.readUInt32LE(sectionOffset + 8)
    const virtualAddress = buffer.readUInt32LE(sectionOffset + 12)
    const rawSize = buffer.readUInt32LE(sectionOffset + 16)
    const rawOffset = buffer.readUInt32LE(sectionOffset + 20)
    const span = Math.max(virtualSize, rawSize)
    if (rva >= virtualAddress && rva < virtualAddress + span) {
      const offset = rawOffset + rva - virtualAddress
      return offset < rawOffset + rawSize && offset < buffer.length ? offset : null
    }
  }
  return null
}

function readPeResources(buffer) {
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') return null
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 24 > buffer.length || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return null

  const sectionCount = buffer.readUInt16LE(peOffset + 6)
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20)
  const optionalOffset = peOffset + 24
  const magic = buffer.readUInt16LE(optionalOffset)
  const dataDirectoryOffset = magic === 0x20b ? optionalOffset + 112 : magic === 0x10b ? optionalOffset + 96 : 0
  if (!dataDirectoryOffset || dataDirectoryOffset + 24 > buffer.length) return null

  const resourceRva = buffer.readUInt32LE(dataDirectoryOffset + 16)
  if (!resourceRva) return null
  const resourceOffset = findSectionOffset(buffer, peOffset + 24, sectionCount, optionalHeaderSize, resourceRva)
  if (resourceOffset === null) return null

  const rvaToOffset = (rva) => findSectionOffset(buffer, peOffset + 24, sectionCount, optionalHeaderSize, rva)
  const resources = []
  for (const typeEntry of readDirectoryEntries(buffer, resourceOffset, 0)) {
    if (!typeEntry.name || (typeEntry.target & 0x80000000) === 0) continue
    const typeOffset = typeEntry.target & 0x7fffffff
    for (const nameEntry of readDirectoryEntries(buffer, resourceOffset, typeOffset)) {
      if (!nameEntry.name) continue
      if ((nameEntry.target & 0x80000000) !== 0) {
        const languageOffset = nameEntry.target & 0x7fffffff
        for (const languageEntry of readDirectoryEntries(buffer, resourceOffset, languageOffset)) {
          const dataOffset = resourceOffset + (languageEntry.target & 0x7fffffff)
          if ((languageEntry.target & 0x80000000) !== 0 || dataOffset + 16 > buffer.length) continue
          const dataRva = buffer.readUInt32LE(dataOffset)
          const size = buffer.readUInt32LE(dataOffset + 4)
          const fileOffset = rvaToOffset(dataRva)
          if (fileOffset === null || size === 0 || fileOffset + size > buffer.length) continue
          resources.push({
            type: typeEntry.name,
            name: nameEntry.name,
            language: languageEntry.name?.id,
            data: buffer.subarray(fileOffset, fileOffset + size)
          })
        }
      } else {
        const dataOffset = resourceOffset + (nameEntry.target & 0x7fffffff)
        if (dataOffset + 16 > buffer.length) continue
        const dataRva = buffer.readUInt32LE(dataOffset)
        const size = buffer.readUInt32LE(dataOffset + 4)
        const fileOffset = rvaToOffset(dataRva)
        if (fileOffset !== null && size > 0 && fileOffset + size <= buffer.length) {
          resources.push({ type: typeEntry.name, name: nameEntry.name, data: buffer.subarray(fileOffset, fileOffset + size) })
        }
      }
    }
  }
  return resources
}

function makeIcoFromGroup(groupData, iconResources, language) {
  if (groupData.length < 6 || groupData.readUInt16LE(0) !== 0 || groupData.readUInt16LE(2) !== 1) return null
  const count = groupData.readUInt16LE(4)
  if (!count || groupData.length < 6 + count * 14) return null

  const images = []
  for (let index = 0; index < count; index++) {
    const entryOffset = 6 + index * 14
    const iconId = groupData.readUInt16LE(entryOffset + 12)
    const matching = iconResources.filter((resource) => resource.name.id === iconId)
    const icon = matching.find((resource) => resource.language === language) || matching[0]
    if (!icon) return null
    images.push({ entry: groupData.subarray(entryOffset, entryOffset + 12), data: icon.data })
  }

  let dataOffset = 6 + images.length * 16
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const parts = [header]
  images.forEach(({ entry, data }, index) => {
    const entryOffset = 6 + index * 16
    entry.copy(header, entryOffset)
    header.writeUInt32LE(data.length, entryOffset + 8)
    header.writeUInt32LE(dataOffset, entryOffset + 12)
    parts.push(data)
    dataOffset += data.length
  })
  return Buffer.concat(parts)
}

function getIconQuality(iconBuffer) {
  if (iconBuffer.length >= 24 && iconBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const width = iconBuffer.readUInt32BE(16)
    const height = iconBuffer.readUInt32BE(20)
    return { area: width * height, bitDepth: 32 }
  }
  if (iconBuffer.length < 6 || !iconBuffer.subarray(0, 4).equals(ICO_SIGNATURE)) return null

  const count = iconBuffer.readUInt16LE(4)
  if (!count || iconBuffer.length < 6 + count * 16) return null
  let best = null
  for (let index = 0; index < count; index++) {
    const entryOffset = 6 + index * 16
    const width = iconBuffer[entryOffset] || 256
    const height = iconBuffer[entryOffset + 1] || 256
    const bitDepth = iconBuffer.readUInt16LE(entryOffset + 6)
    const size = iconBuffer.readUInt32LE(entryOffset + 8)
    const imageOffset = iconBuffer.readUInt32LE(entryOffset + 12)
    if (!size || imageOffset + size > iconBuffer.length) continue
    const candidate = { entryOffset, width, height, bitDepth, size, imageOffset, area: width * height }
    if (!best || candidate.area > best.area || (candidate.area === best.area && candidate.bitDepth > best.bitDepth)) {
      best = candidate
    }
  }
  return best
}

function selectBestIconFrame(iconBuffer) {
  const best = getIconQuality(iconBuffer)
  if (!best || !Object.prototype.hasOwnProperty.call(best, 'entryOffset')) return null
  const singleFrame = Buffer.alloc(22 + best.size)
  singleFrame.writeUInt16LE(1, 2)
  singleFrame.writeUInt16LE(1, 4)
  iconBuffer.copy(singleFrame, 6, best.entryOffset, best.entryOffset + 12)
  singleFrame.writeUInt32LE(best.size, 14)
  singleFrame.writeUInt32LE(22, 18)
  iconBuffer.copy(singleFrame, 22, best.imageOffset, best.imageOffset + best.size)
  return { buffer: singleFrame, area: best.area, bitDepth: best.bitDepth }
}

function extractPeIconBuffer(buffer) {
  try {
    const resources = readPeResources(buffer)
    if (!resources) return null

    const embeddedImages = resources.filter((resource) => {
      const isIconResource = resource.type.id === 3 || /icon/i.test(resource.type.text) || /icon/i.test(resource.name.text)
      return isIconResource && (
        resource.data.subarray(0, 4).equals(ICO_SIGNATURE) || resource.data.subarray(0, 8).equals(PNG_SIGNATURE)
      )
    })
    const candidates = embeddedImages.map((resource) => {
      const frame = selectBestIconFrame(resource.data)
      if (frame) return frame
      const quality = getIconQuality(resource.data)
      return quality ? { buffer: resource.data, ...quality } : null
    }).filter(Boolean)

    const groups = resources.filter((resource) => resource.type.id === 14)
    const icons = resources.filter((resource) => resource.type.id === 3)
    for (const group of groups) {
      const ico = makeIcoFromGroup(group.data, icons, group.language)
      const frame = ico && selectBestIconFrame(ico)
      if (frame) candidates.push(frame)
    }
    candidates.sort((left, right) => right.area - left.area || right.bitDepth - left.bitDepth)
    return candidates[0]?.buffer || null
  } catch {
    return null
  }
}

module.exports = { extractPeIconBuffer }