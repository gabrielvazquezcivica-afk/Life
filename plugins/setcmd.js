import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import config from '../config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.join(__dirname, '../data')
const DATA_FILE = path.join(DATA_DIR, 'stickers.json')

// Crear carpeta y archivo si no existen
function ensureFile() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
    }

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, '{}', 'utf8')
    }
}

// Leer comandos globales
function loadStickers() {
    ensureFile()

    try {
        return JSON.parse(
            fs.readFileSync(DATA_FILE, 'utf8')
        )
    } catch {
        return {}
    }
}

// Guardar comandos globales
function saveStickers(data) {
    ensureFile()

    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(data, null, 2),
        'utf8'
    )
}

const handler = {
    command: ['setcmd', 'addcmd', 'cmdadd', 'cmdset'],

    run: async (sock, m, args) => {
        const jid = m.key.remoteJid

        try {
            const quoted =
                m.message?.extendedTextMessage?.contextInfo?.quotedMessage

            if (!quoted) {
                return sock.sendMessage(
                    jid,
                    {
                        text: '⚠️ Responde a un sticker para agregarle un comando.'
                    },
                    { quoted: m }
                )
            }

            const sticker = quoted.stickerMessage

            if (!sticker?.fileSha256) {
                return sock.sendMessage(
                    jid,
                    {
                        text: '❌ El mensaje citado no es un sticker válido.'
                    },
                    { quoted: m }
                )
            }

            const text = args.join(' ').trim()

            if (!text) {
                return sock.sendMessage(
                    jid,
                    {
                        text: `⚠️ Escribe el texto que ejecutará el sticker.\n\nEjemplo: ${(config.PREFIX || '.') }setcmd hola`
                    },
                    { quoted: m }
                )
            }

            const hash = Buffer
                .from(sticker.fileSha256)
                .toString('base64')

            const stickers = loadStickers()

            if (stickers[hash]?.locked) {
                return sock.sendMessage(
                    jid,
                    {
                        text: '🔒 Este comando está bloqueado y no se puede modificar.'
                    },
                    { quoted: m }
                )
            }

            const contextInfo =
                m.message?.extendedTextMessage?.contextInfo || {}

            stickers[hash] = {
                text,
                mentionedJid: contextInfo.mentionedJid || [],
                creator: m.key.participant || jid,
                at: Date.now(),
                locked: false
            }

            saveStickers(stickers)

            return sock.sendMessage(
                jid,
                {
                    text: '✅ Comando guardado globalmente. Funcionará en cualquier grupo o chat donde el bot pueda recibir el sticker.'
                },
                { quoted: m }
            )

        } catch (error) {
            console.error('[SETCMD ERROR]', error)

            return sock.sendMessage(
                jid,
                {
                    text: '❌ No se pudo guardar el comando del sticker.'
                },
                { quoted: m }
            )
        }
    }
}

export default handler