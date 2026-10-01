
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
import { fileURLToPath } from 'url'
import qrcode from 'qrcode-terminal'

// Obtener la ruta de este archivo
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Usar siempre la misma carpeta de sesión
const SESSION_DIR = path.resolve(__dirname, '..', 'session')

const logger = pino({ level: 'silent' })

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = text =>
    new Promise(resolve => rl.question(text, resolve))

let currentSocket = null
let reconnectTimer = null

// Mostrar el encabezado
function banner() {
    console.log(chalk.cyanBright('EXCLUSIVE BOT'))
    console.log(chalk.gray('Conexión de WhatsApp'))
    console.log('')
}

// Crear una conexión de WhatsApp
export async function connect(onSocket) {
    if (currentSocket) {
        return currentSocket
    }

    fs.mkdirSync(SESSION_DIR, { recursive: true })

    const { state, saveCreds } =
        await useMultiFileAuthState(SESSION_DIR)

    console.log(
        chalk.gray('Carpeta de sesión: ') +
        chalk.white(SESSION_DIR)
    )

    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false
    })

    currentSocket = sock

    // Guardar las credenciales cuando cambien
    sock.ev.on('creds.update', saveCreds)

    // Registrar los eventos de mensajes
    if (typeof onSocket === 'function') {
        onSocket(sock)
    }

    // Solicitar la vinculación si no hay una sesión registrada
    if (!state.creds.registered) {
        console.log('')
        console.log(chalk.cyanBright('EXCLUSIVE BOT'))
        console.log(chalk.white('1. Código de vinculación'))
        console.log(chalk.white('2. Código QR'))
        console.log('')

        const option = (await question('Selecciona (1 o 2): ')).trim()

        if (option === '1') {
            const number = (
                await question('Número con código de país: ')
            ).replace(/\D/g, '')

            if (number.length < 8 || number.length > 15) {
                console.log(chalk.red('Número no válido'))
            } else {
                try {
                    await new Promise(resolve =>
                        setTimeout(resolve, 1500)
                    )

                    if (currentSocket !== sock) return sock

                    const code = await sock.requestPairingCode(number)

                    console.log('')
                    console.log(
                        chalk.greenBright('Código de vinculación:')
                    )
                    console.log(chalk.white.bold(code))
                    console.log('')
                    console.log(
                        chalk.gray(
                            'WhatsApp > Dispositivos vinculados > Vincular con número'
                        )
                    )
                } catch (error) {
                    console.log(
                        chalk.red('Error al solicitar el código:'),
                        error.message
                    )
                }
            }
        } else if (option === '2') {
            console.log(
                chalk.green('Esperando el código QR...')
            )
        } else {
            console.log(chalk.red('Opción no válida'))
        }
    } else {
        console.log(
            chalk.green('Sesión encontrada. Conectando...')
        )
    }

    // Gestionar el estado de la conexión
    sock.ev.on('connection.update', ({
        connection,
        lastDisconnect,
        qr
    }) => {
        if (qr) {
            console.log('')
            console.log(chalk.green('Escanea el código QR:'))
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'open') {
            console.log('')
            console.log(chalk.greenBright('EXCLUSIVE BOT CONECTADO'))
            console.log('')

            if (reconnectTimer) {
                clearTimeout(reconnectTimer)
                reconnectTimer = null
            }

            if (rl.listenerCount('line') > 0) {
                rl.close()
            }
        }

        if (connection === 'close') {
            if (currentSocket !== sock) return

            currentSocket = null

            const reason =
                lastDisconnect?.error?.output?.statusCode

            console.log(
                chalk.red(
                    `Conexión cerrada: ${reason ?? 'motivo desconocido'}`
                )
            )

            if (reason === DisconnectReason.loggedOut) {
                console.log(
                    chalk.yellow(
                        'Sesión cerrada. Detén el bot, elimina session y vuelve a vincular.'
                    )
                )
                return
            }

            // Evitar programar varias reconexiones a la vez
            if (reconnectTimer) return

            reconnectTimer = setTimeout(async () => {
                reconnectTimer = null

                try {
                    await connect(onSocket)
                } catch (error) {
                    console.log(
                        chalk.red('Error al reconectar:'),
                        error.message
                    )
                }
            }, 3000)
        }
    })

    return sock
}

// Obtener el socket actual
export function getSocket() {
    return currentSocket
}

// Mostrar el encabezado al cargar el módulo
banner()
