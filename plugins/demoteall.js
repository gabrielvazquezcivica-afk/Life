
export default {
  name: 'demoteall',
  alias: ['quitaradmins', 'demotetodos'],
  category: 'group',
  description: 'Quita los administradores del grupo',

  async execute(sock, m, args, config) {
    const jid = m.key.remoteJid;

    const react = async (emoji) => {
      await sock.sendMessage(jid, {
        react: { text: emoji, key: m.key }
      }).catch(() => {});
    };

    try {
      if (!jid.endsWith('@g.us')) {
        return await react('😂');
      }

      const metadata = await sock.groupMetadata(jid);
      const sender = m.key.participant || m.key.remoteJid;
      const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';

      const normalize = (id = '') =>
        id.replace(/:\d+/, '').split('@')[0];

      const senderIsAdmin = metadata.participants.some(p =>
        [p.id, p.jid, p.lid].filter(Boolean).some(
          id => normalize(id) === normalize(sender)
        ) && (p.admin === 'admin' || p.admin === 'superadmin')
      );

      if (!senderIsAdmin) {
        return await react('😂');
      }

      const botParticipant = metadata.participants.find(p =>
        [p.id, p.jid, p.lid].filter(Boolean).some(
          id => normalize(id) === normalize(botJid)
        )
      );

      if (!botParticipant?.admin) {
        return await react('😂');
      }

      const targets = metadata.participants
        .filter(p =>
          (p.admin === 'admin') &&
          ![p.id, p.jid, p.lid].filter(Boolean).some(
            id => normalize(id) === normalize(sender) ||
                  normalize(id) === normalize(botJid)
          )
        )
        .map(p => p.id)
        .filter(Boolean);

      if (targets.length > 0) {
        await sock.groupParticipantsUpdate(jid, targets, 'demote');
      }

      await react('👾');
    } catch (error) {
      await react('😂');
    }
  }
};
