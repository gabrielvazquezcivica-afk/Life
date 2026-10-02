
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getQuotedSticker } from '../lib/stickerHash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const STICKERS_FILE = path.join(__dirname, '..', 'data', 'stickers.json')

const handler = {
  command: ['delcmd', 'deletecmd', 'removecmd'],

  run: async (sock, m) => {
    const sticker = getQuotedSticker(m)

    if (!sticker) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Responde al sticker cuyo comando quieres eliminar.\n\nEjemplo: .delcmd'
      }, { quoted: m })
    }

    const label = sticker.accessibilityLabel

    if (typeof label !== 'string' || label.length === 0) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '❌ No se pudo obtener la descripción técnica del sticker.'
      }, { quoted: m })
    }

    try {
      if (!fs.existsSync(STICKERS_FILE)) {
        return sock.sendMessage(m.key.remoteJid, {
          text: '⚠️ No hay comandos de stickers registrados.'
        }, { quoted: m })
      }

      const data = JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'))
      const key = `label:${label}`

      if (!data[key]) {
        return sock.sendMessage(m.key.remoteJid, {
          text: '⚠️ Este sticker no tiene un comando asignado.'
        }, { quoted: m })
      }

      delete data[key]

      fs.writeFileSync(STICKERS_FILE, JSON.stringify(data, null, 2))

      await sock.sendMessage(m.key.remoteJid, {
        text: '✅ Se eliminó el comando asociado a este sticker.'
      }, { quoted: m })
    } catch (error) {
      console.error('Error eliminando comando de sticker:', error)

      await sock.sendMessage(m.key.remoteJid, {
        text: '❌ Ocurrió un error al eliminar el comando.'
      }, { quoted: m })
    }
  }
}

export default handler
