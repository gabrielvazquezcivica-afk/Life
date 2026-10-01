
import { connectAdditional } from '../lib/connection.js'

const NUMERO_BOT_AUTORIZADO = '12514487515'

function limpiarNumero(numero) {
    let limpio = String(numero || '').replace(/\D/g, '')

    if (limpio.startsWith('00')) {
        limpio = limpio.slice(2)
    }

    return limpio
}

function esBotAutorizado(sock) {
    const identificador = sock.user?.id || ''
    const numeroBot = limpiarNumero(
        identificador.split('@')[0].split(':')[0]
    )

    return (
        numeroBot === NUMERO_BOT_AUTORIZADO ||
        numeroBot === `1${NUMERO_BOT_AUTORIZADO}`
    )
}

const handler = {
    command: ['code'],
    help: ['code <numero>'],
    tags: ['herramientas'],
    menu: true,

    run: async (sock, m, args) => {
        // Solo responde el bot autorizado.
        if (!esBotAutorizado(sock)) return

        const chat = m.key.remoteJid
        const numero = limpiarNumero(args.join(''))

        // Reaccionar al mensaje original del comando.
        await sock.sendMessage(chat, {
            react: {
                text: '⏳',
                key: m.key
            }
        })

        if (numero.length < 8 || numero.length > 15) {
            return sock.sendMessage(
                chat,
                {
                    text: 'Número no válido. Usa .code +52 123 456 7890'
                },
                { quoted: m }
            )
        }

        // Aviso por separado.
        await sock.sendMessage(
            chat,
            {
                text: '⏳ Preparando código...'
            },
            { quoted: m }
        )

        try {
            const resultado = await connectAdditional(numero)

            // Enviar exclusivamente el código, sin texto adicional.
            await sock.sendMessage(chat, {
                text: String(resultado.code).replace(/\s+/g, '')
            })

        } catch (error) {
            await sock.sendMessage(
                chat,
                {
                    text: `❌ Error: ${error.message || 'No se pudo generar el código.'}`
                },
                { quoted: m }
            )
        }
    }
}

export default handler
