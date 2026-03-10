// 📄 ucolis-backend/routes/offers.js

const express = require('express');
const Offer   = require('../models/Offer');
const Parcel  = require('../models/Parcel');
const auth    = require('../middleware/auth');
const { OFFER_STATUS }  = require('../models/Offer');
const { PARCEL_STATUS } = require('../models/Parcel');
const {
  notifNouvelleOffre,
  notifOffreAcceptee,
  notifOffreRefusee,
} = require('../utils/notifHelper');

const router = express.Router();

// GET offres d'un colis
router.get('/parcel/:parcelId', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ colis: req.params.parcelId })
      .populate('transporteur', 'prenom nom photoProfil wilaya moyenne totalAvis typeCompte')
      .sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET mes offres (transporteur connecté)
router.get('/my-offers', auth, async (req, res) => {
  try {
    const offers = await Offer.find({ transporteur: req.user._id })
      .populate('colis')
      .sort({ createdAt: -1 });
    res.json(offers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST créer une offre
router.post('/', auth, async (req, res) => {
  try {
    const { colisId, prixPropose, message } = req.body;

    const parcel = await Parcel.findById(colisId);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    if (parcel.statut !== PARCEL_STATUS.DISPONIBLE) {
      return res.status(400).json({ message: 'Ce colis n\'est plus disponible' });
    }
    if (parcel.expediteur.toString() === req.user._id.toString()) {
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

    const offer = new Offer({
      colis: colisId,
      transporteur: req.user._id,
      prixPropose,
      message,
    });

    await offer.save();
    await offer.populate('transporteur', 'prenom nom photoProfil wilaya moyenne totalAvis typeCompte');

    // ✅ Persister la notification en base pour l'expéditeur
    const transporteurNom = `${offer.transporteur.prenom} ${offer.transporteur.nom}`;
    await notifNouvelleOffre(
      parcel.expediteur,
      transporteurNom,
      parcel.titre,
      parcel._id,
      offer._id,
    );

    // Notifier en temps réel via Socket.io
    const io = req.app.locals.io;
    if (io) {
      io.to(parcel.expediteur.toString()).emit('new_offer', {
        parcelId: colisId,
        offer,
      });
    }

    res.status(201).json(offer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH accepter une offre
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const offer  = await Offer.findById(req.params.id).populate('colis');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    const parcel = await Parcel.findById(offer.colis._id);
    if (parcel.expediteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    // Accepter cette offre
    offer.statut = OFFER_STATUS.ACCEPTE;
    await offer.save();

    // Refuser toutes les autres offres sur ce colis
    await Offer.updateMany(
      { colis: parcel._id, _id: { $ne: offer._id } },
      { $set: { statut: OFFER_STATUS.REFUSE } },
    );

    // Mettre à jour le colis
    parcel.statut              = PARCEL_STATUS.EN_NEGOCIATION;
    parcel.transporteurAccepte = offer.transporteur;
    parcel.prixFinal           = offer.prixPropose;
    await parcel.save();

    // ✅ Notifier le transporteur accepté en base
    await notifOffreAcceptee(
      offer.transporteur,
      parcel.titre,
      parcel._id,
      offer._id,
    );

    // Notifier en temps réel via Socket.io
    const io = req.app.locals.io;
    if (io) {
      io.to(offer.transporteur.toString()).emit('offer_accepted', {
        offerId: offer._id,
        parcelId: parcel._id,
      });
    }

    res.json({ offer, parcel });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PATCH refuser une offre
router.patch('/:id/reject', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id).populate('colis');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    const parcel = await Parcel.findById(offer.colis._id);
    if (parcel.expediteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    offer.statut = OFFER_STATUS.REFUSE;
    await offer.save();

    // ✅ Notifier le transporteur refusé en base
    await notifOffreRefusee(
      offer.transporteur,
      parcel.titre,
      parcel._id,
    );

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;