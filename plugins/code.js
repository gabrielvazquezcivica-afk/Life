
import config from '../config.js'
import { connectAdditional } from '../lib/connection.js'

// 🧹 LIMPIAR NÚMERO
function limpiarNumero(numero) {
    return String(numero || '').replace(/\D/g, '')
}

const handler = {
    command: ['code'],
    help: ['code <numero>'],
    tags: ['owner'],
    menu: true,

    run: async (sock, m, args) => {
        const chat = m.key.remoteJid

        // 🔐 VERIFICAR PROPIETARIO
        const ownerNumbers = (config.owner || [])
            .filter(Boolean)
            .map(limpiarNumero)

        const ownerLids = (config.ownerLid || [])
            .filter(Boolean)
            .map(limpiarNumero)

        const senderJid = String(
            m.key.participant || m.key.remoteJid || ''
        )

        const senderDigits = limpiarNumero(
            senderJid.split('@')[0].split(':')[0]
        )

        const isOwner =
            (
                senderJid.endsWith('@s.whatsapp.net') &&
                ownerNumbers.includes(senderDigits)
            ) ||
            (
                senderJid.endsWith('@lid') &&
                ownerLids.includes(senderDigits)
            )

        if (!isOwner) {
            return sock.sendMessage(chat, {
                text: '⛔ Este comando solo puede usarlo el propietario.'
            }, { quoted: m })
        }

        // 📱 LIMPIAR NÚMERO
        const number = limpiarNumero(args.join(''))

        if (number.length < 8 || number.length > 15) {
            return sock.sendMessage(chat, {
                text:
                    '📱 *EXCLUSIVE BOT — VINCULAR NÚMERO*\n\n' +
                    'Escribe el número con código de país.\n\n' +
                    '*Ejemplos:*\n' +
                    '• `.code +52 123 456 7890`\n' +
                    '• `.code +52 (123) 456-7890`\n' +
                    '• `.code 521234567890`\n\n' +
                    'El número se limpiará automáticamente.'
            }, { quoted: m })
        }

        // ⏳ AVISAR
        await sock.sendMessage(chat, {
            text:
                '🔐 *EXCLUSIVE BOT — VINCULACIÓN*\n\n' +
                `📱 Número limpio: ${number}\n` +
                '⏳ Generando código de vinculación...'
        }, { quoted: m })

        try {
            await connectAdditional(number, sock, chat)
        } catch (error) {
            await sock.sendMessage(chat, {
                text: `❌ Error: ${error.message}`
            }, { quoted: m })
        }
    }
}

export default handler
