
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
import qrcode from 'qrcode-terminal'

// 📲 Consola
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = text =>
    new Promise(resolve => rl.question(text, resolve))

const SESSION_DIR = './session'
const logger = pino({ level: 'silent' })

let currentSocket = null
let reconnecting = false

export async function connect(onSocket) {
    console.clear()

    console.log(
        chalk.cyanBright.bold(`
███████╗██╗  ██╗ ██████╗██╗     ██╗   ██╗███████╗██╗██╗   ██╗███████╗
██╔════╝╚██╗██╔╝██╔════╝██║     ██║   ██║██╔════╝██║██║   ██║██╔════╝
█████╗   ╚███╔╝ ██║     ██║     ██║   ██║███████╗██║██║   ██║█████╗
██╔══╝   ██╔██╗ ██║     ██║     ██║   ██║╚════██║██║╚██╗ ██╔╝██╔══╝
███████╗██╔╝ ██╗╚██████╗███████╗╚██████╔╝███████║██║ ╚████╔╝ ███████╗
╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝  ╚══════╝
        `)
    )

    console.log(chalk.cyanBright('\n⚡ EXCLUSIVE BOT | CONEXIÓN ÚNICA\n'))

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

    // 📡 Registrar listeners inmediatamente, incluso al reconectar.
    if (typeof onSocket === 'function') {
        onSocket(sock)
    }

    // 💾 Guardar credenciales
    sock.ev.on('creds.update', saveCreds)

    // 🔐 Elegir método de vinculación
    if (!state.creds.registered) {
        console.log(chalk.cyan('\n¿CÓMO QUIERES INICIAR SESIÓN?\n'))
        console.log('1. Código de vinculación')
        console.log('2. Código QR\n')

        const option = (await question('Selecciona (1 o 2): ')).trim()

        if (option === '1') {
            const number = (
                await question('\n📱 Número con código de país (solo números): ')
            ).replace(/\D/g, '')

            if (number.length < 8 || number.length > 15) {
                console.log(chalk.red('❌ El número no es válido.'))
            } else {
                try {
                    // Esperar a que el socket esté preparado.
                    await new Promise(resolve => setTimeout(resolve, 1500))

                    const code = await sock.requestPairingCode(number)

                    console.log(chalk.green('\n🔑 CÓDIGO DE VINCULACIÓN:\n'))
                    console.log(chalk.bold.white(code))
                    console.log(
                        chalk.gray('\nWhatsApp → Dispositivos vinculados → Vincular dispositivo → Vincular con número.')
                    )
                } catch (error) {
                    console.log(
                        chalk.red('❌ Error generando el código:'),
                        error.message
                    )
                }
            }
        } else if (option === '2') {
            console.log(
                chalk.green('\n📲 Esperando el QR de WhatsApp...\n')
            )
        } else {
            console.log(chalk.red('❌ Opción no válida.'))
        }
    } else {
        console.log(
            chalk.green('\n🔐 Sesión detectada, conectando automáticamente...\n')
        )
    }

    // 🔄 Eventos de conexión
    sock.ev.on('connection.update', async ({
        connection,
        lastDisconnect,
        qr
    }) => {
        if (qr) {
            console.log(chalk.green('\n📲 ESCANEA ESTE QR:\n'))
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'open') {
            reconnecting = false
            console.log(chalk.green('\n✅ EXCLUSIVE BOT CONECTADO\n'))

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
                chalk.red(`❌ Conexión cerrada (${reason ?? 'desconocido'})`)
            )

            if (reason === DisconnectReason.loggedOut) {
                console.log(
                    chalk.yellow(
                        '⚠️ La sesión se cerró desde WhatsApp. Borra la carpeta session y vuelve a vincular.'
                    )
                )
                return
            }

            if (reconnecting) return
            reconnecting = true

            setTimeout(async () => {
                try {
                    reconnecting = false
                    await connect(onSocket)
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

export function getSocket() {
    return currentSocket
}
