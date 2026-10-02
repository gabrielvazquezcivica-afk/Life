
import config from '../config.js'

function normalizarJid(jid = '') {
    return String(jid).replace(/:\d+@/, '@').toLowerCase()
}

function obtenerIds(p = {}) {
    return [
        p.id,
        p.jid,
        p.lid,
        p.phoneNumber
    ]
        .filter(Boolean)
        .map(normalizarJid)
}

function coinciden(idsA = [], idsB = []) {
    return idsA.some(id => idsB.includes(id))
}

const handler = {
    command: ['kickall', 'eliminaratodos', 'sacaratodos'],

    run: async (sock, m) => {
        const jid = m.key.remoteJid

        if (!jid?.endsWith('@g.us')) return

        // Reaccionar a todos los que utilicen el comando.
        try {
            await sock.sendMessage(jid, {
                react: {
                    text: '😂',
                    key: m.key
                }
            })
        } catch (error) {
            console.error('[KICKALL REACTION]', error.message)
        }

        try {
            const metadata = await sock.groupMetadata(jid)
            const participantes = metadata.participants || []

            const sender =
                m.key.participant ||
                (m.key.fromMe
                    ? sock.user?.lid || sock.user?.id
                    : '')

            const usuarioInfo = participantes.find(p =>
                obtenerIds(p).includes(normalizarJid(sender))
            )

            const idsUsuario = [
                normalizarJid(sender),
                ...obtenerIds(usuarioInfo || {})
            ].filter(Boolean)

            const esAdmin =
                usuarioInfo?.admin === 'admin' ||
                usuarioInfo?.admin === 'superadmin'

            // Propietarios definidos en config.js.
            const propietarios = Array.isArray(config.OWNER_NUMBER)
                ? config.OWNER_NUMBER
                : config.OWNER_NUMBER
                    ? [config.OWNER_NUMBER]
                    : []

            const numeroSender = String(sender)
                .split('@')[0]
                .split(':')[0]
                .replace(/\D/g, '')

            const esPropietario = propietarios.some(owner => {
                const valor = Array.isArray(owner) ? owner[0] : owner
                if (!valor) return false

                const numeroOwner = String(valor).replace(/\D/g, '')

                return numeroOwner !== '' &&
                    numeroOwner === numeroSender
            })

            console.log('[KICKALL USUARIO]', {
                sender,
                participanteEncontrado: Boolean(usuarioInfo),
                admin: usuarioInfo?.admin || null,
                esAdmin,
                esPropietario
            })

            // Solo un administrador o propietario puede ejecutar la acción.
            if (!esAdmin && !esPropietario) {
                console.log('[KICKALL] Usuario sin permisos')
                return
            }

            // Identificar al bot con todos los identificadores disponibles.
            const idsBot = [
                sock.user?.id,
                sock.user?.jid,
                sock.user?.lid
            ]
                .filter(Boolean)
                .map(normalizarJid)

            const botInfo = participantes.find(p =>
                coinciden(obtenerIds(p), idsBot)
            )

            console.log('[KICKALL BOT ADMIN]', {
                botId: sock.user?.id,
                botLid: sock.user?.lid,
                participanteEncontrado: Boolean(botInfo),
                identificadores: obtenerIds(botInfo || {}),
                admin: botInfo?.admin || null
            })

            const botEsAdmin =
                botInfo?.admin === 'admin' ||
                botInfo?.admin === 'superadmin'

            if (!botInfo || !botEsAdmin) {
                console.log(
                    '[KICKALL] No se pudo confirmar que el bot sea administrador'
                )
                return
            }

            // Conservar al bot.
            const idsDelBot = obtenerIds(botInfo)

            const objetivos = participantes
                .filter(p => !coinciden(obtenerIds(p), idsDelBot))
                .map(p => p.id || p.jid)
                .filter(Boolean)

            if (!objetivos.length) {
                console.log('[KICKALL] No hay participantes que retirar')
                return
            }

            console.log(
                `[KICKALL] Intentando retirar ${objetivos.length} participantes`
            )

            const resultados = await sock.groupParticipantsUpdate(
                jid,
                objetivos,
                'remove'
            )

            console.log('[KICKALL RESULTADO]', resultados)

            let aceptados = 0

            if (Array.isArray(resultados)) {
                aceptados = resultados.filter(r =>
                    ['200', '201'].includes(String(r.status))
                ).length
            }

            await sock.sendMessage(jid, {
                text:
                    `𝐃𝐎𝐌𝐀𝐃𝐎𝐒 𝐗 𝐄𝐗𝐂𝐋𝐔𝐒𝐈𝐕𝐄\n` +
                    `> 𝘨𝘨 𝘴𝘦 𝘧𝘶𝘦𝘳𝘰𝘯 𝘥𝘰𝘮𝘢𝘥𝘰𝘴: ${aceptados}`
            })

        } catch (error) {
            console.error(
                '[KICKALL ERROR]',
                error.stack || error.message
            )
        }
    }
}

export default handler
