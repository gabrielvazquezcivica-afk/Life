
function unwrapMessage(message) {
  let current = message

  while (current) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message
      continue
    }

    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message
      continue
    }

    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message
      continue
    }

    if (current.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message
      continue
    }

    break
  }

  return current || {}
}

// Obtener el sticker citado en un mensaje
export function getQuotedSticker(m) {
  const message = unwrapMessage(m.message || {})

  const context =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo

  if (!context?.quotedMessage) return null

  const quoted = unwrapMessage(context.quotedMessage)

  return quoted.stickerMessage || null
}
