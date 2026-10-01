
import { connect, connectedSockets } from './lib/connection.js'
import config from './config.js'

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PLUGINS_DIR = path.join(__dirname, 'plugins')

const commands = new Map()
const processedMessages = new Set()
const groupCache = new Map()
const attachedSockets = new WeakSet()

const START_TIME = Math.floor(Date.now() / 1000)

function getMessageContent(message) {
    let msg = message

    while (msg) {
        if (msg.ephemeralMessage?.message) {
            msg = msg.ephemeralMessage.message
            continue
        }

        if (msg.viewOnceMessage?.message) {
            msg = msg.viewOnceMessage.message
            continue
        }

        if (msg.viewOnceMessageV2?.message) {
            msg = msg.viewOnceMessageV2.message
            continue
        }

        if (msg.viewOnceMessageV2Extension?.message) {
            msg = msg.viewOnceMessageV2Extension.message
            continue
        }

        break
    }

    return msg || {}
}

function getText(m) {
    const msg = getMessageContent(m.message)

    return (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        msg.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        msg.buttonsResponseMessage?.selectedButtonId ||
        msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
        msg.templateButtonReplyMessage?.selectedId ||
        msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
        ''
    ).trim()
}

function cleanJid(jid = '') {
    return jid.replace(/:\d+@/, '@').trim()
}

async function loadPlugins() {
    commands.clear()

    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true })
    }

    const files = fs.readdirSync(PLUGINS_DIR)
        .filter(file => file.endsWith('.js'))

    for (const file of files) {
        try {
            const filePath = path.join(PLUGINS_DIR, file)
            const fileUrl = `file://${filePath.replace(/\\/g, '/')}`

            const imported = await import(
                `${fileUrl}?update=${Date.now()}`
            )

            const handler = imported.default

            if (!handler || typeof handler.run !== 'function') {
                console.log(chalk.yellow(`⚠️ Plugin ignorado: ${file}`))
                continue
            }

            const names = Array.isArray(handler.command)
                ? handler.command
                : [handler.command].filter(Boolean)

            for (const name of names) {
                commands.set(String(name).toLowerCase(), handler)
            }

            console.log(chalk.green(`✅ Plugin cargado: ${file}`))
        } catch (error) {
            console.error(
                chalk.red(`❌ Error cargando ${file}:`),
                error.message
            )
        }
    }

    console.log(
        chalk.cyan(`📦 Comandos registrados: ${commands.size}`)
    )
}

async function processMessage(sock, m) {
    try {
        if (!m?.message || !m?.key?.remoteJid) return

        if (!m.messageTimestamp) return

        const timestamp = Number(m.messageTimestamp)
        if (timestamp < START_TIME) return

        if (m.key.fromMe && !config.ALLOW_SELF) return

        const chat = m.key.remoteJid

        if (
            chat === 'status@broadcast' ||
            chat.endsWith('@broadcast')
        ) return

        const messageId = m.key.id
        if (!messageId) return

        const sessionId = sock.sessionId || 'principal'
        const uniqueId = `${sessionId}:${chat}:${messageId}`

        if (processedMessages.has(uniqueId)) return

        processedMessages.add(uniqueId)

        if (processedMessages.size > 5000) {
            const oldest = processedMessages.values().next().value
            processedMessages.delete(oldest)
        }

        const body = getText(m)

        if (!body || !body.startsWith(config.PREFIX)) return

        const input = body.slice(config.PREFIX.length).trim()
        if (!input) return

        const parts = input.split(/\s+/)
        const commandName = parts.shift().toLowerCase()
        const args = parts

        const handler = commands.get(commandName)
        if (!handler) return

        let groupMetadata = null

        if (chat.endsWith('@g.us')) {
            const cached = groupCache.get(`${sessionId}:${chat}`)

            if (cached && Date.now() - cached.time < 60000) {
                groupMetadata = cached.data
            } else {
                try {
                    groupMetadata = await sock.groupMetadata(chat)

                    groupCache.set(`${sessionId}:${chat}`, {
                        data: groupMetadata,
                        time: Date.now()
                    })
                } catch {
                    groupMetadata = null
                }
            }
        }

        const context = {
            commands,
            groupMetadata,
            isGroup: chat.endsWith('@g.us'),
            cleanJid,
            config,
            sessionId
        }

        console.log(
            chalk.gray(`[${sessionId}] ${config.PREFIX}${commandName} | ${chat}`)
        )

        await handler.run(sock, m, args, context)
    } catch (error) {
        console.error(
            chalk.red(`[${sock.sessionId || 'principal'}] Error procesando mensaje:`),
            error?.stack || error
        )
    }
}

function attachSocket(sock) {
    if (!sock || attachedSockets.has(sock)) return

    attachedSockets.add(sock)

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify' && type !== 'append') return

        for (const m of messages || []) {
            void processMessage(sock, m)
        }
    })

    sock.ev.on('groups.update', updates => {
        for (const update of updates || []) {
            if (update.id) {
                groupCache.delete(`${sock.sessionId}:${update.id}`)
            }
        }
    })

    sock.ev.on('group-participants.update', update => {
        if (update.id) {
            groupCache.delete(`${sock.sessionId}:${update.id}`)
        }
    })

    console.log(
        chalk.green(`✅ Escuchando mensajes: ${sock.sessionId || 'principal'}`)
    )
}

async function start() {
    console.log(chalk.cyan('🚀 Iniciando EXCLUSIVE BOT...'))

    await loadPlugins()

    // connect() inicia las sesiones guardadas y devuelve un socket inicial.
    const firstSocket = await connect()

    if (firstSocket) {
        attachSocket(firstSocket)
    }

    // Registrar todas las sesiones creadas durante el inicio.
    for (const sock of connectedSockets.values()) {
        attachSocket(sock)
    }

    // Detectar nuevas sesiones y reconexiones.
    setInterval(() => {
        for (const sock of connectedSockets.values()) {
            attachSocket(sock)
        }
    }, 1000)

    console.log(chalk.green('✅ Sistema multi-sesión iniciado'))
}

process.on('unhandledRejection', error => {
    console.error(
        chalk.red('❌ Promesa rechazada:'),
        error?.stack || error
    )
})

process.on('uncaughtException', error => {
    console.error(
        chalk.red('❌ Error inesperado:'),
        error?.stack || error
    )
})

start().catch(error => {
    console.error(
        chalk.red('❌ No se pudo iniciar el bot:'),
        error?.stack || error
    )
})
