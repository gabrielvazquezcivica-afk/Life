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

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = text =>
    new Promise(resolve => rl.question(text, resolve))

let reconnectTimer = null
let connecting = false

export async function connect(onSocket) {
    if (connecting) return
    connecting = true

    try {
        console.log(chalk.hex('#00D9FF')('\n⚡ Conexión Exclusive\n'))

        const { state, saveCreds } =
            await useMultiFileAuthState('./session')

        const { version } = await fetchLatestBaileysVersion()

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: 'silent' })
                )
            },
            printQRInTerminal: false
        })

        // Registrar los mensajes en cada socket, incluso tras reconectar.
        if (typeof onSocket === 'function') {
            onSocket(sock)
        }

        sock.ev.on('creds.update', saveCreds)

        if (!state.creds.registered) {
            console.log(
                chalk.hex('#B388FF')('\n¿CÓMO QUIERES INICIAR SESIÓN?\n')
            )
            console.log('1. Código de vinculación')
            console.log('2. Código QR\n')

            const option = await question('Selecciona (1 o 2): ')

            if (option === '1') {
                const number = await question(
                    '\n📱 Ingresa tu número (ej: 521234567890): '
                )

                try {
                    const code = await sock.requestPairingCode(
                        number.replace(/\D/g, '')
                    )

                    console.log(
                        chalk.hex('#00FF9C')(
                            `\n🔑 Código de vinculación: ${code}\n`
                        )
                    )
                } catch (error) {
                    console.log(
                        chalk.red('❌ Error generando código:'),
                        error.message
                    )
                }
            } else if (option === '2') {
                sock.ev.on('connection.update', ({ qr }) => {
                    if (!qr) return

                    console.log(
                        chalk.hex('#00D9FF')('\n📲 Escanea este QR:\n')
                    )

                    qrcode.generate(qr, { small: true })
                })
            }
        } else {
            console.log(
                chalk.hex('#00FF9C')(
                    '\n🔐 Sesión detectada, conectando automáticamente...\n'
                )
            )
        }

        sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
            if (connection === 'open') {
                console.log(chalk.green('\n✅ EXCLUSIVE CONECTADO\n'))

                if (rl.listenerCount('line') >= 0) {
                    // No cerrar readline aquí: puede ser necesario
                    // para completar el inicio de sesión.
                }
            }

            if (connection !== 'close') return

            const reason =
                lastDisconnect?.error?.output?.statusCode

            console.log(
                chalk.red(`❌ Conexión cerrada (${reason ?? 'desconocido'})`)
            )

            if (reason === DisconnectReason.loggedOut) {
                console.log(
                    chalk.yellow(
                        '⚠️ Sesión cerrada. Debes vincular el dispositivo nuevamente.'
                    )
                )
                return
            }

            if (reconnectTimer) return

            const delay =
                reason === DisconnectReason.restartRequired ? 1000 : 3000

            reconnectTimer = setTimeout(async () => {
                reconnectTimer = null

                try {
                    await connect(onSocket)
                } catch (error) {
                    console.error(
                        chalk.red('❌ Error al reconectar:'),
                        error.message
                    )
                }
            }, delay)
        })

        return sock
    } finally {
        connecting = false
    }
}
