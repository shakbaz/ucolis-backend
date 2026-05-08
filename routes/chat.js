// 📄 ucolis-backend/routes/chat.js
const express      = require('express');
const Conversation = require('../models/Conversation');
const Message      = require('../models/Message');
const auth         = require('../middleware/auth');
const { createNotification } = require('../utils/notifHelper');
const { uploadPhoto, uploadToCloudinary } = require('../middleware/upload');

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

// GET une conversation par son ID
router.get('/conversations/:id', auth, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id:          req.params.id,
      participants: req.user._id,
    })
      .populate('participants', 'prenom nom photoProfil')
      .populate('colis', 'titre statut')
      .populate('dernierMessage');
    if (!conversation) return res.status(404).json({ message: 'Conversation non trouvée' });
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// GET messages d'une conversation — retourne { messages, total, page }
router.get('/conversations/:id/messages', auth, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const safeLimit = Math.min(Number(limit), 100);
    const skip = (Number(page) - 1) * safeLimit;

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
        .limit(safeLimit),
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

    // Incrémenter atomiquement si l'entrée existe déjà (opérateur positionnel $)
    const convUpdated = await Conversation.findOneAndUpdate(
      { _id: req.params.id, 'unreadCount.user': otherParticipant },
      {
        $set: { dernierMessage: message._id, updatedAt: new Date() },
        $inc: { 'unreadCount.$.count': 1 },
      },
      { new: true }
    );
    // Si l'entrée n'existait pas encore, l'ajouter avec count: 1 en une seule opération
    if (!convUpdated) {
      await Conversation.findByIdAndUpdate(req.params.id, {
        $set:  { dernierMessage: message._id, updatedAt: new Date() },
        $push: { unreadCount: { user: otherParticipant, count: 1 } },
      });
    }

    const io = req.app.locals.io;

    // Émettre le message à toute la room
    if (io) io.to(req.params.id).emit('new_message', { message });

    // ✅ Vérifier si l'AUTRE participant est actuellement dans la room conversation
    // (ChatScreen ouvert chez lui). On vérifie l'identité réelle des sockets, pas
    // simplement la taille de la room — un socket fantôme du sender ne doit pas
    // faussement déclencher l'auto-mark-as-read.
    let otherIsInConversation = false;
    if (io) {
      try {
        const sockets = await io.in(req.params.id).fetchSockets();
        const otherIdStr = otherParticipant.toString();
        otherIsInConversation = sockets.some(
          s => s.data?.user?.userId?.toString() === otherIdStr
        );
      } catch (_) {}
    }

    // ✅ Si le destinataire a la discussion ouverte → marquer auto comme lu
    //    et émettre messages_read en temps réel pour passer "Distribué" → "Lu"
    if (otherIsInConversation) {
      await Message.updateOne(
        { _id: message._id },
        { $addToSet: { luPar: otherParticipant } }
      );
      await Conversation.findByIdAndUpdate(req.params.id, {
        $set: { 'unreadCount.$[elem].count': 0 },
      }, { arrayFilters: [{ 'elem.user': otherParticipant }] });

      if (io) {
        const readAt = new Date().toISOString();
        // Émettre vers la room conversation (ChatScreen de l'expéditeur)
        io.to(req.params.id).emit('messages_read', {
          conversationId: req.params.id,
          readBy: otherParticipant,
          readAt,
        });
        // Émettre vers la room user du lecteur (badge + ConversationsScreen)
        io.to(otherParticipant.toString()).emit('messages_read', {
          conversationId: req.params.id,
          readBy: otherParticipant,
          readAt,
        });
      }
    } else {
      // Créer notif DB uniquement si l'autre n'a PAS la discussion ouverte
      const senderName = `${req.user.prenom} ${req.user.nom}`;
      const Notification = require('../models/Notification');
      const previewContenu = contenu.length > 60 ? contenu.substring(0, 60) + '…' : contenu;

      // findOneAndUpdate avec upsert = atomique, élimine la race condition créant des doublons
      await Notification.findOneAndUpdate(
        {
          destinataire: otherParticipant,
          type:         'nouveau_message',
          lu:           false,
          'data.conversationId': req.params.id,
        },
        {
          $set: {
            titre:     `💬 ${senderName}`,
            message:   previewContenu,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            data: {
              conversationId: req.params.id,
              parcelId:       conversation.colis?._id ?? null,
            },
          },
        },
        { upsert: true }
      );

      // Émettre new_notification UNIQUEMENT si l'autre n'est pas dans la conv
      // (sinon le badge clignote brièvement avant le reset)
      if (io) io.to(otherParticipant.toString()).emit('new_notification', { conversationId: req.params.id });
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});


// PATCH marquer les messages comme lus — temps réel
router.patch('/conversations/:id/read', auth, async (req, res) => {
  try {
    // Marquer tous les messages non lus par moi comme lus
    await Message.updateMany(
      { conversation: req.params.id, luPar: { $ne: req.user._id } },
      { $addToSet: { luPar: req.user._id } }
    );

    // Reset unread count
    await Conversation.findByIdAndUpdate(req.params.id, {
      $set: { 'unreadCount.$[elem].count': 0 },
    }, { arrayFilters: [{ 'elem.user': req.user._id }] });

    // Notifier l'autre participant en temps réel
    const conv = await Conversation.findById(req.params.id);
    const other = conv?.participants?.find(p => p.toString() !== req.user._id.toString());
    const io = req.app.locals.io;
    if (io) {
      // Émettre vers la room conversation (pour ChatScreen de l'expéditeur)
      const readAt = new Date().toISOString();
      io.to(req.params.id).emit('messages_read', {
        conversationId: req.params.id,
        readBy: req.user._id,
        readAt,
      });
      // ✅ Émettre aussi vers la room userId du lecteur
      // pour que ConversationsScreen mette à jour le badge sans rechargement
      io.to(req.user._id.toString()).emit('messages_read', {
        conversationId: req.params.id,
        readBy: req.user._id,
        readAt,
      });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST envoyer une image dans une conversation
router.post('/conversations/:id/messages/image', auth, uploadPhoto, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Image requise' });

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user._id,
    }).populate('colis', 'titre');
    if (!conversation) return res.status(404).json({ message: 'Conversation non trouvée' });

    const result = await uploadToCloudinary(req.file.buffer, 'ucolis/chat', {
      transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
    });

    const message = new Message({
      conversation: req.params.id,
      auteur:   req.user._id,
      contenu:  result.secure_url,
      type:     'image',
      luPar:    [req.user._id],
    });
    await message.save();
    await message.populate('auteur', 'prenom nom photoProfil');

    const otherParticipant = conversation.participants.find(
      p => p.toString() !== req.user._id.toString()
    );

    // Mise à jour unreadCount (même logique atomique que pour les textes)
    const convUpdated = await Conversation.findOneAndUpdate(
      { _id: req.params.id, 'unreadCount.user': otherParticipant },
      {
        $set: { dernierMessage: message._id, updatedAt: new Date() },
        $inc: { 'unreadCount.$.count': 1 },
      },
      { new: true }
    );
    if (!convUpdated) {
      await Conversation.findByIdAndUpdate(req.params.id, {
        $set:  { dernierMessage: message._id, updatedAt: new Date() },
        $push: { unreadCount: { user: otherParticipant, count: 1 } },
      });
    }

    const io = req.app.locals.io;
    if (io) io.to(req.params.id).emit('new_message', { message });

    let otherIsInConversation = false;
    if (io) {
      try {
        const sockets = await io.in(req.params.id).fetchSockets();
        const otherIdStr = otherParticipant.toString();
        otherIsInConversation = sockets.some(
          s => s.data?.user?.userId?.toString() === otherIdStr
        );
      } catch (_) {}
    }

    if (otherIsInConversation) {
      await Message.updateOne({ _id: message._id }, { $addToSet: { luPar: otherParticipant } });
      await Conversation.findByIdAndUpdate(req.params.id, {
        $set: { 'unreadCount.$[elem].count': 0 },
      }, { arrayFilters: [{ 'elem.user': otherParticipant }] });

      if (io) {
        const readAt = new Date().toISOString();
        io.to(req.params.id).emit('messages_read', { conversationId: req.params.id, readBy: otherParticipant, readAt });
        io.to(otherParticipant.toString()).emit('messages_read', { conversationId: req.params.id, readBy: otherParticipant, readAt });
      }
    } else {
      const senderName = `${req.user.prenom} ${req.user.nom}`;
      const Notification = require('../models/Notification');
      await Notification.findOneAndUpdate(
        { destinataire: otherParticipant, type: 'nouveau_message', lu: false, 'data.conversationId': req.params.id },
        {
          $set: { titre: `💬 ${senderName}`, message: '📷 Image', updatedAt: new Date() },
          $setOnInsert: { data: { conversationId: req.params.id, parcelId: conversation.colis?._id ?? null } },
        },
        { upsert: true }
      );
      if (io) io.to(otherParticipant.toString()).emit('new_notification', { conversationId: req.params.id });
    }

    res.status(201).json(message);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;