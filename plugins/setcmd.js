import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const STICKERS_FILE = path.join(__dirname, '..', 'data', 'stickers.json')

function loadCommands() {
  if (!fs.existsSync(STICKERS_FILE)) {
    fs.mkdirSync(path.dirname(STICKERS_FILE), { recursive: true })
    fs.writeFileSync(STICKERS_FILE, '{}')
  }

  return JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'))
}

function saveCommands(data) {
  fs.writeFileSync(STICKERS_FILE, JSON.stringify(data, null, 2))
}

const handler = {
  command: ['addcmd', 'setcmd', 'cmdadd', 'cmdset'],

  run: async (sock, m, args) => {
    const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage
    const sticker = quoted?.stickerMessage

    if (!sticker) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Responde a un sticker con:\n.addcmd .kickall'
      }, { quoted: m })
    }

    const command = args.join(' ').trim()

    if (!command.startsWith('.')) {
      return sock.sendMessage(m.key.remoteJid, {
        text: '⚠️ Especifica un comando válido.\n\nEjemplo: .addcmd .kickall'
      }, { quoted: m })
    }

    const hash = Buffer.from(sticker.fileSha256).toString('base64')
    const data = loadCommands()

    data[hash] = {
      command,
      creator: m.key.participant || m.key.remoteJid,
      at: Date.now()
    }

    saveCommands(data)

    await sock.sendMessage(m.key.remoteJid, {
      text: `✅ COMANDO ASIGNADO AL STICKER\n\n🎯 Comando: ${command}\n\nAhora, al enviar ese sticker, se ejecutará el comando.`
    }, { quoted: m })
  }
}

export default handler