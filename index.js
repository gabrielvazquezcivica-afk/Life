
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

const commands = new Map()
const processedMessages = new Set()
const groupCache = new Map()
const groupCacheTime = new Map()

const MAX_PROCESSED_MESSAGES = 5000
const GROUP_CACHE_TTL = 10 * 60 * 1000

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

                commands.set(name.toLowerCase(), handler)
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

    console.log(
        chalk.cyan('  Comandos registrados:'),
        [...commands.keys()].join(', ')
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

// Nombre del grupo
async function getGroupName(sock, jid) {
    if (!jid.endsWith('@g.us')) return 'Chat privado'

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

    return m.pushName || m.key.participant || m.key.remoteJid
}

// Registro de comandos ejecutados
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

// Evitar procesar dos veces el mismo mensaje
function rememberMessage(uniqueId) {
    if (processedMessages.has(uniqueId)) return false

    processedMessages.add(uniqueId)

    if (processedMessages.size > MAX_PROCESSED_MESSAGES) {
        const oldest = processedMessages.values().next().value

        if (oldest !== undefined) {
            processedMessages.delete(oldest)
        }
    }

    return true
}

// Procesar comandos
async function processMessage(sock, m) {
    try {
        if (!m?.message || !m.key?.remoteJid) return

        const jid = m.key.remoteJid

        if (jid === 'status@broadcast') return

        const text = getText(m)

        if (!text || !text.startsWith(PREFIX)) return

        const body = text.slice(PREFIX.length).trim()
        if (!body) return

        const parts = body.split(/\s+/)
        const commandName = parts.shift().toLowerCase()
        const args = parts

        const id = m.key.id

        if (id && !rememberMessage(`${jid}:${id}`)) return

        const handler = commands.get(commandName)

        if (!handler) return

        const start = performance.now()
        const groupPromise = getGroupName(sock, jid)

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

    await connect(sock => {
        sock.ev.on('messages.upsert', ({ messages, type }) => {
            // Diagnóstico temporal de recepción
            console.log('[MENSAJES RECIBIDOS]', {
                tipo: type,
                cantidad: messages?.length || 0
            })

            if (type !== 'notify' && type !== 'append') return

            for (const m of messages || []) {
                console.log('[MENSAJE]', {
                    id: m.key?.id,
                    chat: m.key?.remoteJid,
                    descifrado: Boolean(m.message),
                    desdeBot: Boolean(m.key?.fromMe)
                })

                void processMessage(sock, m)
            }
        })
    })

    console.log(
        chalk.green('  ✔ Exclusive está listo para recibir comandos.\n')
    )
}

startBot().catch(error => {
    console.error(
        chalk.red('[ERROR FATAL]'),
        error.stack || error.message
    )

    process.exitCode = 1
})
