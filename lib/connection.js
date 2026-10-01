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

// 📲 CONSOLA
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = (text) =>
    new Promise(resolve => rl.question(text, resolve))

const logger = pino({ level: 'silent' })

// 📁 CARPETA DE SESIONES
const SESSIONS_DIR = './sessions'

// 📡 NÚMEROS CONECTADOS
export const connectedSockets = new Map()

// 🔐 CREAR CONEXIÓN
async function createConnection(sessionId, showLogin = true) {

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

    if (!sessionExists && showLogin) {

        console.log(chalk.cyan(
            '\n¿CÓMO QUIERES INICIAR SESIÓN?\n'
        ))

        console.log('1. Código de vinculación')
        console.log('2. Código QR\n')

        const option = await question('Selecciona (1 o 2): ')

        if (option === '1') {

            const number = await question(
                '\n📱 Ingresa tu número con código de país (ej. 521234567890): '
            )

            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(
                        number.replace(/\D/g, '')
                    )

                    console.log(chalk.green(
                        `\n🔑 Código de vinculación (${sessionId}): ${code}\n`
                    ))
                } catch (err) {
                    console.log(
                        chalk.red('❌ Error generando código:'),
                        err.message
                    )
                }
            }, 3000)

        } else if (option === '2') {

            sock.ev.on('connection.update', ({ qr }) => {
                if (qr) {
                    console.log(chalk.green(
                        `\n📲 Escanea el QR de ${sessionId}:\n`
                    ))
                    qrcode.generate(qr, { small: true })
                }
            })

        } else {
            console.log(chalk.red('❌ Opción no válida.'))
        }

    } else if (sessionExists) {

        console.log(chalk.green(
            `\n🔐 Sesión ${sessionId} detectada; conectando...\n`
        ))
    }

    // 📡 ESTADO DE CONEXIÓN
    sock.ev.on('connection.update', ({
        connection,
        lastDisconnect
    }) => {

        if (connection === 'open') {
            console.log(chalk.green(
                `\n✅ EXCLUSIVE CONECTADO: ${sessionId}\n`
            ))
        }

        if (connection === 'close') {

            const reason =
                lastDisconnect?.error?.output?.statusCode

            console.log(chalk.red(
                `❌ Conexión cerrada (${sessionId}): ${reason}`
            ))

            connectedSockets.delete(sessionId)

            // 🔄 REINTENTAR SI NO FUE CIERRE DE SESIÓN
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => {
                    createConnection(sessionId, false)
                        .catch(err => console.error(
                            `Error reconectando ${sessionId}:`,
                            err.message
                        ))
                }, 3000)
            } else {
                console.log(chalk.yellow(
                    `⚠️ La sesión ${sessionId} fue cerrada desde WhatsApp.`
                ))
            }
        }
    })

    return sock
}

// 🚀 CONEXIÓN DEL BOT PRINCIPAL
export async function connect() {

    console.clear()

    console.log(chalk.redBright.bold(`
███████╗██╗  ██╗ ██████╗██╗     ██╗   ██╗███████╗██╗██╗   ██╗███████╗
██╔════╝╚██╗██╔╝██╔════╝██║     ██║   ██║██╔════╝██║██║   ██║██╔════╝
█████╗   ╚███╔╝ ██║     ██║     ██║   ██║███████╗██║██║   ██║█████╗
██╔══╝   ██╔██╗ ██║     ██║     ╚██╗ ██╔╝╚════██║██║╚██╗ ██╔╝██╔══╝
███████╗██╔╝ ██╗╚██████╗███████╗ ╚████╔╝ ███████║██║ ╚████╔╝ ███████╗
╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝  ╚═══╝  ╚══════╝╚═╝  ╚═══╝ ╚══════╝
    `))

    console.log(chalk.yellowBright(
        '\n⚡ EXCLUSIVE | MULTI-SESSION WHATSAPP BOT\n'
    ))

    fs.mkdirSync(SESSIONS_DIR, { recursive: true })

    return await createConnection('principal')
}

// ➕ CONECTAR OTRO NÚMERO
export async function connectAdditional() {

    console.log(chalk.cyan(
        '\n➕ CONECTAR NÚMERO ADICIONAL\n'
    ))

    const sessionId = (
        await question('Nombre de la sesión (ej. numero2): ')
    ).trim()

    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
        console.log(chalk.red(
            '❌ Usa únicamente letras, números, guiones o guiones bajos.'
        ))
        return null
    }

    if (connectedSockets.has(sessionId)) {
        console.log(chalk.yellow(
            '⚠️ Esa sesión ya está conectada.'
        ))
        return connectedSockets.get(sessionId)
    }

    return await createConnection(sessionId)
}

// 📋 VER SESIONES CONECTADAS
export function getConnectedSessions() {
    return [...connectedSockets.keys()]
      }
