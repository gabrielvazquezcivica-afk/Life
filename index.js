
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import chalk from 'chalk'
import config from './config.js'
import { connect } from './lib/connection.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGINS_DIR = path.join(__dirname, 'plugins')

const PREFIX = config.PREFIX || '.'
const START_TIME = Math.floor(Date.now() / 1000)

const commands = new Map()
const processedMessages = new Set()
const groupCache = new Map()

const MAX_PROCESSED = 10000
const GROUP_CACHE_TTL = 60000

// Diseño limpio de la consola
function banner() {
    console.clear()

    console.log(chalk.cyanBright('EXCLUSIVE BOT'))
    console.log(chalk.gray('Bot de WhatsApp'))
    console.log('')
    console.log(chalk.green('Estado: ') + chalk.white('Iniciando'))
    console.log(chalk.green('Prefijo: ') + chalk.white(PREFIX))
    console.log(chalk.green('Modo: ') + chalk.white('Solo comandos'))
    console.log('')
}

// Mostrar los comandos ejecutados
function logCommand({ command, user, chatName, isGroup, fromMe }) {
    const time = new Date().toLocaleTimeString('es-MX', {
        hour12: false
    })

    console.log(
        chalk.gray(`[${time}] `) +
        chalk.green('COMANDO ') +
        chalk.yellow(command)
    )

    console.log(
        chalk.gray('Usuario: ') +
        chalk.white(user)
    )

    console.log(
        chalk.gray(isGroup ? 'Grupo: ' : 'Chat: ') +
        chalk.cyan(chatName)
    )

    if (fromMe) {
        console.log(
            chalk.magenta('Ejecutado desde la cuenta del bot')
        )
    }

    console.log('')
}

// Obtener el contenido real del mensaje
function getContent(message) {
    let content = message?.message
    if (!content) return null

    for (let i = 0; i < 6; i++) {
        const key = Object.keys(content).find(k =>
            [
                'ephemeralMessage',
                'viewOnceMessage',
                'viewOnceMessageV2',
                'documentWithCaptionMessage'
            ].includes(k)
        )

        if (!key || !content[key]?.message) break
        content = content[key].message
    }

    return content
}

// Extraer el texto del mensaje
function getText(message) {
    const content = getContent(message)
    if (!content) return ''

    return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        content.documentMessage?.caption ||
        content.buttonsResponseMessage?.selectedButtonId ||
        content.listResponseMessage?.singleSelectReply?.selectedRowId ||
        content.templateButtonReplyMessage?.selectedId ||
        ''
    ).trim()
}

// Limpiar identificadores de WhatsApp
function cleanJid(jid = '') {
    return jid.replace(/:\d+@/, '@').trim()
}

// Obtener el nombre del usuario
function getUserName(message) {
    const sender =
        message.key?.participant ||
        message.key?.remoteJid ||
        ''

    return (
        message.pushName ||
        cleanJid(sender).split('@')[0] ||
        'Usuario desconocido'
    )
}

// Comprobar si el chat es un grupo
function isGroupJid(jid = '') {
    return jid.endsWith('@g.us')
}

// Evitar procesar el mismo mensaje dos veces
function rememberMessage(id) {
    if (!id || processedMessages.has(id)) return false

    processedMessages.add(id)

    if (processedMessages.size > MAX_PROCESSED) {
        const first = processedMessages.values().next().value
        processedMessages.delete(first)
    }

    return true
}

// Cargar los plugins
async function loadPlugins() {
    commands.clear()

    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true })
    }

    const files = fs.readdirSync(PLUGINS_DIR)
        .filter(file => file.endsWith('.js'))

    let loaded = 0

    for (const file of files) {
        const filePath = path.join(PLUGINS_DIR, file)

        try {
            const url = pathToFileURL(filePath)
            url.searchParams.set('update', Date.now().toString())

            const imported = await import(url.href)
            const handler = imported.default

            if (!handler || typeof handler.run !== 'function') {
                console.log(
                    chalk.yellow(`Plugin omitido: ${file}`)
                )
                continue
            }

            const names = Array.isArray(handler.command)
                ? handler.command
                : [handler.command]

            for (const name of names) {
                if (!name) continue
                commands.set(String(name).toLowerCase(), handler)
            }

            loaded++
        } catch (error) {
            console.log(
                chalk.red(`Error cargando ${file}: ${error.message}`)
            )
        }
    }

    console.log(chalk.green(`Plugins cargados: ${loaded}`))
    console.log(chalk.green(`Comandos registrados: ${commands.size}`))
    console.log('')
}

// Obtener los datos del grupo
async function getGroupMetadata(sock, jid) {
    const cached = groupCache.get(jid)

    if (cached && Date.now() - cached.time < GROUP_CACHE_TTL) {
        return cached.metadata
    }

    try {
        const metadata = await sock.groupMetadata(jid)

        groupCache.set(jid, {
            metadata,
            time: Date.now()
        })

        return metadata
    } catch {
        return null
    }
}

// Procesar cada mensaje
async function processMessage(sock, message) {
    if (!message?.key || !message.message) return

    const chat = message.key.remoteJid
    if (!chat) return

    if (
        chat === 'status@broadcast' ||
        chat.endsWith('@broadcast')
    ) return

    const timestamp = Number(message.messageTimestamp || 0)

    if (!timestamp || timestamp < START_TIME) return

    if (!rememberMessage(message.key.id)) return

    const text = getText(message)

    // Ignorar mensajes normales
    if (!text || !text.startsWith(PREFIX)) return

    const body = text.slice(PREFIX.length).trim()
    if (!body) return

    const parts = body.split(/\s+/)
    const command = parts.shift().toLowerCase()
    const args = parts

    const handler = commands.get(command)
    if (!handler) return

    const isGroup = isGroupJid(chat)
    const sender =
        message.key.participant ||
        message.key.remoteJid

    let metadata = null
    let chatName = 'Chat privado'

    if (isGroup) {
        metadata = await getGroupMetadata(sock, chat)
        chatName = metadata?.subject || 'Grupo sin nombre'
    } else {
        chatName = getUserName(message)
    }

    const user = getUserName(message)

    const context = {
        isGroup,
        metadata,
        groupMetadata: metadata,
        sender,
        chat,
        fromMe: Boolean(message.key.fromMe),
        prefix: PREFIX,
        command
    }

    logCommand({
        command: PREFIX + command,
        user,
        chatName,
        isGroup,
        fromMe: Boolean(message.key.fromMe)
    })

    // Ejecutar sin bloquear los siguientes comandos
    try {
        await handler.run(sock, message, args, context)
    } catch (error) {
        console.log(
            chalk.red(
                `Error en ${PREFIX}${command}: ${error.message}`
            )
        )
    }
}

// Conectar los eventos del bot
function attachSocket(sock) {
    sock.ev.on('messages.upsert', ({ messages }) => {
        for (const message of messages || []) {
            void processMessage(sock, message).catch(error => {
                console.log(
                    chalk.red(
                        `Error procesando mensaje: ${error.message}`
                    )
                )
            })
        }
    })

    sock.ev.on('groups.update', updates => {
        for (const update of updates || []) {
            if (update.id) groupCache.delete(update.id)
        }
    })

    sock.ev.on('group-participants.update', update => {
        if (update.id) groupCache.delete(update.id)
    })
}

// Iniciar el bot
async function start() {
    banner()
    await loadPlugins()

    console.log(chalk.cyan('Conectando EXCLUSIVE BOT...'))
    console.log('')

    await connect(attachSocket)
}

// Capturar errores no controlados
process.on('unhandledRejection', error => {
    console.log(
        chalk.red(`Error no controlado: ${error?.message || error}`)
    )
})

process.on('uncaughtException', error => {
    console.log(
        chalk.red(`Error crítico: ${error?.message || error}`)
    )
})

start().catch(error => {
    console.log(
        chalk.red(`No se pudo iniciar el bot: ${error.message}`)
    )
})
