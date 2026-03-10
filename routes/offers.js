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
  createNotification,
} = require('../utils/notifHelper');

const router = express.Router();

// Refuse toutes les autres offres d'un colis et notifie chaque transporteur
async function refuseOtherOffers(parcelId, acceptedOfferId, parcelTitre, io) {
  const others = await Offer.find({
    colis:  parcelId,
    _id:    { $ne: acceptedOfferId },
    statut: { $nin: [OFFER_STATUS.REFUSE, OFFER_STATUS.ANNULE] },
  });

  await Promise.all(others.map(async (o) => {
    o.statut = OFFER_STATUS.REFUSE;
    await o.save();
    // Notification en base
    await notifOffreRefusee(o.transporteur, parcelTitre, parcelId);
    // Socket temps réel
    if (io) io.to(o.transporteur.toString()).emit('offer_rejected', { offerId: o._id, parcelId });
  }));
}



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
      statut: { $in: [OFFER_STATUS.EN_ATTENTE, OFFER_STATUS.CONTRE_OFFRE] },
    });
    if (existingOffer) {
      return res.status(400).json({ message: 'Vous avez déjà une offre en attente sur ce colis' });
    }

    const offer = new Offer({ colis: colisId, transporteur: req.user._id, prixPropose, message });
    await offer.save();
    await offer.populate('transporteur', 'prenom nom photoProfil wilaya moyenne totalAvis typeCompte');

    const transporteurNom = `${offer.transporteur.prenom} ${offer.transporteur.nom}`;
    await notifNouvelleOffre(parcel.expediteur, transporteurNom, parcel.titre, parcel._id, offer._id);

    // Passe le colis en négociation dès la 1ère offre
    if (parcel.statut === PARCEL_STATUS.DISPONIBLE) {
      parcel.statut = PARCEL_STATUS.EN_NEGOCIATION;
      await parcel.save();
    }

    const io = req.app.locals.io;
    if (io) io.to(parcel.expediteur.toString()).emit('new_offer', { parcelId: colisId, offer });

    res.status(201).json(offer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH contre-offre de l'expéditeur
router.patch('/:id/counter', auth, async (req, res) => {
  try {
    const { prixContreOffre, message } = req.body;
    if (!prixContreOffre || Number(prixContreOffre) < 100) {
      return res.status(400).json({ message: 'Prix de contre-offre invalide (min 100 DZD)' });
    }

    const offer = await Offer.findById(req.params.id)
      .populate('transporteur', 'prenom nom');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    const parcel = await Parcel.findById(offer.colis);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    if (parcel.expediteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    if (offer.statut !== OFFER_STATUS.EN_ATTENTE) {
      return res.status(400).json({ message: 'Cette offre ne peut plus être modifiée' });
    }

    offer.statut      = OFFER_STATUS.CONTRE_OFFRE;
    offer.contreOffre = { prix: Number(prixContreOffre), message: message?.trim() || null };
    await offer.save();

    await createNotification({
      destinataire: offer.transporteur._id,
      type:    'contre_offre',
      titre:   '💬 Contre-offre reçue',
      message: `L'expéditeur propose ${prixContreOffre} DZD pour "${parcel.titre}"`,
      data:    { parcelId: parcel._id, offerId: offer._id },
    });

    const io = req.app.locals.io;
    if (io) io.to(offer.transporteur._id.toString()).emit('counter_offer', { offerId: offer._id, parcelId: parcel._id, prix: prixContreOffre });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PATCH transporteur accepte la contre-offre
router.patch('/:id/accept-counter', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });
    if (offer.transporteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    if (offer.statut !== OFFER_STATUS.CONTRE_OFFRE || !offer.contreOffre?.prix) {
      return res.status(400).json({ message: 'Aucune contre-offre à accepter' });
    }

    const parcel = await Parcel.findById(offer.colis);

    // On accepte au prix de la contre-offre
    offer.prixPropose = offer.contreOffre.prix;
    offer.statut      = OFFER_STATUS.ACCEPTE;
    await offer.save();

    // Refuser les autres offres et notifier chaque transporteur
    const io = req.app.locals.io;
    await refuseOtherOffers(parcel._id, offer._id, parcel.titre, io);

    parcel.statut              = PARCEL_STATUS.ACCEPTE;
    parcel.transporteurAccepte = offer.transporteur;
    parcel.prixFinal           = offer.prixPropose;
    await parcel.save();

    // Notifier l'expéditeur
    await createNotification({
      destinataire: parcel.expediteur,
      type:    'offre_acceptee',
      titre:   '✅ Contre-offre acceptée !',
      message: `Le transporteur a accepté votre contre-offre de ${offer.prixPropose} DZD`,
      data:    { parcelId: parcel._id, offerId: offer._id },
    });

    if (io) io.to(parcel.expediteur.toString()).emit('offer_accepted', { offerId: offer._id, parcelId: parcel._id });

    res.json({ offer, parcel });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PATCH transporteur refuse la contre-offre → revient à en_attente
router.patch('/:id/reject-counter', auth, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });
    if (offer.transporteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    if (offer.statut !== OFFER_STATUS.CONTRE_OFFRE) {
      return res.status(400).json({ message: 'Aucune contre-offre à refuser' });
    }

    const parcel = await Parcel.findById(offer.colis);

    // Remet l'offre en attente, efface la contre-offre
    offer.statut      = OFFER_STATUS.EN_ATTENTE;
    offer.contreOffre = { prix: null, message: null };
    await offer.save();

    // Notifier l'expéditeur
    await createNotification({
      destinataire: parcel.expediteur,
      type:    'offre_refusee',
      titre:   '❌ Contre-offre refusée',
      message: `Le transporteur a refusé votre contre-offre sur "${parcel.titre}"`,
      data:    { parcelId: parcel._id, offerId: offer._id },
    });

    const io = req.app.locals.io;
    if (io) io.to(parcel.expediteur.toString()).emit('counter_rejected', { offerId: offer._id, parcelId: parcel._id });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});


// PATCH transporteur propose un nouveau prix en réponse à la contre-offre
router.patch('/:id/reoffer', auth, async (req, res) => {
  try {
    const { prixPropose, message } = req.body;
    if (!prixPropose || Number(prixPropose) < 100) {
      return res.status(400).json({ message: 'Prix invalide (min 100 DZD)' });
    }

    const offer = await Offer.findById(req.params.id);
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });
    if (offer.transporteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    if (offer.statut !== OFFER_STATUS.CONTRE_OFFRE) {
      return res.status(400).json({ message: 'Aucune contre-offre en cours' });
    }

    const parcel = await Parcel.findById(offer.colis);

    // Nouveau prix proposé, on efface la contre-offre et repasse en_attente
    offer.prixPropose  = Number(prixPropose);
    offer.message      = message?.trim() || offer.message;
    offer.statut       = OFFER_STATUS.EN_ATTENTE;
    offer.contreOffre  = { prix: null, message: null };
    await offer.save();

    // Notifier l'expéditeur
    await offer.populate('transporteur', 'prenom nom');
    const transporteurNom = `${offer.transporteur.prenom} ${offer.transporteur.nom}`;
    await createNotification({
      destinataire: parcel.expediteur,
      type:    'nouvelle_offre',
      titre:   '🔄 Nouvelle proposition reçue',
      message: `${transporteurNom} propose maintenant ${prixPropose} DZD pour "${parcel.titre}"`,
      data:    { parcelId: parcel._id, offerId: offer._id },
    });

    const io = req.app.locals.io;
    if (io) io.to(parcel.expediteur.toString()).emit('new_offer', { parcelId: parcel._id, offer });

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PATCH accepter une offre (expéditeur)
router.patch('/:id/accept', auth, async (req, res) => {
  try {
    const offer  = await Offer.findById(req.params.id).populate('colis');
    if (!offer) return res.status(404).json({ message: 'Offre non trouvée' });

    const parcel = await Parcel.findById(offer.colis._id);
    if (parcel.expediteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    offer.statut = OFFER_STATUS.ACCEPTE;
    await offer.save();

    // Refuser les autres offres et notifier chaque transporteur
    const io = req.app.locals.io;
    await refuseOtherOffers(parcel._id, offer._id, parcel.titre, io);

    parcel.statut              = PARCEL_STATUS.ACCEPTE;
    parcel.transporteurAccepte = offer.transporteur;
    parcel.prixFinal           = offer.prixPropose;
    await parcel.save();

    await notifOffreAcceptee(offer.transporteur, parcel.titre, parcel._id, offer._id);

    if (io) io.to(offer.transporteur.toString()).emit('offer_accepted', { offerId: offer._id, parcelId: parcel._id });

    res.json({ offer, parcel });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PATCH refuser une offre (expéditeur)
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

    await notifOffreRefusee(offer.transporteur, parcel.titre, parcel._id);

    res.json(offer);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;