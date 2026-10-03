
function unwrapMessage(message) {
  let current = message

  while (current) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message

    if (!next) break
    current = next
  }

  return current || {}
}

export function getQuotedSticker(m) {
  const message = unwrapMessage(m.message || {})

  const context =
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.documentMessage?.contextInfo

  if (!context?.quotedMessage) return null

  const quoted = unwrapMessage(context.quotedMessage)
  const sticker = quoted.stickerMessage

  if (!sticker) return null

  return sticker
}

export function getStickerHash(sticker) {
  if (!sticker?.fileSha256) return null

  return Buffer.from(sticker.fileSha256).toString('base64')
}
