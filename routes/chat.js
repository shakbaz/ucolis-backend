// 📄 ucolis-backend/routes/chat.js
const express      = require('express');
const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');
const auth         = require('../middleware/auth');
const { createNotification } = require('../utils/notifHelper');

const router = express.Router();

// GET toutes mes conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'prenom nom photoProfil lastSeen')
      .populate('dernierMessage')   // ✅ on utilise createdAt du message pour l'horodatage
      .sort({ updatedAt: -1 });
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST créer ou retrouver une conversation
router.post('/conversations', auth, async (req, res) => {
  try {
    const { recipientId, colisId } = req.body;

    // ✅ Une seule conversation par paire d'utilisateurs — indépendant du colis
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, recipientId], $size: 2 },
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [req.user._id, recipientId],
        unreadCount:  [
          { user: req.user._id, count: 0 },
          { user: recipientId,  count: 0 },
        ],
      });
      await conversation.save();
    }

    await conversation.populate('participants', 'prenom nom photoProfil lastSeen');
    res.json(conversation);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// GET messages d'une conversation — retourne { messages, total, page }
router.get('/conversations/:id/messages', auth, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user._id,
    });
    if (!conversation) return res.status(404).json({ message: 'Conversation non trouvée' });

    const [messages, total] = await Promise.all([
      Message.find({ conversation: req.params.id })
        .populate('auteur', 'prenom nom photoProfil')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Message.countDocuments({ conversation: req.params.id }),
    ]);

    // Marquer comme lus
    await Message.updateMany(
      { conversation: req.params.id, auteur: { $ne: req.user._id } },
      { $addToSet: { luPar: req.user._id } }
    );

    // Reset unread count
    await Conversation.findByIdAndUpdate(req.params.id, {
      $set: { 'unreadCount.$[elem].count': 0 },
    }, { arrayFilters: [{ 'elem.user': req.user._id }] });

    // ✅ Retourne un objet structuré { messages, total, page }
    res.json({
      messages:   messages.reverse(),
      total,
      page:       Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST envoyer un message
router.post('/conversations/:id/messages', auth, async (req, res) => {
  try {
    const { contenu, type = 'text' } = req.body;

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user._id,
    }).populate('colis', 'titre');
    if (!conversation) return res.status(404).json({ message: 'Conversation non trouvée' });

    const message = new Message({
      conversation: req.params.id,
      auteur:   req.user._id,
      contenu,
      type,
      luPar: [req.user._id],
    });
    await message.save();
    await message.populate('auteur', 'prenom nom photoProfil');

    const otherParticipant = conversation.participants.find(
      p => p.toString() !== req.user._id.toString()
    );

    // Mettre à jour la conversation
    await Conversation.findByIdAndUpdate(req.params.id, {
      $set: { dernierMessage: message._id, updatedAt: new Date() },
      $inc: { 'unreadCount.$[elem].count': 1 },
    }, { arrayFilters: [{ 'elem.user': otherParticipant }] });

    // ✅ Notification persistée en base
    const senderName = `${req.user.prenom} ${req.user.nom}`;
    const parcelTitre = conversation.colis?.titre || 'une livraison';
    await createNotification({
      destinataire: otherParticipant,
      type:    'nouveau_message',
      titre:   `💬 Message de ${senderName}`,
      message: `${contenu.length > 60 ? contenu.substring(0, 60) + '…' : contenu}`,
      data:    {
        conversationId: req.params.id,
        parcelId:       conversation.colis?._id,
      },
    });

    // Socket.io temps réel
    const io = req.app.locals.io;
    if (io) {
      io.to(req.params.id).emit('new_message', { message });
      io.to(otherParticipant.toString()).emit('new_notification');
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;