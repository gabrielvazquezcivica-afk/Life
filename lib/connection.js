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

const question = (text) => new Promise(resolve => rl.question(text, resolve))

export async function connect() {

    console.clear()

    console.log(
        chalk.hex('#FFD700').bold(`
███████╗██╗  ██╗ ██████╗██╗     ██╗   ██╗███████╗██╗██╗   ██╗███████╗
██╔════╝╚██╗██╔╝██╔════╝██║     ██║   ██║██╔════╝██║██║   ██║██╔════╝
█████╗   ╚███╔╝ ██║     ██║     ██║   ██║███████╗██║██║   ██║█████╗
██╔══╝   ██╔██╗ ██║     ██║     ██║   ██║╚════██║██║╚██╗ ██╔╝██╔══╝
███████╗██╔╝ ██╗╚██████╗███████╗╚██████╔╝███████║██║ ╚████╔╝ ███████╗
╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝ ╚══════╝
        `)
    )

    console.log(chalk.hex('#FFD700')('\n⚡ Conexión Exclusive\n'))

    const sessionExists = fs.existsSync('./session')

    const { state, saveCreds } = await useMultiFileAuthState('./session')

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

    // 🔐 INICIO DE SESIÓN
    if (!sessionExists) {

        console.log(chalk.magenta('\n¿CÓMO QUIERES INICIAR SESIÓN?\n'))
        console.log('1. Código de vinculación')
        console.log('2. Código QR\n')

        const option = await question('Selecciona (1 o 2): ')

        // 🔑 CÓDIGO DE VINCULACIÓN
        if (option === '1') {

            const number = await question(
                '\n📱 Ingresa tu número (ej: 521234567890): '
            )

            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(number)
                    console.log(
                        chalk.green(`\n🔑 Código de vinculación: ${code}\n`)
                    )
                } catch (err) {
                    console.log(
                        chalk.red('❌ Error generando código'),
                        err
                    )
                }
            }, 3000)
        }

        // 📲 CÓDIGO QR
        if (option === '2') {
            sock.ev.on('connection.update', ({ qr }) => {
                if (qr) {
                    console.log(chalk.green('\n📲 Escanea este QR:\n'))
                    qrcode.generate(qr, { small: true })
                }
            })
        }

    } else {
        console.log(
            chalk.green(
                '\n🔐 Sesión detectada, conectando automáticamente...\n'
            )
        )
    }

    // 📡 ESTADO DE CONEXIÓN
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
            console.log(chalk.green('\n✅ EXCLUSIVE CONECTADO CON ÉXITO\n'))
            rl.close()
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(
                chalk.red(`❌ Conexión cerrada (${reason})`)
            )
        }
    })

    // 💾 GUARDAR DATOS DE SESIÓN
    sock.ev.on('creds.update', saveCreds)

    return sock
}