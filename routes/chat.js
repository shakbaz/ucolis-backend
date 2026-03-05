const express      = require('express');
const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');
const auth         = require('../middleware/auth');

const router = express.Router();

// GET toutes mes conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id,
    })
      .populate('participants', 'prenom nom photoProfil lastSeen')
      .populate('dernierMessage')
      .populate('colis', 'titre wilayaDepart wilayaArrivee statut photos')
      .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// GET ou créer une conversation entre deux utilisateurs
router.post('/conversations', auth, async (req, res) => {
  try {
    const { recipientId, colisId } = req.body;

    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, recipientId] },
      colis: colisId || null,
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [req.user._id, recipientId],
        colis: colisId || null,
        unreadCount: [
          { user: req.user._id, count: 0 },
          { user: recipientId,  count: 0 },
        ],
      });
      await conversation.save();
    }

    await conversation.populate('participants', 'prenom nom photoProfil lastSeen');
    await conversation.populate('colis', 'titre wilayaDepart wilayaArrivee statut photos');
    res.json(conversation);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// GET messages d'une conversation
router.get('/conversations/:id/messages', auth, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user._id,
    });
    if (!conversation) return res.status(404).json({ message: 'Conversation non trouvée' });

    const messages = await Message.find({ conversation: req.params.id })
      .populate('auteur', 'prenom nom photoProfil')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Marquer comme lus
    await Message.updateMany(
      { conversation: req.params.id, auteur: { $ne: req.user._id } },
      { $addToSet: { luPar: req.user._id } }
    );

    // Reset unread count
    await Conversation.findByIdAndUpdate(req.params.id, {
      $set: { 'unreadCount.$[elem].count': 0 },
    }, {
      arrayFilters: [{ 'elem.user': req.user._id }],
    });

    res.json(messages.reverse());
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
    });
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

    // Mettre à jour la conversation
    const otherParticipant = conversation.participants.find(
      p => p.toString() !== req.user._id.toString()
    );
    await Conversation.findByIdAndUpdate(req.params.id, {
      $set: { dernierMessage: message._id, updatedAt: new Date() },
      $inc: { 'unreadCount.$[elem].count': 1 },
    }, {
      arrayFilters: [{ 'elem.user': otherParticipant }],
    });

    // Émettre via Socket.io
    const io = req.app.locals.io;
    if (io) {
      io.to(req.params.id).emit('new_message', { message });
      io.to(otherParticipant.toString()).emit('notification', {
        type: 'new_message',
        conversationId: req.params.id,
        senderId: req.user._id,
        senderName: `${req.user.prenom} ${req.user.nom}`,
      });
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
