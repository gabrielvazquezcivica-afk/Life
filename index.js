
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

// Cargar los plugins
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

// Obtener el mensaje interno
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

// Obtener el texto del mensaje
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

// Obtener la descripción exacta del sticker
function getStickerLabel(sticker) {
  if (typeof sticker?.accessibilityLabel !== 'string') return null
  if (!sticker.accessibilityLabel.length) return null

  return sticker.accessibilityLabel
}

// Cargar las asociaciones de stickers
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

// Ejecutar un comando asociado a la descripción exacta
async function processSticker(sock, m) {
  const message = unwrapMessage(m.message || {})
  const sticker = message.stickerMessage

  if (!sticker) return

  const label = getStickerLabel(sticker)

  // Ignorar stickers que no contienen descripción
  if (label === null) return

  const records = loadStickerCommands()
  const saved = records[`label:${label}`]

  // Ignorar stickers sin comando asignado
  if (!saved) return

  const commandText = saved.command

  if (typeof commandText !== 'string' || !commandText.trim()) return

  await executeCommand(sock, m, commandText)
}

// Registrar la ejecución de un comando
function logCommand(command, m, duration) {
  const sender = m.key.participant || m.key.remoteJid

  console.log(
    chalk.cyan(`[COMANDO] ${command}`),
    chalk.gray(`| Usuario: ${sender}`),
    chalk.gray(`| Tiempo: ${duration.toFixed(2)} ms`)
  )
}

// Ejecutar un comando
async function executeCommand(sock, m, commandText) {
  const prefix = config.PREFIX || '.'
  const text = commandText.trim()

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
  if (!handler) return

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

// Procesar los mensajes
async function processMessage(sock, m) {
  try {
    if (!m?.message || !m.key?.remoteJid) return
    if (m.key.remoteJid === 'status@broadcast') return
    if (m.key.fromMe) return

    const messageId = m.key.id

    // Evitar procesar el mismo mensaje dos veces
    if (messageId) {
      if (processedMessages.has(messageId)) return

      processedMessages.add(messageId)

      if (processedMessages.size > 5000) {
        const oldest = processedMessages.values().next().value
        processedMessages.delete(oldest)
      }
    }

    const messageContent = unwrapMessage(m.message)

    // Ejecutar el comando de un sticker
    if (messageContent.stickerMessage) {
      await processSticker(sock, m)
      return
    }

    const text = getText(m).trim()
    if (!text) return

    const prefix = config.PREFIX || '.'

    // Comprobar el prefijo
    if (!text.startsWith(prefix)) return

    await executeCommand(sock, m, text)
  } catch (error) {
    console.error(chalk.red('Error procesando mensaje:'), error)
  }
}

// Configurar los eventos del socket
function setupSocket(sock) {
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return

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
