
import { connectAdditional } from '../lib/connection.js'

const NUMERO_BOT_AUTORIZADO = '12514487515'

function limpiarNumero(numero) {
    return String(numero || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '')
}

function esBotAutorizado(sock) {
    const identificador = sock.user?.id || ''
    const numero = limpiarNumero(identificador)

    return (
        numero === NUMERO_BOT_AUTORIZADO ||
        numero === `1${NUMERO_BOT_AUTORIZADO}`
    )
}

const handler = {
    command: ['code'],
    help: ['code <numero>'],
    tags: ['herramientas'],
    menu: true,

    run: async (sock, m, args) => {
        // Los demás bots no responden.
        if (!esBotAutorizado(sock)) return

        const chat = m.key.remoteJid
        const numero = args.join('').replace(/\D/g, '')

        if (!numero || numero.length < 8 || numero.length > 15) {
            return sock.sendMessage(
                chat,
                {
                    text: '📱 Usa el comando así:\n.code 521XXXXXXXXXX\n\nIncluye el código de país.'
                },
                { quoted: m }
            )
        }

        // Primer mensaje: aviso.
        const aviso = await sock.sendMessage(
            chat,
            {
                text: '⏳ Preparando el código de vinculación...\n\nEspera un momento.'
            },
            { quoted: m }
        )

        await sock.sendMessage(chat, {
            react: {
                text: '⏳',
                key: aviso.key
            }
        })

        try {
            const resultado = await connectAdditional(numero)

            // Segundo mensaje: código separado.
            const mensajeCodigo = await sock.sendMessage(
                chat,
                {
                    text:
                        `🔑 *CÓDIGO DE VINCULACIÓN*\n\n` +
                        `📱 Número: ${numero}\n` +
                        `🔐 Código: *${resultado.code}*\n\n` +
                        `Ingresa el código en el teléfono que quieres vincular.`
                }
            )

            // Reacción al mensaje que contiene el código.
            await sock.sendMessage(chat, {
                react: {
                    text: '🔑',
                    key: mensajeCodigo.key
                }
            })
        } catch (error) {
            await sock.sendMessage(
                chat,
                {
                    text: `❌ No se pudo generar el código.\n\n${error.message}`
                }
            )
        }
    }
}

export default handler
