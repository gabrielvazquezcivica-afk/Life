
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys'

import pino from 'pino'
import chalk from 'chalk'
import readline from 'readline'
import fs from 'fs'
import path from 'path'
import qrcode from 'qrcode-terminal'

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = text =>
    new Promise(resolve => rl.question(text, resolve))

const logger = pino({ level: 'silent' })
const SESSIONS_DIR = path.resolve('./sessions')

export const connectedSockets = new Map()

async function createConnection(sessionId, options = {}) {
    const {
        interactive = false,
        phoneNumber = '',
        notifySock = null,
        notifyChat = null
    } = options

    const sessionPath = path.join(SESSIONS_DIR, sessionId)

    fs.mkdirSync(sessionPath, { recursive: true })

    const sessionExists =
        fs.existsSync(path.join(sessionPath, 'creds.json'))

    const { state, saveCreds } =
        await useMultiFileAuthState(sessionPath)

    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false
    })

    sock.sessionId = sessionId
    connectedSockets.set(sessionId, sock)

    sock.ev.on('creds.update', saveCreds)

    // Inicio interactivo reservado para el bot principal.
    if (!sessionExists && interactive) {
        console.log(chalk.cyan('\n¿Cómo quieres iniciar sesión?\n'))
        console.log('1. Código de vinculación')
        console.log('2. Código QR\n')

        const option = await question('Selecciona (1 o 2): ')

        if (option === '1') {
            const number = (
                await question('Número con código de país: ')
            ).replace(/\D/g, '')

            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(number)
                    console.log(chalk.green(
                        `Código de vinculación: ${code}`
                    ))
                } catch (error) {
                    console.error('Error de vinculación:', error.message)
                }
            }, 2000)
        } else if (option === '2') {
            sock.ev.on('connection.update', ({ qr }) => {
                if (qr) qrcode.generate(qr, { small: true })
            })
        }
    }

    // Vinculación remota solicitada mediante .code.
    if (!sessionExists && phoneNumber) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber)

                console.log(chalk.green(
                    `Código generado para ${sessionId}: ${code}`
                ))

                if (notifySock && notifyChat) {
                    await notifySock.sendMessage(notifyChat, {
                        text:
                            `🔐 *EXCLUSIVE BOT — VINCULACIÓN*\n\n` +
                            `📱 Número: ${phoneNumber}\n` +
                            `🔑 Código: *${code}*\n\n` +
                            `Abre WhatsApp en ese número y entra a ` +
                            `*Dispositivos vinculados → Vincular con número de teléfono*.\n\n` +
                            `⚠️ No compartas este código con otras personas.`
                    })
                }
            } catch (error) {
                console.error(
                    `Error generando código (${sessionId}):`,
                    error.message
                )

                if (notifySock && notifyChat) {
                    await notifySock.sendMessage(notifyChat, {
                        text: `❌ No se pudo generar el código para ${phoneNumber}: ${error.message}`
                    }).catch(() => {})
                }
            }
        }, 2000)
    }

    if (sessionExists) {
        console.log(chalk.cyan(
            `Sesión existente detectada: ${sessionId}`
        ))
    }

    sock.ev.on('connection.update', ({
        connection,
        lastDisconnect
    }) => {
        if (connection === 'open') {
            console.log(chalk.green(
                `✅ EXCLUSIVE conectado: ${sessionId}`
            ))
        }

        if (connection === 'close') {
            const reason =
                lastDisconnect?.error?.output?.statusCode

            console.log(chalk.red(
                `❌ Sesión cerrada (${sessionId}): ${reason}`
            ))

            if (connectedSockets.get(sessionId) === sock) {
                connectedSockets.delete(sessionId)
            }

            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => {
                    createConnection(sessionId)
                        .catch(error => console.error(
                            `Error reconectando ${sessionId}:`,
                            error.message
                        ))
                }, 3000)
            } else {
                console.log(chalk.yellow(
                    `La sesión ${sessionId} requiere volver a vincularse.`
                ))
            }
        }
    })

    return sock
}

// Conexión principal.
export async function connect() {
    console.log(chalk.cyan.bold(
        '\n⚡ EXCLUSIVE BOT — MULTI-SESSION\n'
    ))

    fs.mkdirSync(SESSIONS_DIR, { recursive: true })

    return createConnection('principal', {
        interactive: true
    })
}

// Crear una sesión nueva mediante número de teléfono.
export async function connectAdditional(
    number,
    notifySock,
    notifyChat
) {
    const phoneNumber = String(number).replace(/\D/g, '')

    if (phoneNumber.length < 8 || phoneNumber.length > 15) {
        throw new Error('Número inválido. Incluye el código de país.')
    }

    const sessionId = `numero_${phoneNumber}`
    const sessionPath = path.join(SESSIONS_DIR, sessionId)
    const credentialsPath = path.join(sessionPath, 'creds.json')

    if (connectedSockets.has(sessionId)) {
        throw new Error('Ese número ya tiene una conexión activa.')
    }

    // No sobrescribir ni volver a vincular una sesión ya guardada.
    if (fs.existsSync(credentialsPath)) {
        throw new Error(
            'Ese número ya tiene una sesión guardada. ' +
            'Si ya fue vinculado, debería reconectarse automáticamente.'
        )
    }

    return createConnection(sessionId, {
        phoneNumber,
        notifySock,
        notifyChat
    })
}

export function getConnectedSessions() {
    return [...connectedSockets.keys()]
}
