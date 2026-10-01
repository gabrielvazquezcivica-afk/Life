
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

const SESSION_DIR = path.resolve('./sessions/principal')
const logger = pino({ level: 'silent' })

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = text =>
    new Promise(resolve => rl.question(text, resolve))

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms))

let currentSocket = null
let reconnecting = false

async function createConnection(onSocket) {
    fs.mkdirSync(SESSION_DIR, { recursive: true })

    const { state, saveCreds } =
        await useMultiFileAuthState(SESSION_DIR)

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

    sock.sessionId = 'principal'
    currentSocket = sock

    sock.ev.on('creds.update', saveCreds)

    // Registrar los eventos de mensajes inmediatamente.
    if (typeof onSocket === 'function') {
        onSocket(sock)
    }

    sock.ev.on('connection.update', async ({
        connection,
        lastDisconnect,
        qr
    }) => {
        if (qr) {
            console.log(chalk.cyan('\n📲 Escanea este QR con WhatsApp:'))
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'connecting') {
            console.log(chalk.yellow('🔄 Conectando WhatsApp...'))
        }

        if (connection === 'open') {
            reconnecting = false
            console.log(chalk.green('✅ EXCLUSIVE BOT conectado'))
        }

        if (connection === 'close') {
            if (currentSocket !== sock) return

            currentSocket = null

            const reason =
                lastDisconnect?.error?.output?.statusCode

            console.log(
                chalk.red(`❌ Conexión cerrada (${reason ?? 'desconocido'})`)
            )

            if (reason === DisconnectReason.loggedOut) {
                console.log(
                    chalk.yellow(
                        '⚠️ La sesión se cerró desde WhatsApp. Debes vincularla nuevamente.'
                    )
                )
                return
            }

            if (reconnecting) return
            reconnecting = true

            console.log(chalk.yellow('🔄 Intentando reconectar...'))

            setTimeout(async () => {
                try {
                    reconnecting = false
                    await createConnection(onSocket)
                } catch (error) {
                    console.error(
                        chalk.red('❌ Error al reconectar:'),
                        error.message
                    )
                }
            }, 3000)
        }
    })

    return sock
}

export async function connect(onSocket) {
    console.clear()

    console.log(chalk.cyan.bold(`
╔════════════════════════════════════╗
║          EXCLUSIVE BOT             ║
║        CONEXIÓN ÚNICA              ║
╚════════════════════════════════════╝
`))

    fs.mkdirSync(SESSION_DIR, { recursive: true })

    const { state } = await useMultiFileAuthState(SESSION_DIR)

    if (!state.creds.registered) {
        console.log(chalk.yellow('📱 WhatsApp aún no está vinculado.'))
        console.log('1. Código de vinculación')
        console.log('2. Código QR')

        const option = (
            await question('Selecciona (1 o 2): ')
        ).trim()

        const sock = await createConnection(onSocket)

        if (option === '1') {
            const number = (
                await question('Número con código de país (solo números): ')
            ).replace(/\D/g, '')

            if (number.length < 8 || number.length > 15) {
                console.log(chalk.red('❌ Número no válido.'))
                rl.close()
                return sock
            }

            try {
                await sleep(1500)

                const code = await sock.requestPairingCode(number)

                console.log(chalk.green('\n🔑 Código de vinculación:'))
                console.log(chalk.bold.white(code))
                console.log(
                    chalk.gray(
                        'En WhatsApp: Dispositivos vinculados > Vincular dispositivo.'
                    )
                )
            } catch (error) {
                console.error(
                    chalk.red('❌ No se pudo generar el código:'),
                    error.message
                )
            }
        } else if (option !== '2') {
            console.log(
                chalk.yellow('Opción no válida. Se mostrará el QR si está disponible.')
            )
        }

        rl.close()
        return sock
    }

    console.log(chalk.green('📂 Sesión principal encontrada.'))
    console.log(chalk.cyan('🔄 Iniciando con la sesión guardada...'))

    rl.close()
    return createConnection(onSocket)
}

export function getSocket() {
    return currentSocket
}
