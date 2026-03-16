// 📄 ucolis-backend/routes/offers.js

const express      = require('express');
const Offer        = require('../models/Offer');
const Parcel       = require('../models/Parcel');
const Notification = require('../models/Notification');
const auth         = require('../middleware/auth');
const { OFFER_STATUS }  = require('../models/Offer');
const { PARCEL_STATUS } = require('../models/Parcel');

const router = express.Router();

// ── Helper : créer une notification ──────────────────────────────────────────
async function notify(io, { destinataire, type, titre, message, parcelId, offerId, userId }) {
  try {
    const notif = await Notification.create({
      destinataire, type, titre, message,
      data: { parcelId: parcelId || null, offerId: offerId || null, userId: userId || null },
    });
    if (io) {
      io.to(destinataire.toString()).emit('notification', notif);
    }
  } catch (_e) { /* ne pas bloquer la réponse */ }
}

// ── GET /offers/parcel/:parcelId — offres d'un colis ─────────────────────────
router.get('/parcel/:parcelId', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ colis: req.params.parcelId })
      .populate('transporteur', 'prenom nom photoProfil wilaya moyenne totalAvis typeCompte documents')
      .sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ── GET /offers/my-offers — offres du transporteur connecté ──────────────────
router.get('/my-offers', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ transporteur: req.user._id })
      .populate('colis')
      .populate('transporteur', 'prenom nom photoProfil wilaya moyenne')
      .sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ── POST /offers — soumettre une offre ───────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { colisId, prixPropose, message } = req.body;

    const parcel = await Parcel.findById(colisId).populate('expediteur', 'prenom nom');
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    // Accepter DISPONIBLE et EN_NEGOCIATION, mais bloquer si un transporteur a déjà été accepté
    const statutsAutorisés = [PARCEL_STATUS.DISPONIBLE, PARCEL_STATUS.EN_NEGOCIATION];
    if (!statutsAutorisés.includes(parcel.statut)) {
      return res.status(400).json({ message: 'Ce colis n\'est plus disponible' });
    }
    if (parcel.transporteurAccepte) {
      return res.status(400).json({ message: 'Un transporteur a déjà été sélectionné pour ce colis' });
    }

    if (parcel.expediteur._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Vous ne pouvez pas faire une offre sur votre propre colis' });
    }

    const existingOffer = await Offer.findOne({
      colis: colisId,
      transporteur: req.user._id,
      statut: OFFER_STATUS.EN_ATTENTE,
    });
    if (existingOffer) {
      return res.status(400).json({ message: 'Vous avez déjà une offre en attente sur ce colis' });
    }

    const offer = await Offer.create({ colis: colisId, transporteur: req.user._id, prixPropose, message });
    await offer.populate('transporteur', 'prenom nom photoProfil wilaya moyenne totalAvis typeCompte');

    // Mettre le colis en négociation
    if (parcel.statut === PARCEL_STATUS.DISPONIBLE) {
      parcel.statut = PARCEL_STATUS.EN_NEGOCIATION;
      await parcel.save();
    }

    const io = req.app.locals.io;

    // ✅ Message différent selon acceptation directe ou négociation
    const isAcceptDirect = req.body.acceptationDirecte === true;
    await notify(io, {
      destinataire: parcel.expediteur._id,
      type:    'nouvelle_offre',
      titre:   isAcceptDirect ? '🙋 Un transporteur est disponible !' : 'Nouvelle offre reçue',
      message: isAcceptDirect
        ? `${req.user.prenom} ${req.user.nom} accepte de livrer votre colis au prix demandé de ${prixPropose} DZD. Confirmez-le !`
        : `${req.user.prenom} ${req.user.nom} vous propose ${prixPropose} DZD pour votre colis.`,
      parcelId: parcel._id,
      offerId:  offer._id,
    });

    res.status(201).json(offer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ── PATCH /offers/:id/accept — expéditeur accepte une offre ──────────────────
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const offer  = await Offer.findById(req.params.id).populate('colis').populate('transporteur', 'prenom nom');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    const parcel = await Parcel.findById(offer.colis._id).populate('expediteur', 'prenom nom');
    if (parcel.expediteur._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    offer.statut = OFFER_STATUS.ACCEPTE;
    await offer.save();

    // Récupérer les autres offres AVANT de les refuser pour avoir les transporteurs
    const otherOffers = await Offer.find({
      colis: parcel._id,
      _id: { $ne: offer._id },
      statut: { $nin: [OFFER_STATUS.REFUSE, OFFER_STATUS.ANNULE] },
    }).populate('transporteur', 'prenom nom expoPushToken');

    // Refuser les autres offres
    await Offer.updateMany(
      { colis: parcel._id, _id: { $ne: offer._id } },
      { $set: { statut: OFFER_STATUS.REFUSE } }
    );

    // Mettre à jour le colis → statut ACCEPTE
    parcel.statut              = PARCEL_STATUS.ACCEPTE;
    parcel.transporteurAccepte = offer.transporteur._id;
    parcel.prixFinal           = offer.prixPropose;
    await parcel.save();

    // Créer conversation automatiquement
    try {
      const Conversation = require('../models/Conversation');
      // ✅ Chercher conversation existante entre ces deux users (peu importe le colis)
      let conv = await Conversation.findOne({
        participants: { $all: [parcel.expediteur._id, offer.transporteur._id], $size: 2 },
      });
      if (!conv) {
        conv = await Conversation.create({
          participants: [parcel.expediteur._id, offer.transporteur._id],
          colis: parcel._id,
          unreadCount: [
            { user: parcel.expediteur._id,   count: 0 },
            { user: offer.transporteur._id,  count: 0 },
          ],
        });
      } else {
        conv.colis = parcel._id;
        // S'assurer que unreadCount existe pour les deux participants
        if (!conv.unreadCount || conv.unreadCount.length < 2) {
          conv.unreadCount = [
            { user: parcel.expediteur._id,  count: 0 },
            { user: offer.transporteur._id, count: 0 },
          ];
        }
        await conv.save();
      }
      // Notifier avec conversationId
      const io = req.app.locals.io;
      await notify(io, {
        destinataire: offer.transporteur._id,
        type:    'offre_acceptee',
        titre:   '🎉 Offre acceptée !',
        message: `${parcel.expediteur.prenom} a accepté votre offre de ${offer.prixPropose} DZD.`,
        parcelId: parcel._id,
        offerId:  offer._id,
      });

      // Notifier chaque transporteur refusé
      for (const refused of otherOffers) {
        if (!refused.transporteur?._id) continue;
        await notify(io, {
          destinataire: refused.transporteur._id,
          type:    'offre_refusee',
          titre:   '❌ Offre non retenue',
          message: `L'expéditeur a choisi un autre transporteur pour le colis "${parcel.titre}".`,
          parcelId: parcel._id,
          offerId:  refused._id,
        });
      }
    } catch (_e) { /* ignore conversation error */ }

    res.json({ offer, parcel });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ── PATCH /offers/:id/reject — expéditeur refuse une offre ───────────────────
router.patch('/:id/reject', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id).populate('colis').populate('transporteur', 'prenom nom');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    const parcel = await Parcel.findById(offer.colis._id).populate('expediteur', 'prenom nom');
    if (parcel.expediteur._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    offer.statut = OFFER_STATUS.REFUSE;
    await offer.save();

    const io = req.app.locals.io;
    await notify(io, {
      destinataire: offer.transporteur._id,
      type:    'offre_refusee',
      titre:   'Offre refusée',
      message: `${parcel.expediteur.prenom} a refusé votre offre.`,
      parcelId: parcel._id,
      offerId:  offer._id,
    });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ── PATCH /offers/:id/counter — expéditeur fait une contre-offre ─────────────
router.patch('/:id/counter', auth, async (req, res) => {
  try {
    const { prix, message } = req.body;
    if (!prix || prix < 100) return res.status(400).json({ message: 'Prix invalide' });

    const offer = await Offer.findById(req.params.id).populate('colis').populate('transporteur', 'prenom nom');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    const parcel = await Parcel.findById(offer.colis._id).populate('expediteur', 'prenom nom');
    if (parcel.expediteur._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    if (offer.statut !== OFFER_STATUS.EN_ATTENTE) {
      return res.status(400).json({ message: 'Cette offre ne peut plus être négociée' });
    }

    offer.statut      = OFFER_STATUS.CONTRE_OFFRE;
    offer.contreOffre = { prix, message: message || '' };
    await offer.save();

    const io = req.app.locals.io;
    await notify(io, {
      destinataire: offer.transporteur._id,
      type:    'contre_offre',
      titre:   '💬 Contre-offre reçue',
      message: `${parcel.expediteur.prenom} vous propose ${prix} DZD.`,
      parcelId: parcel._id,
      offerId:  offer._id,
    });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── PATCH /offers/:id/accept-counter — transporteur accepte la contre-offre ──
router.patch('/:id/accept-counter', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id).populate('colis').populate('transporteur', 'prenom nom');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    if (offer.transporteur._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    if (offer.statut !== OFFER_STATUS.CONTRE_OFFRE) {
      return res.status(400).json({ message: 'Aucune contre-offre à accepter' });
    }

    const parcel = await Parcel.findById(offer.colis._id).populate('expediteur', 'prenom nom');

    // Accepter au prix de la contre-offre
    offer.statut     = OFFER_STATUS.ACCEPTE;
    offer.prixPropose = offer.contreOffre.prix;
    await offer.save();

    // Récupérer les autres offres actives AVANT de les refuser
    const otherOffersCounter = await Offer.find({
      colis: parcel._id,
      _id: { $ne: offer._id },
      statut: { $nin: [OFFER_STATUS.REFUSE, OFFER_STATUS.ANNULE] },
    }).populate('transporteur', 'prenom nom expoPushToken');

    // Refuser les autres offres
    await Offer.updateMany(
      { colis: parcel._id, _id: { $ne: offer._id } },
      { $set: { statut: OFFER_STATUS.REFUSE } }
    );
    parcel.statut              = PARCEL_STATUS.ACCEPTE;
    parcel.transporteurAccepte = offer.transporteur._id;
    parcel.prixFinal           = offer.contreOffre.prix;
    await parcel.save();

    // Créer conversation
    try {
      const Conversation = require('../models/Conversation');
      // ✅ Réutiliser la conversation existante entre ces deux users
      let conv = await Conversation.findOne({
        participants: { $all: [parcel.expediteur._id, offer.transporteur._id], $size: 2 },
      });
      if (!conv) {
        conv = await Conversation.create({
          participants: [parcel.expediteur._id, offer.transporteur._id],
          colis: parcel._id,
          unreadCount: [
            { user: parcel.expediteur._id,  count: 0 },
            { user: offer.transporteur._id, count: 0 },
          ],
        });
      } else {
        conv.colis = parcel._id;
        if (!conv.unreadCount || conv.unreadCount.length < 2) {
          conv.unreadCount = [
            { user: parcel.expediteur._id,  count: 0 },
            { user: offer.transporteur._id, count: 0 },
          ];
        }
        await conv.save();
      }
    } catch (_e) { /* ignore */ }

    const io = req.app.locals.io;
    // Notifier l'expéditeur
    await notify(io, {
      destinataire: parcel.expediteur._id,
      type:    'offre_acceptee',
      titre:   '🎉 Contre-offre acceptée !',
      message: `${offer.transporteur.prenom} a accepté votre contre-offre de ${offer.contreOffre.prix} DZD.`,
      parcelId: parcel._id,
      offerId:  offer._id,
    });

    // Notifier les autres transporteurs refusés
    for (const refused of otherOffersCounter) {
      if (!refused.transporteur?._id) continue;
      await notify(io, {
        destinataire: refused.transporteur._id,
        type:    'offre_refusee',
        titre:   '❌ Offre non retenue',
        message: `L'expéditeur a choisi un autre transporteur pour le colis "${parcel.titre}".`,
        parcelId: parcel._id,
        offerId:  refused._id,
      });
    }

    res.json({ offer, parcel });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── PATCH /offers/:id/reject-counter — transporteur refuse la contre-offre ───
router.patch('/:id/reject-counter', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id).populate('colis').populate('transporteur', 'prenom nom');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    if (offer.transporteur._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    // Repasser en attente — la contre-offre est annulée
    offer.statut      = OFFER_STATUS.EN_ATTENTE;
    offer.contreOffre = undefined;
    await offer.save();

    const parcel = await Parcel.findById(offer.colis._id).populate('expediteur', 'prenom nom');
    const io = req.app.locals.io;
    await notify(io, {
      destinataire: parcel.expediteur._id,
      type:    'offre_refusee',
      titre:   'Contre-offre refusée',
      message: `${offer.transporteur.prenom} a refusé votre contre-offre.`,
      parcelId: parcel._id,
      offerId:  offer._id,
    });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── PATCH /offers/:id/reoffer — transporteur propose un nouveau prix ──────────
router.patch('/:id/reoffer', auth, async (req, res) => {
  try {
    const { prix, message } = req.body;
    if (!prix || prix < 100) return res.status(400).json({ message: 'Prix invalide' });

    const offer = await Offer.findById(req.params.id).populate('colis').populate('transporteur', 'prenom nom');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    if (offer.transporteur._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    // Mettre à jour le prix proposé et repasser en attente
    offer.prixPropose = prix;
    offer.message     = message || offer.message;
    offer.statut      = OFFER_STATUS.EN_ATTENTE;
    offer.contreOffre = undefined;
    await offer.save();

    const parcel = await Parcel.findById(offer.colis._id).populate('expediteur', 'prenom nom');
    const io = req.app.locals.io;
    await notify(io, {
      destinataire: parcel.expediteur._id,
      type:    'nouvelle_offre',
      titre:   '🔄 Nouvelle proposition',
      message: `${offer.transporteur.prenom} vous propose maintenant ${prix} DZD.`,
      parcelId: parcel._id,
      offerId:  offer._id,
    });

    await offer.populate('transporteur', 'prenom nom photoProfil wilaya moyenne totalAvis typeCompte');
    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;