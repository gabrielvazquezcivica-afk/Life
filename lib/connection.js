
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

const SESSIONS_DIR = path.resolve('./sessions')
const logger = pino({ level: 'silent' })

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const question = text =>
    new Promise(resolve => rl.question(text, resolve))

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms))

export const connectedSockets = new Map()

const reconnecting = new Set()

async function createConnection(sessionId) {
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

    sock.ev.on('connection.update', async ({
        connection,
        lastDisconnect,
        qr
    }) => {
        if (qr) {
            console.log(
                chalk.cyan(`\n📲 QR de la sesión: ${sessionId}`)
            )
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'connecting') {
            console.log(
                chalk.yellow(`🔄 Conectando sesión: ${sessionId}`)
            )
        }

        if (connection === 'open') {
            reconnecting.delete(sessionId)

            console.log(
                chalk.green(`✅ Sesión conectada: ${sessionId}`)
            )
        }

        if (connection === 'close') {
            const reason =
                lastDisconnect?.error?.output?.statusCode

            if (connectedSockets.get(sessionId) === sock) {
                connectedSockets.delete(sessionId)
            }

            console.log(
                chalk.red(`❌ Sesión cerrada: ${sessionId} (${reason ?? 'desconocido'})`)
            )

            if (reason === DisconnectReason.loggedOut) {
                console.log(
                    chalk.yellow(
                        `⚠️ ${sessionId} requiere vincularse nuevamente.`
                    )
                )
                return
            }

            if (reconnecting.has(sessionId)) return

            reconnecting.add(sessionId)

            setTimeout(async () => {
                reconnecting.delete(sessionId)

                // Evita duplicar una sesión que ya se reconectó.
                if (connectedSockets.has(sessionId)) return

                try {
                    await createConnection(sessionId)
                } catch (error) {
                    console.error(
                        chalk.red(`Error reconectando ${sessionId}:`),
                        error.message
                    )
                }
            }, 3000)
        }
    })

    return sock
}

function getSavedSessions() {
    if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true })
    }

    return fs.readdirSync(SESSIONS_DIR, {
        withFileTypes: true
    })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(sessionId => {
            const credsPath = path.join(
                SESSIONS_DIR,
                sessionId,
                'creds.json'
            )

            if (!fs.existsSync(credsPath)) return false

            try {
                const creds = JSON.parse(
                    fs.readFileSync(credsPath, 'utf8')
                )

                return creds.registered === true
            } catch {
                return false
            }
        })
}

async function startSavedSessions() {
    const sessions = getSavedSessions()

    for (const sessionId of sessions) {
        if (connectedSockets.has(sessionId)) continue

        try {
            await createConnection(sessionId)
        } catch (error) {
            console.error(
                chalk.red(`No se pudo iniciar ${sessionId}:`),
                error.message
            )
        }
    }

    return sessions
}

async function registerNewSession() {
    console.log(chalk.cyan('\n📱 REGISTRAR NUEVO NÚMERO\n'))

    const number = (
        await question('Número con código de país: ')
    ).replace(/\D/g, '')

    if (number.length < 8 || number.length > 15) {
        console.log(chalk.red('❌ Número no válido.'))
        return null
    }

    const sessionId = `numero_${number}`
    const sessionPath = path.join(SESSIONS_DIR, sessionId)

    if (fs.existsSync(path.join(sessionPath, 'creds.json'))) {
        try {
            const creds = JSON.parse(
                fs.readFileSync(
                    path.join(sessionPath, 'creds.json'),
                    'utf8'
                )
            )

            if (creds.registered) {
                console.log(
                    chalk.yellow(
                        '⚠️ Ese número ya tiene una sesión guardada. Usa la opción de iniciar sesiones existentes.'
                    )
                )
                return null
            }
        } catch {
            // Se permite continuar si las credenciales aún no existen
            // o están incompletas.
        }
    }

    if (connectedSockets.has(sessionId)) {
        console.log(chalk.yellow('⚠️ Esa sesión ya está activa.'))
        return null
    }

    const sock = await createConnection(sessionId)

    console.log('\n¿Cómo quieres vincular el número?')
    console.log('1. Código de vinculación')
    console.log('2. Código QR')

    const option = (
        await question('Selecciona (1 o 2): ')
    ).trim()

    if (option === '1') {
        try {
            await sleep(1500)

            const code = await sock.requestPairingCode(number)

            console.log(
                chalk.green('\n🔑 CÓDIGO DE VINCULACIÓN:')
            )
            console.log(chalk.bold.white(code))
            console.log(
                chalk.gray(
                    'Introduce este código en WhatsApp > Dispositivos vinculados.'
                )
            )
        } catch (error) {
            console.error(
                chalk.red('❌ No se pudo generar el código:'),
                error.message
            )
        }
    } else if (option === '2') {
        console.log(
            chalk.cyan(
                '\nEscanea el QR que aparecerá en la terminal.'
            )
        )
    } else {
        console.log(chalk.red('❌ Opción no válida.'))
    }

    return sock
}

export async function connect() {
    console.clear()

    fs.mkdirSync(SESSIONS_DIR, { recursive: true })

    console.log(chalk.cyan.bold(`
╔════════════════════════════════════╗
║          EXCLUSIVE BOT             ║
║       SISTEMA MULTI-SESIÓN         ║
╚════════════════════════════════════╝
`))

    const savedSessions = getSavedSessions()

    if (savedSessions.length > 0) {
        console.log(chalk.green('📂 Sesiones guardadas:\n'))

        for (const sessionId of savedSessions) {
            console.log(`  • ${sessionId}`)
        }

        console.log('\n¿Qué deseas hacer?')
        console.log('1. Iniciar con las sesiones guardadas')
        console.log('2. Registrar un número nuevo\n')

        const option = (
            await question('Selecciona (1 o 2): ')
        ).trim()

        if (option === '1') {
            await startSavedSessions()
        } else if (option === '2') {
            await startSavedSessions()
            await registerNewSession()
        } else {
            console.log(
                chalk.yellow('Opción no válida. Iniciando sesiones guardadas...')
            )
            await startSavedSessions()
        }
    } else {
        console.log(
            chalk.yellow('No hay sesiones vinculadas todavía.')
        )

        const option = (
            await question(
                '\n¿Quieres registrar el primer número? (s/n): '
            )
        ).trim().toLowerCase()

        if (option === 's' || option === 'si' || option === 'sí') {
            await registerNewSession()
        } else {
            console.log(
                chalk.yellow(
                    'No se inició ninguna sesión. Reinicia el bot para intentarlo de nuevo.'
                )
            )
        }
    }

    const firstSocket =
        connectedSockets.get('principal') ||
        connectedSockets.values().next().value ||
        null

    if (!firstSocket) {
        console.log(
            chalk.yellow(
                '⚠️ No hay una conexión activa inicializada.'
            )
        )
    }

    return firstSocket
}

export async function connectAdditional(number) {
    const phoneNumber = String(number || '').replace(/\D/g, '')

    if (phoneNumber.length < 8 || phoneNumber.length > 15) {
        throw new Error(
            'Número no válido. Incluye el código de país.'
        )
    }

    const sessionId = `numero_${phoneNumber}`
    const sessionPath = path.join(SESSIONS_DIR, sessionId)
    const credsPath = path.join(sessionPath, 'creds.json')

    if (connectedSockets.has(sessionId)) {
        throw new Error('Ese número ya tiene una sesión activa.')
    }

    if (fs.existsSync(credsPath)) {
        try {
            const creds = JSON.parse(
                fs.readFileSync(credsPath, 'utf8')
            )

            if (creds.registered) {
                throw new Error(
                    'Ese número ya tiene una sesión guardada.'
                )
            }
        } catch (error) {
            if (error.message.includes('sesión guardada')) {
                throw error
            }
        }
    }

    const sock = await createConnection(sessionId)

    try {
        await sleep(1500)

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
