
import { connect } from './lib/connection.js'
import config from './config.js'

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import chalk from 'chalk'
import { performance } from 'perf_hooks'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PLUGINS_DIR = path.join(__dirname, 'plugins')
const PREFIX = config.PREFIX || '.'
const START_TIME = Math.floor(Date.now() / 1000)

const commands = new Map()
const processedMessages = new Set()
const groupCache = new Map()

// Evitar que el caché de grupos crezca indefinidamente.
const MAX_PROCESSED_MESSAGES = 5000
const GROUP_CACHE_TTL = 10 * 60 * 1000
const groupCacheTime = new Map()

// Banner de Exclusive
function banner() {
    console.clear()

    console.log(chalk.hex('#B388FF').bold(`
╔══════════════════════════════════════════════╗
║                                              ║
║              E X C L U S I V E               ║
║                                              ║
║               WHATSAPP BOT                   ║
║                                              ║
╚══════════════════════════════════════════════╝
`))

    console.log(chalk.gray('  Plugins • Multitarea • Baileys\n'))
}

// Cargar plugins
async function loadPlugins() {
    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true })
    }

    const files = fs.readdirSync(PLUGINS_DIR)
        .filter(file => file.endsWith('.js'))

    commands.clear()

    for (const file of files) {
        try {
            const filePath = pathToFileURL(
                path.join(PLUGINS_DIR, file)
            ).href

            const module = await import(
                `${filePath}?v=${Date.now()}`
            )

            const handler = module.default || module

            if (typeof handler.run !== 'function') {
                console.log(
                    chalk.yellow(`  ⚠ ${file}: sin handler.run`)
                )
                continue
            }

            const names = handler.command
                ? Array.isArray(handler.command)
                    ? handler.command
                    : [handler.command]
                : [path.basename(file, '.js')]

            for (const name of names) {
                if (typeof name !== 'string') continue

                const commandName = name.toLowerCase()

                if (commands.has(commandName)) {
                    console.log(
                        chalk.yellow(
                            `  ⚠ Comando duplicado: ${commandName} (${file})`
                        )
                    )
                }

                commands.set(commandName, handler)
            }

            console.log(chalk.green('  ✔ '), chalk.white(file))
        } catch (error) {
            console.log(
                chalk.red(`  ✖ ${file}: ${error.stack || error.message}`)
            )
        }
    }

    console.log(
        '\n',
        chalk.hex('#B388FF').bold('  COMANDOS CARGADOS: '),
        chalk.white(commands.size),
        '\n'
    )
}

// Extraer texto del mensaje
function getText(m) {
    const msg = m.message

    if (!msg) return ''

    const message =
        msg.ephemeralMessage?.message ||
        msg.viewOnceMessage?.message ||
        msg.viewOnceMessageV2?.message ||
        msg.documentWithCaptionMessage?.message ||
        msg

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        message.interactiveResponseMessage?.body?.text ||
        ''
    ).trim()
}

// Convertir timestamp de Baileys a segundos
function getTimestampSeconds(timestamp) {
    if (timestamp == null) return 0

    if (typeof timestamp === 'object') {
        if (typeof timestamp.toNumber === 'function') {
            return timestamp.toNumber()
        }

        if (typeof timestamp.low === 'number') {
            return timestamp.low
        }
    }

    const value = Number(timestamp)

    return Number.isFinite(value) ? value : 0
}

// Nombre del grupo
async function getGroupName(sock, jid) {
    if (!jid.endsWith('@g.us')) {
        return 'Chat privado'
    }

    const now = Date.now()
    const cachedAt = groupCacheTime.get(jid)

    if (
        groupCache.has(jid) &&
        cachedAt &&
        now - cachedAt < GROUP_CACHE_TTL
    ) {
        return groupCache.get(jid)
    }

    try {
        const metadata = await sock.groupMetadata(jid)
        const name = metadata.subject || 'Grupo sin nombre'

        groupCache.set(jid, name)
        groupCacheTime.set(jid, now)

        return name
    } catch {
        return groupCache.get(jid) || 'Grupo desconocido'
    }
}

// Nombre del usuario
function getSenderName(m) {
    if (m.key.fromMe) {
        return config.BOT_NAME || 'Exclusive'
    }

    return (
        m.pushName ||
        m.key.participant ||
        m.key.remoteJid ||
        'Usuario desconocido'
    )
}

// Registrar comandos en consola
function logCommand({ user, group, command, elapsed, fromMe }) {
    const time = new Date().toLocaleTimeString('es-MX', {
        hour12: false
    })

    console.log(chalk.gray('┌──────────────────────────────────────────────'))
    console.log(
        chalk.gray('│ '),
        chalk.hex('#B388FF').bold('EXCLUSIVE'),
        chalk.gray(' • '),
        chalk.white(time)
    )
    console.log(
        chalk.gray('│ '),
        chalk.hex('#64B5F6')('Usuario: '),
        chalk.white(user),
        fromMe ? chalk.magenta('(BOT)') : ''
    )
    console.log(
        chalk.gray('│ '),
        chalk.hex('#64B5F6')('Grupo:   '),
        chalk.white(group)
    )
    console.log(
        chalk.gray('│ '),
        chalk.hex('#64B5F6')('Comando: '),
        chalk.hex('#81C784').bold(command)
    )
    console.log(
        chalk.gray('│ '),
        chalk.hex('#64B5F6')('Tiempo:  '),
        chalk.white(`${elapsed} ms`)
    )
    console.log(chalk.gray('└──────────────────────────────────────────────\n'))
}

// Limitar el registro de mensajes procesados
function rememberMessage(uniqueId) {
    if (processedMessages.has(uniqueId)) {
        return false
    }

    processedMessages.add(uniqueId)

    if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
        const oldest = processedMessages.values().next().value

        if (oldest !== undefined) {
            processedMessages.delete(oldest)
        }
    }

    return true
}

// Procesar cada mensaje de forma independiente
async function processMessage(sock, m) {
    try {
        if (!m?.message || !m.key?.remoteJid) return

        const jid = m.key.remoteJid

        if (jid === 'status@broadcast') return

        const id = m.key.id

        if (id) {
            const uniqueId = `${jid}:${id}`

            if (!rememberMessage(uniqueId)) {
                return
            }
        }

        const timestamp = getTimestampSeconds(m.messageTimestamp)

        // Ignorar mensajes anteriores al inicio cuando tienen timestamp válido.
        if (timestamp > 0 && timestamp < START_TIME) {
            return
        }

        const text = getText(m)

        if (!text) return

        // Solo procesar mensajes que comiencen con el prefijo.
        if (!text.startsWith(PREFIX)) return

        const body = text.slice(PREFIX.length).trim()

        if (!body) return

        const parts = body.split(/\s+/)
        const commandName = parts.shift().toLowerCase()
        const args = parts

        const handler = commands.get(commandName)

        if (!handler) {
            console.log(
                chalk.yellow('[COMANDO NO ENCONTRADO]'),
                chalk.white(text),
                chalk.gray(`| Chat: ${jid}`)
            )
            return
        }

        const start = performance.now()

        // Obtener el grupo en paralelo con la ejecución del comando.
        const groupPromise = getGroupName(sock, jid)

        // No usar await en el bucle de mensajes permite concurrencia.
        await handler.run(sock, m, args)

        const elapsed = Math.round(performance.now() - start)
        const group = await groupPromise

        logCommand({
            user: getSenderName(m),
            group,
            command: `${PREFIX}${commandName}`,
            elapsed,
            fromMe: Boolean(m.key.fromMe)
        })
    } catch (error) {
        console.error(
            chalk.red('[EXCLUSIVE ERROR]'),
            error.stack || error.message
        )
    }
}

// Iniciar bot
async function startBot() {
    banner()

    await loadPlugins()

    console.log(
        chalk.hex('#B388FF')('  Conectando con WhatsApp...\n')
    )

    const sock = await connect()

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        console.log(
            chalk.gray(`[MENSAJES] Tipo: ${type} | Cantidad: ${messages.length}`)
        )

        if (type !== 'notify' && type !== 'append') {
            return
        }

        for (const m of messages) {
            // Cada mensaje se procesa de manera independiente.
            // No bloquear el bucle esperando a que termine el comando.
            void processMessage(sock, m)
        }
    })

    console.log(
        chalk.green('  ✔ Exclusive está listo para recibir comandos.\n')
    )
}

// Manejar errores de inicio
startBot().catch(error => {
    console.error(
        chalk.red('[ERROR FATAL]'),
        error.stack || error.message
    )

    process.exitCode = 1
})
