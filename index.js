import { connect } from './lib/connection.js'
import config from './config.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import chalk from 'chalk'
import { performance } from 'perf_hooks'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let commands = new Map()
let reconnecting = false

const STICKERS_FILE = path.join(__dirname, 'data', 'stickers.json')
const processedMessages = new Set()

// Mostrar el banner
function banner() {
  console.clear()
  console.log(chalk.cyan(`
  ╔══════════════════════════════╗
  ║          TIBU BOT            ║
  ║       WhatsApp Bot           ║
  ╚══════════════════════════════╝
  `))
}

// Cargar los comandos
async function loadPlugins() {
  const pluginsDir = path.join(__dirname, 'plugins')

  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true })
  }

  commands.clear()

  const files = fs.readdirSync(pluginsDir)
    .filter(file => file.endsWith('.js'))

  for (const file of files) {
    try {
      const filePath = path.join(pluginsDir, file)
      const fileUrl = pathToFileURL(filePath).href
      const imported = await import(`${fileUrl}?update=${Date.now()}`)
      const handler = imported.default || imported.handler

      if (!handler || typeof handler.run !== 'function') {
        console.log(chalk.yellow(`Plugin ignorado: ${file}`))
        continue
      }

      const names = Array.isArray(handler.command)
        ? handler.command
        : [handler.command]

      for (const name of names) {
        if (!name) continue
        commands.set(String(name).toLowerCase(), handler)
      }

      console.log(chalk.green(`Plugin cargado: ${file}`))
    } catch (error) {
      console.error(chalk.red(`Error cargando ${file}:`), error)
    }
  }

  console.log(chalk.cyan(`Total de comandos: ${commands.size}`))
}

// Obtener el texto de un mensaje
function getText(m) {
  const message = m.message
  if (!message) return ''

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    ''
  )
}

// Obtener el mensaje real, incluso si está envuelto
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

  return current
}

// Obtener el hash de un sticker
function getStickerHash(m) {
  const message = unwrapMessage(m.message || {})
  const sticker = message.stickerMessage

  if (!sticker?.fileSha256) return null

  return Buffer.from(sticker.fileSha256).toString('base64')
}

// Cargar los comandos asociados a stickers
function loadStickerCommands() {
  try {
    if (!fs.existsSync(STICKERS_FILE)) {
      fs.mkdirSync(path.dirname(STICKERS_FILE), { recursive: true })
      fs.writeFileSync(STICKERS_FILE, '{}')
    }

    const data = JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'))

    return data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {}
  } catch (error) {
    console.error(chalk.red('Error leyendo stickers.json:'), error)
    return {}
  }
}

// Ejecutar un comando asociado a un sticker
async function processSticker(sock, m) {
  const hash = getStickerHash(m)
  if (!hash) return false

  const stickerCommands = loadStickerCommands()
  const data = stickerCommands[hash]

  if (!data || typeof data.text !== 'string') return false

  const jid = m.key.remoteJid
  const mentions = Array.isArray(data.mentionedJid)
    ? data.mentionedJid
    : []

  await sock.sendMessage(
    jid,
    {
      text: data.text,
      mentions
    },
    {
      quoted: m
    }
  )

  return true
}

// Registrar los comandos ejecutados
function logCommand(command, m, duration) {
  const sender = m.key.participant || m.key.remoteJid

  console.log(
    chalk.cyan(`[COMANDO] ${command}`),
    chalk.gray(`| Usuario: ${sender}`),
    chalk.gray(`| Tiempo: ${duration.toFixed(2)} ms`)
  )
}

// Procesar mensajes
async function processMessage(sock, m) {
  try {
    if (!m?.message || !m.key?.remoteJid) return
    if (m.key.remoteJid === 'status@broadcast') return
    if (m.key.fromMe) return

    const messageId = m.key.id

    // Evitar procesar el mismo mensaje más de una vez
    if (messageId) {
      if (processedMessages.has(messageId)) return

      processedMessages.add(messageId)

      if (processedMessages.size > 5000) {
        const oldest = processedMessages.values().next().value
        processedMessages.delete(oldest)
      }
    }

    // Procesar los comandos asociados a stickers
    const messageContent = unwrapMessage(m.message)

    if (messageContent.stickerMessage) {
      await processSticker(sock, m)
      return
    }

    const text = getText(m).trim()
    if (!text) return

    const prefix = config.PREFIX || '.'

    // Comprobar el prefijo
    if (!text.startsWith(prefix)) return

    const args = text.slice(prefix.length).trim().split(/\s+/)
    const command = (args.shift() || '').toLowerCase()

    if (!command) return

    const handler = commands.get(command)
    if (!handler) return

    // Ejecutar el comando sin bloquear otros mensajes
    const start = performance.now()

    try {
      await handler.run(sock, m, args)
      logCommand(command, m, performance.now() - start)
    } catch (error) {
      console.error(chalk.red(`Error en el comando ${command}:`), error)

      await sock.sendMessage(
        m.key.remoteJid,
        {
          text: 'Ocurrió un error al ejecutar el comando.'
        },
        {
          quoted: m
        }
      ).catch(() => {})
    }
  } catch (error) {
    console.error(chalk.red('Error procesando mensaje:'), error)
  }
}

// Configurar los eventos del socket
function setupSocket(sock) {
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages || []) {
      // Cada mensaje se procesa de forma independiente
      void processMessage(sock, m)
    }
  })

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      reconnecting = false
      console.log(chalk.green('Bot conectado correctamente'))
    }

    if (connection === 'close' && !reconnecting) {
      reconnecting = true

      const statusCode = lastDisconnect?.error?.output?.statusCode

      console.log(
        chalk.yellow(`Conexión cerrada. Código: ${statusCode ?? 'desconocido'}`)
      )

      // Reconectar si la conexión se cierra
      if (statusCode !== 401) {
        try {
          const newSock = await connect()
          setupSocket(newSock)
        } catch (error) {
          reconnecting = false
          console.error(chalk.red('Error al reconectar:'), error)
        }
      } else {
        reconnecting = false
        console.log(chalk.red('La sesión necesita volver a vincularse'))
      }
    }
  })
}

// Iniciar el bot
async function startBot() {
  banner()

  await loadPlugins()

  console.log(chalk.green('Iniciando bot...'))

  try {
    const sock = await connect()
    setupSocket(sock)
  } catch (error) {
    reconnecting = false
    console.error(chalk.red('Error iniciando el bot:'), error)
  }
}

startBot()