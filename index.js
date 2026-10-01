
import makeWASocket from '@whiskeysockets/baileys'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { fileURLToPath, pathToFileURL } from 'url'

import config from './config.js'
import {
    connect,
    connectedSockets,
    getConnectedSessions
} from './lib/connection.js'

// ⚙️ CONFIGURACIÓN
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGINS_DIR = path.join(__dirname, 'plugins')

const PREFIX = config.PREFIX ?? '.'
const BOT_NAME = config.BOT_NAME ?? 'EXCLUSIVE'
const OWNER = config.OWNER ?? ''

// 📦 COMANDOS
const commands = new Map()
const attachedSockets = new WeakSet()
const processedMessages = new Set()
const groupCache = new Map()

// ⏱️ IGNORAR MENSAJES ANTERIORES AL ARRANQUE
const START_TIME = Math.floor(Date.now() / 1000)

// 🧹 CONSOLA
function banner() {
    console.clear()

    console.log(chalk.cyanBright.bold(`
╔══════════════════════════════════════╗
║             EXCLUSIVE                ║
║        MULTI-SESSION WHATSAPP        ║
╚══════════════════════════════════════╝
`))

    console.log(chalk.gray(' Prefijo: ') + chalk.white(PREFIX))
    console.log(chalk.gray(' Plugins: ') + chalk.white(PLUGINS_DIR))
    console.log(chalk.gray(' Estado:  ') + chalk.green('Iniciando...'))
    console.log(chalk.gray('─'.repeat(50)))
}

// 🔌 CARGAR PLUGINS
async function loadPlugins() {
    commands.clear()

    if (!fs.existsSync(PLUGINS_DIR)) {
        fs.mkdirSync(PLUGINS_DIR, { recursive: true })
    }

    const files = fs.readdirSync(PLUGINS_DIR)
        .filter(file => file.endsWith('.js'))

    for (const file of files) {
        try {
            const filePath = pathToFileURL(
                path.join(PLUGINS_DIR, file)
            ).href

            const module = await import(filePath)
            const handler = module.default ?? module.handler

            if (!handler || typeof handler.run !== 'function') {
                console.log(
                    chalk.yellow(`⚠ Plugin ignorado: ${file}`)
                )
                continue
            }

            const names = Array.isArray(handler.command)
                ? handler.command
                : [handler.command].filter(Boolean)

            if (!names.length) {
                console.log(
                    chalk.yellow(`⚠ Sin comandos: ${file}`)
                )
                continue
            }

            for (const name of names) {
                commands.set(String(name).toLowerCase(), handler)
            }

            console.log(
                chalk.green(' ✓ ') +
                chalk.white(file) +
                chalk.gray(` (${names.join(', ')})`)
            )
        } catch (error) {
            console.log(
                chalk.red(`✗ Error en ${file}: ${error.message}`)
            )
        }
    }

    console.log(
        chalk.cyanBright(`\n📦 ${commands.size} comandos registrados\n`)
    )
}

// 📝 EXTRAER TEXTO DEL MENSAJE
function getText(m) {
    const msg = m.message

    if (!msg) return ''

    return (
        msg.conversation ??
        msg.extendedTextMessage?.text ??
        msg.imageMessage?.caption ??
        msg.videoMessage?.caption ??
        msg.documentMessage?.caption ??
        msg.buttonsResponseMessage?.selectedButtonId ??
        msg.listResponseMessage?.singleSelectReply?.selectedRowId ??
        msg.templateButtonReplyMessage?.selectedId ??
        msg.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ??
        ''
    ).trim()
}

// 🕒 CONVERTIR FECHA DE MENSAJE
function getTimestamp(m) {
    const timestamp = m.messageTimestamp

    if (timestamp == null) return 0

    if (typeof timestamp.toNumber === 'function') {
        return timestamp.toNumber()
    }

    return Number(timestamp)
}

// 👤 LIMPIAR JID
function limpiarJid(jid = '') {
    return jid.replace(/:\d+@/, '@').trim()
}

// 📡 METADATOS DE GRUPOS
async function getGroupMetadata(sock, jid) {
    const cached = groupCache.get(jid)

    if (cached && Date.now() - cached.time < 60000) {
        return cached.data
    }

    const metadata = await sock.groupMetadata(jid)

    groupCache.set(jid, {
        data: metadata,
        time: Date.now()
    })

    return metadata
}

// 🔐 CONTEXTO DE PERMISOS
async function getContext(sock, m) {
    const jid = m.key.remoteJid
    const sender = limpiarJid(
        m.key.participant ?? m.key.remoteJid ?? ''
    )

    const ownerNumber = String(OWNER)
        .replace(/\D/g, '')

    const senderNumber = sender
        .split('@')[0]
        .split(':')[0]

    const isOwner = Boolean(
        ownerNumber && senderNumber === ownerNumber
    )

    let metadata = null
    let isAdmin = false
    let isBotAdmin = false

    if (jid?.endsWith('@g.us')) {
        try {
            metadata = await getGroupMetadata(sock, jid)

            const participants = metadata.participants ?? []

            const participant = participants.find(
                p => limpiarJid(p.id) === sender
            )

            const botParticipant = participants.find(
                p => limpiarJid(p.id) === limpiarJid(sock.user.id)
            )

            isAdmin = Boolean(
                participant?.admin || isOwner
            )

            isBotAdmin = Boolean(botParticipant?.admin)
        } catch {
            // Si falla la consulta, se mantienen los permisos en false.
        }
    }

    return {
        commands,
        config,
        BOT_NAME,
        OWNER,
        PREFIX,
        isOwner,
        isAdmin,
        isBotAdmin,
        groupMetadata: metadata,
        limpiarJid
    }
}

// 🖥️ REGISTRO LIMPIO DE COMANDOS
function logCommand(command, m, sock, groupName) {
    const sender = m.pushName || 'Usuario desconocido'
    const jid = m.key.remoteJid || 'desconocido'
    const session = sock.sessionId || 'principal'

    console.log(
        chalk.gray(`[${new Date().toLocaleTimeString()}] `) +
        chalk.magentaBright(`[${session}] `) +
        chalk.cyanBright(`ECHO ${PREFIX}${command}`) +
        chalk.gray(' | ') +
        chalk.white(sender) +
        chalk.gray(' | ') +
        chalk.green(jid.endsWith('@g.us')
            ? groupName
            : 'Chat privado')
    )
}

// ⚡ PROCESAR UN MENSAJE
async function processMessage(sock, m) {
    try {
        if (!m?.message || !m.key?.remoteJid) return

        const esPropio = m.key.fromMe === true

if (esPropio && !config.ALLOW_SELF) return

        const jid = m.key.remoteJid

        if (
            jid === 'status@broadcast' ||
            jid.endsWith('@broadcast')
        ) return

        // Ignorar mensajes antiguos al iniciar/reiniciar.
        const timestamp = getTimestamp(m)

        if (!timestamp || timestamp < START_TIME) return

        // Evitar procesar dos veces el mismo mensaje.
        const messageId = m.key.id

        if (!messageId) return

        const uniqueId = `${sock.sessionId || 'principal'}:${jid}:${messageId}`

        if (processedMessages.has(uniqueId)) return

        processedMessages.add(uniqueId)

        // Evitar que el conjunto crezca indefinidamente.
        if (processedMessages.size > 10000) {
            const first = processedMessages.values().next().value
            processedMessages.delete(first)
        }

        const text = getText(m)

        if (!text.startsWith(PREFIX)) return

        const body = text.slice(PREFIX.length).trim()

        if (!body) return

        const parts = body.split(/\s+/)
        const command = parts.shift().toLowerCase()
        const args = parts

        const handler = commands.get(command)

        if (!handler) return

        let groupName = 'Chat privado'

        if (jid.endsWith('@g.us')) {
            try {
                const metadata = await getGroupMetadata(sock, jid)
                groupName = metadata.subject || 'Grupo sin nombre'
            } catch {
                groupName = jid
            }
        }

        logCommand(command, m, sock, groupName)

        const context = await getContext(sock, m)

        // Cada mensaje se procesa independientemente.
        // No bloquear el resto de comandos mientras este termina.
        await handler.run(sock, m, args, context)

    } catch (error) {
        console.error(
            chalk.red(`[ERROR] ${error.message}`)
        )
    }
}

// 🔗 REGISTRAR CADA SOCKET UNA SOLA VEZ
function attachSocket(sock) {
    if (!sock || attachedSockets.has(sock)) return

    attachedSockets.add(sock)

    sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return

        // Lanzar el procesamiento sin esperar a los demás mensajes.
        for (const m of messages) {
            void processMessage(sock, m)
        }
    })

    sock.ev.on('groups.update', updates => {
        for (const update of updates) {
            if (update.id) groupCache.delete(update.id)
        }
    })

    sock.ev.on('group-participants.update', update => {
        if (update.id) groupCache.delete(update.id)
    })

    console.log(
        chalk.green('● ') +
        chalk.white(`Socket registrado: ${sock.sessionId || 'principal'}`)
    )
}

// 🚀 INICIO
async function start() {
    banner()

    await loadPlugins()

    // Conectar el número principal.
    const sock = await connect()

    attachSocket(sock)

    // Registrar también sockets adicionales cuando se creen.
    // connectedSockets es el Map exportado por lib/connection.js.
    const scanSessions = () => {
        for (const socket of connectedSockets.values()) {
            attachSocket(socket)
        }
    }

    scanSessions()

    const sessionWatcher = setInterval(scanSessions, 1000)

    // No finalizar el proceso solo por el temporizador.
    sessionWatcher.unref?.()

    console.log(chalk.gray('─'.repeat(50)))
    console.log(chalk.greenBright.bold(
        `✅ ${BOT_NAME} está listo para recibir comandos`
    ))
    console.log(chalk.gray(
        `👑 Owner: ${OWNER || 'No configurado'}`
    ))
    console.log(chalk.gray(
        `🔌 Sesiones registradas: ${getConnectedSessions().length}`
    ))
    console.log(chalk.gray('─'.repeat(50)))
}

start().catch(error => {
    console.error(
        chalk.redBright('❌ Error iniciando EXCLUSIVE:'),
        error
    )
    process.exitCode = 1
})
