
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getQuotedSticker, getStickerHash } from '../lib/stickerHash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const STICKERS_FILE = path.join(__dirname, '..', 'data', 'stickers.json')

function loadCommands() {
  if (!fs.existsSync(STICKERS_FILE)) {
    fs.mkdirSync(path.dirname(STICKERS_FILE), { recursive: true })
    fs.writeFileSync(STICKERS_FILE, '{}')
  }

  try {
    const data = JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'))
    return data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {}
  } catch {
    return {}
  }
}

function saveCommands(data) {
  fs.writeFileSync(STICKERS_FILE, JSON.stringify(data, null, 2))
}

const handler = {
  command: ['addcmd', 'setcmd', 'cmdadd', 'cmdset'],

  run: async (sock, m, args) => {
    const sticker = getQuotedSticker(m)

    if (!sticker) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Responde al sticker que quieres registrar.\n\nEjemplo: .addcmd .kickall'
      }, { quoted: m })
    }

    const command = args.join(' ').trim()

    if (!command) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Escribe el comando que quieres asignar.\n\nEjemplo: .addcmd .kickall'
      }, { quoted: m })
    }

    const hash = getStickerHash(sticker)

    if (!hash) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '❌ No se pudo obtener el hash del sticker.'
      }, { quoted: m })
    }

    try {
      const data = loadCommands()

      data[hash] = {
        command,
        creator: m.key.participant || m.key.remoteJid,
        at: Date.now()
      }

      saveCommands(data)

      await sock.sendMessage(m.key.remoteJid, {
        text: `✅ COMANDO ASIGNADO AL STICKER\n\n🎯 Comando: ${command}`
      }, { quoted: m })
    } catch (error) {
      console.error('Error registrando comando de sticker:', error)

      await sock.sendMessage(m.key.remoteJid, {
        text: '❌ Ocurrió un error al registrar el comando.'
      }, { quoted: m })
    }
  }
}

export default handler
