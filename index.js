
import { connect } from './lib/connection.js'
import config from './config.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import chalk from 'chalk'
import { performance } from 'perf_hooks'
import { getStickerHash } from './lib/stickerHash.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let commands = new Map()
let reconnecting = false

const STICKERS_FILE = path.join(__dirname, 'data', 'stickers.json')
const processedMessages = new Set()
const processingMessages = new Set()

function banner() {
  console.clear()
  console.log(chalk.cyan(`
  ╔══════════════════════════════╗
  ║          EXCLUSIVE           ║
  ║       WhatsApp Bot           ║
  ╚══════════════════════════════╝
  `))
}

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
        if (name) commands.set(String(name).toLowerCase(), handler)
      }

      console.log(chalk.green(`Plugin cargado: ${file}`))
    } catch (error) {
      console.error(chalk.red(`Error cargando ${file}:`), error)
    }
  }

  console.log(chalk.cyan(`Total de comandos: ${commands.size}`))
}

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

function getText(m) {
  const message = unwrapMessage(m.message || {})

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

function logCommand(command, m, duration) {
  const sender = m.key.participant || m.key.remoteJid

  console.log(
    chalk.cyan(`[COMANDO] ${command}`),
    chalk.gray(`| Usuario: ${sender}`),
    chalk.gray(`| Tiempo: ${duration.toFixed(2)} ms`)
  )
}

async function executeCommand(sock, m, commandText) {
  const prefix = config.PREFIX || '.'
  const text = String(commandText || '').trim()

  if (!text) return

  const normalized = text.startsWith(prefix)
    ? text
    : `${prefix}${text}`

  const body = normalized.slice(prefix.length).trim()
  if (!body) return

  const args = body.split(/\s+/)
  const command = (args.shift() || '').toLowerCase()

  if (!command) return

  const handler = commands.get(command)

  if (!handler) {
    console.log(chalk.yellow(`Comando no encontrado: ${command}`))
    return
  }

  const start = performance.now()

  try {
    await handler.run(sock, m, args)
    logCommand(command, m, performance.now() - start)
  } catch (error) {
    console.error(chalk.red(`Error en el comando ${command}:`), error)

    await sock.sendMessage(
      m.key.remoteJid,
      { text: 'Ocurrió un error al ejecutar el comando.' },
      { quoted: m }
    ).catch(() => {})
  }
}

async function processSticker(sock, m) {
  const message = unwrapMessage(m.message || {})
  const sticker = message.stickerMessage

  if (!sticker) return

  const hash = getStickerHash(sticker)

  if (!hash) {
    console.log(chalk.yellow('Sticker recibido sin fileSha256'))
    return
  }

  const records = loadStickerCommands()
  const saved = records[hash]

  if (!saved || typeof saved.command !== 'string') {
    return
  }

  console.log(chalk.cyan(`[STICKER] Comando detectado: ${saved.command}`))

  await executeCommand(sock, m, saved.command)
}

async function processMessage(sock, m) {
  const messageId = m?.key?.id

  try {
    if (!m?.message || !m.key?.remoteJid) return
    if (m.key.remoteJid === 'status@broadcast') return

    const messageContent = unwrapMessage(m.message)
    const isSticker = Boolean(messageContent.stickerMessage)

    // Los mensajes propios solo pueden activar asociaciones de stickers.
    if (m.key.fromMe && !isSticker) return

    if (messageId) {
      if (processedMessages.has(messageId)) return
      if (processingMessages.has(messageId)) return

      processingMessages.add(messageId)
    }

    try {
      if (isSticker) {
        await processSticker(sock, m)
        return
      }

      const text = getText(m).trim()
      if (!text) return

      const prefix = config.PREFIX || '.'
      if (!text.startsWith(prefix)) return

      await executeCommand(sock, m, text)
    } finally {
      if (messageId) {
        processingMessages.delete(messageId)
        processedMessages.add(messageId)

        if (processedMessages.size > 5000) {
          const oldest = processedMessages.values().next().value
          processedMessages.delete(oldest)
        }
      }
    }
  } catch (error) {
    if (messageId) processingMessages.delete(messageId)
    console.error(chalk.red('Error procesando mensaje:'), error)
  }
}

function setupSocket(sock) {
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Baileys puede notificar mensajes nuevos con distintos tipos de evento.
    if (type !== 'notify' && type !== 'append') return

    for (const m of messages || []) {
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
