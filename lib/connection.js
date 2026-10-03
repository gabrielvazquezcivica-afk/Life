
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

const logger = pino({ level: 'silent' })

let currentSocket = null
let reconnectTimer = null
let connecting = false
let activeOnSocket = null
let loggedOut = false

export async function connect(onSocket) {
  if (typeof onSocket === 'function') {
    activeOnSocket = onSocket
  }

  if (connecting) return currentSocket

  connecting = true

  try {
    console.log(chalk.cyan('\n⚡ Iniciando Tibu Bot...\n'))

    const { state, saveCreds } =
      await useMultiFileAuthState('./session')

    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
      version,
      logger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      printQRInTerminal: false,
      syncFullHistory: false
    })

    currentSocket = sock
    loggedOut = false

    sock.ev.on('creds.update', saveCreds)

    // Registrar los eventos de mensajes en este socket.
    if (typeof activeOnSocket === 'function') {
      activeOnSocket(sock)
    }

    if (!state.creds.registered) {
      console.log(chalk.magenta('\n¿Cómo quieres iniciar sesión?\n'))
      console.log('1. Código de vinculación')
      console.log('2. Código QR\n')

      const option = (await question('Selecciona (1 o 2): ')).trim()

      if (option === '1') {
        const number = await question(
          '\n📱 Ingresa tu número con código de país: '
        )

        try {
          const code = await sock.requestPairingCode(
            number.replace(/\D/g, '')
          )

          console.log(chalk.green(`\n🔑 Código: ${code}\n`))
        } catch (error) {
          console.error('Error generando código:', error)
        }
      } else if (option === '2') {
        sock.ev.on('connection.update', ({ qr }) => {
          if (!qr) return

          console.log(chalk.cyan('\n📲 Escanea el QR:\n'))
          qrcode.generate(qr, { small: true })
        })
      }
    } else {
      console.log(chalk.green('\n🔐 Sesión existente detectada\n'))
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        console.log(chalk.green('\n✅ TIBU BOT CONECTADO\n'))
        return
      }

      if (connection !== 'close') return

      // Ignorar cierres de sockets antiguos.
      if (currentSocket !== sock) return

      currentSocket = null

      const statusCode =
        lastDisconnect?.error?.output?.statusCode

      console.log(
        chalk.yellow(
          `Conexión cerrada. Código: ${statusCode ?? 'desconocido'}`
        )
      )

      if (statusCode === DisconnectReason.loggedOut) {
        loggedOut = true
        console.log(
          chalk.red('La sesión se cerró. Debes vincular WhatsApp nuevamente.')
        )
        return
      }

      if (reconnectTimer || loggedOut) return

      const delay =
        statusCode === DisconnectReason.restartRequired
          ? 1000
          : 3000

      reconnectTimer = setTimeout(async () => {
        reconnectTimer = null

        try {
          await connect(activeOnSocket)
        } catch (error) {
          console.error(chalk.red('Error al reconectar:'), error)
        }
      }, delay)
    })

    return sock
  } finally {
    connecting = false
  }
}
