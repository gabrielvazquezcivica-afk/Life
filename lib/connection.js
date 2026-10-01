
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
const SESSIONS_DIR = './sessions'

export const connectedSockets = new Map()

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms))

async function createConnection(sessionId, interactive = false) {
    const sessionPath = path.join(SESSIONS_DIR, sessionId)

    fs.mkdirSync(sessionPath, { recursive: true })

    const { state, saveCreds } =
        await useMultiFileAuthState(sessionPath)

    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                logger
            )
        },
        printQRInTerminal: false
    })

    sock.sessionId = sessionId
    connectedSockets.set(sessionId, sock)

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', ({
        connection,
        lastDisconnect,
        qr
    }) => {
        if (connection === 'open') {
            console.log(
                chalk.green(`✅ Sesión conectada: ${sessionId}`)
            )
        }

        if (interactive && qr) {
            console.log(
                chalk.cyan(`📲 Escanea el QR de ${sessionId}:`)
            )
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'close') {
            const reason =
                lastDisconnect?.error?.output?.statusCode

            connectedSockets.delete(sessionId)

            console.log(
                chalk.red(`❌ Sesión cerrada: ${sessionId} (${reason})`)
            )

            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => {
                    createConnection(sessionId, false)
                        .catch(error => {
                            console.error(
                                `Error reconectando ${sessionId}:`,
                                error.message
                            )
                        })
                }, 3000)
            } else {
                console.log(
                    chalk.yellow(
                        `⚠️ La sesión ${sessionId} debe vincularse nuevamente.`
                    )
                )
            }
        }
    })

    if (interactive && !state.creds.registered) {
        console.log('\n¿Cómo quieres iniciar sesión?')
        console.log('1. Código de vinculación')
        console.log('2. Código QR\n')

        const option = (await question('Selecciona (1 o 2): ')).trim()

        if (option === '1') {
            const number = (
                await question(
                    'Número con código de país (solo números): '
                )
            ).replace(/\D/g, '')

            try {
                await sleep(2000)
                const code = await sock.requestPairingCode(number)

                console.log(
                    chalk.green(`🔑 Código de vinculación: ${code}`)
                )
            } catch (error) {
                console.log(
                    chalk.red(`❌ Error: ${error.message}`)
                )
            }
        } else if (option !== '2') {
            console.log(chalk.red('❌ Opción no válida.'))
        }
    }

    return sock
}

export async function connect() {
    console.clear()

    console.log(chalk.cyan.bold(`
╔════════════════════════════════════╗
║       EXCLUSIVE BOT                ║
║       MULTI-SESSION                ║
╚════════════════════════════════════╝
`))

    fs.mkdirSync(SESSIONS_DIR, { recursive: true })

    return createConnection('principal', true)
}

export async function connectAdditional(number) {
    const phoneNumber = String(number || '').replace(/\D/g, '')

    if (phoneNumber.length < 8 || phoneNumber.length > 15) {
        throw new Error('El número no es válido. Incluye el código de país.')
    }

    const sessionId = `numero_${phoneNumber}`
    const sessionPath = path.join(SESSIONS_DIR, sessionId)

    if (connectedSockets.has(sessionId)) {
        throw new Error('Ese número ya tiene una sesión activa.')
    }

    fs.mkdirSync(SESSIONS_DIR, { recursive: true })

    const { state } = await useMultiFileAuthState(sessionPath)

    if (state.creds.registered) {
        throw new Error('Ese número ya tiene una sesión vinculada.')
    }

    const sock = await createConnection(sessionId, false)

    try {
        await sleep(2000)

        const code = await sock.requestPairingCode(phoneNumber)

        return {
            sock,
            code,
            sessionId
        }
    } catch (error) {
        throw new Error(
            `No se pudo generar el código: ${error.message}`
        )
    }
}

export function getConnectedSessions() {
    return [...connectedSockets.keys()]
}
