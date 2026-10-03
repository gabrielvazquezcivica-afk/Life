
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getQuotedSticker, getStickerHash } from '../lib/stickerHash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const STICKERS_FILE = path.join(__dirname, '..', 'data', 'stickers.json')

function loadCommands() {
  if (!fs.existsSync(STICKERS_FILE)) return {}

  try {
    const data = JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {}
  } catch {
    return {}
  }
}

const handler = {
  command: ['delcmd', 'unsetcmd', 'cmddel', 'cmddelete'],

  run: async (sock, m) => {
    const sticker = getQuotedSticker(m)

    if (!sticker) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Responde al sticker cuya asociación quieres eliminar.'
      }, { quoted: m })
    }

    const hash = getStickerHash(sticker)

    if (!hash) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '❌ No se pudo identificar el sticker.'
      }, { quoted: m })
    }

    const data = loadCommands()

    if (!data[hash]) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Este sticker no tiene ningún comando registrado.'
      }, { quoted: m })
    }

    delete data[hash]

    try {
      fs.writeFileSync(STICKERS_FILE, JSON.stringify(data, null, 2))

      await sock.sendMessage(m.key.remoteJid, {
        text: '✅ Se eliminó el comando asociado al sticker.'
      }, { quoted: m })
    } catch (error) {
      console.error('Error eliminando comando de sticker:', error)

      await sock.sendMessage(m.key.remoteJid, {
        text: '❌ No se pudo eliminar la asociación.'
      }, { quoted: m })
    }
  }
}

export default handler
