
import { connectAdditional } from '../lib/connection.js'

const NUMERO_BOT_AUTORIZADO = '12514487515'

function limpiarNumero(numero) {
    let limpio = String(numero || '').replace(/\D/g, '')

    // Eliminar el prefijo internacional 00
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

        // Aceptar números con espacios, símbolos y guiones.
        const numero = limpiarNumero(args.join(''))

        if (numero.length < 8 || numero.length > 15) {
            return sock.sendMessage(
                chat,
                {
                    text:
                        '📱 *Número no válido*\n\n' +
                        'Ejemplos:\n' +
                        '• .code +52 123 456 7890\n' +
                        '• .code 52-123-456-7890\n' +
                        '• .code (52) 123.456.7890\n' +
                        '• .code 00521234567890\n\n' +
                        'Incluye el código de país.'
                },
                { quoted: m }
            )
        }

        // Primer mensaje: aviso.
        const aviso = await sock.sendMessage(
            chat,
            {
                text:
                    '⏳ *Preparando código de vinculación...*\n\n' +
                    `📱 Número: ${numero}\n` +
                    'Espera un momento.'
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
            // Generar el código sin enviarlo desde connection.js.
            const resultado = await connectAdditional(numero)

            // Segundo mensaje: código separado.
            const mensajeCodigo = await sock.sendMessage(chat, {
                text:
                    '🔑 *CÓDIGO DE VINCULACIÓN*\n\n' +
                    `📱 Número: ${numero}\n` +
                    `🔐 Código: *${resultado.code}*\n\n` +
                    'Introduce el código en WhatsApp del teléfono ' +
                    'que quieres vincular.'
            })

            // Reaccionar al mensaje del código.
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
                    text:
                        '❌ *Error al generar el código*\n\n' +
                        `${error.message || 'Inténtalo de nuevo.'}`
                }
            )
        }
    }
}

export default handler
