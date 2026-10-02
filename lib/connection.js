import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys'

import pino from 'pino'
import chalk from 'chalk'
import readline from 'readline'
import qrcode from 'qrcode-terminal'

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = text =>
    new Promise(resolve => rl.question(text, resolve))

let reconnectTimer = null
let connecting = false
let currentSocket = null

export async function connect(onSocket) {
    if (connecting) return currentSocket

    connecting = true

    try {
        console.log(
            chalk.hex('#00D9FF')('\n⚡ Conexión Exclusive\n')
        )

        const { state, saveCreds } =
            await useMultiFileAuthState('./session')

        const { version } =
            await fetchLatestBaileysVersion()

        const sock = makeWASocket({
            version,

            logger: pino({
                level: 'silent'
            }),

            auth: {
                creds: state.creds,

                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({
                        level: 'silent'
                    })
                )
            },

            printQRInTerminal: false,

            // Evita que Baileys procese mensajes antiguos
            // que puedan quedar pendientes después de una reconexión.
            syncFullHistory: false
        })

        currentSocket = sock

        /*
         * Registrar handlers del socket actual.
         * Esto también se ejecutará después de una reconexión.
         */
        if (typeof onSocket === 'function') {
            onSocket(sock)
        }

        /*
         * Guardar cambios de credenciales.
         */
        sock.ev.on(
            'creds.update',
            saveCreds
        )

        /*
         * LOGIN
         */
        if (!state.creds.registered) {

            console.log(
                chalk.hex('#B388FF')(
                    '\n¿CÓMO QUIERES INICIAR SESIÓN?\n'
                )
            )

            console.log('1. Código de vinculación')
            console.log('2. Código QR\n')

            const option =
                (await question('Selecciona (1 o 2): ')).trim()

            /*
             * CÓDIGO DE VINCULACIÓN
             */
            if (option === '1') {

                const number =
                    await question(
                        '\n📱 Ingresa tu número (ej: 521234567890): '
                    )

                const cleanNumber =
                    number.replace(/\D/g, '')

                try {

                    const code =
                        await sock.requestPairingCode(
                            cleanNumber
                        )

                    console.log(
                        chalk.hex('#00FF9C')(
                            `\n🔑 Código de vinculación: ${code}\n`
                        )
                    )

                } catch (error) {

                    console.log(
                        chalk.red(
                            '❌ Error generando código:'
                        ),
                        error.message
                    )
                }
            }

            /*
             * QR
             */
            else if (option === '2') {

                sock.ev.on(
                    'connection.update',
                    ({ qr }) => {

                        if (!qr) return

                        console.log(
                            chalk.hex('#00D9FF')(
                                '\n📲 Escanea este QR:\n'
                            )
                        )

                        qrcode.generate(
                            qr,
                            {
                                small: true
                            }
                        )
                    }
                )
            }
        }

        /*
         * SESIÓN EXISTENTE
         */
        else {

            console.log(
                chalk.hex('#00FF9C')(
                    '\n🔐 Sesión detectada, conectando automáticamente...\n'
                )
            )
        }

        /*
         * ESTADO DE CONEXIÓN
         */
        sock.ev.on(
            'connection.update',
            async ({
                connection,
                lastDisconnect
            }) => {

                /*
                 * CONECTADO
                 */
                if (connection === 'open') {

                    console.log(
                        chalk.green(
                            '\n✅ EXCLUSIVE CONECTADO\n'
                        )
                    )

                    return
                }

                /*
                 * NO SE CERRÓ
                 */
                if (connection !== 'close') {
                    return
                }

                /*
                 * Obtener razón del cierre.
                 */
                const reason =
                    lastDisconnect?.error?.output?.statusCode

                console.log(
                    chalk.red(
                        `❌ Conexión cerrada (${reason ?? 'desconocido'})`
                    )
                )

                /*
                 * SESIÓN CERRADA DEFINITIVAMENTE
                 */
                if (
                    reason ===
                    DisconnectReason.loggedOut
                ) {

                    console.log(
                        chalk.yellow(
                            '⚠️ Sesión cerrada. Debes vincular el dispositivo nuevamente.'
                        )
                    )

                    return
                }

                /*
                 * Si este socket ya no es el actual,
                 * no hacemos otra reconexión desde él.
                 */
                if (currentSocket !== sock) {
                    return
                }

                /*
                 * Evitar múltiples reconexiones.
                 */
                if (reconnectTimer) {
                    return
                }

                const delay =
                    reason ===
                    DisconnectReason.restartRequired
                        ? 1000
                        : 3000

                reconnectTimer =
                    setTimeout(async () => {

                        reconnectTimer = null

                        /*
                         * El socket viejo deja de ser
                         * considerado el socket activo.
                         */
                        if (currentSocket === sock) {
                            currentSocket = null
                        }

                        try {

                            await connect(onSocket)

                        } catch (error) {

                            console.error(
                                chalk.red(
                                    '❌ Error al reconectar:'
                                ),
                                error.message
                            )
                        }

                    }, delay)
            }
        )

        return sock

    } finally {

        connecting = false
    }
}