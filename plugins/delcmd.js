
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const STICKERS_FILE = path.join(__dirname, '..', 'data', 'stickers.json')

const handler = {
  command: ['delcmd', 'deletecmd', 'removecmd'],

  run: async (sock, m, args) => {
    const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage
    const sticker = quoted?.stickerMessage

    if (!sticker) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Responde al sticker cuyo comando quieres borrar.\n\nEjemplo: .delcmd'
      }, { quoted: m })
    }

    if (!sticker.fileSha256) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '❌ No se pudo identificar el sticker.'
      }, { quoted: m })
    }

    if (!fs.existsSync(STICKERS_FILE)) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ No hay comandos de stickers registrados.'
      }, { quoted: m })
    }

    try {
      const data = JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'))
      const hash = Buffer.from(sticker.fileSha256).toString('base64')

      if (!data[hash]) {
        return sock.sendMessage(m.key.remoteJid, {
          text: '⚠️ Este sticker no tiene ningún comando asignado.'
        }, { quoted: m })
      }

      delete data[hash]

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
