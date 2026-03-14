// 📄 ucolis-backend/routes/parcels.js

const express    = require('express');
const cloudinary = require('cloudinary').v2;
const Parcel     = require('../models/Parcel');
const Offer      = require('../models/Offer');
const auth       = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');
const { PARCEL_STATUS } = require('../models/Parcel');
const { uploadParcel, uploadToCloudinary } = require('../middleware/upload');
const { createNotification } = require('../utils/notifHelper');
const User = require('../models/User');

const router = express.Router();

// ── Transitions autorisées ──────────────────────────────────────────────────
//
//  disponible    → en_negociation  (auto, 1ère offre reçue — géré dans offers.js)
//  en_negociation → accepte        (auto, offre acceptée — géré dans offers.js)
//  accepte       → en_livraison    (transporteur démarre)
//  en_livraison  → livre           (transporteur confirme)
//  tout statut   → annule          (expéditeur OU transporteur accepté)
//
const TRANSITIONS = {
  accepte:      ['en_livraison', 'annule'],
  en_livraison: ['livre',        'annule'],
};

// Qui peut déclencher quelle transition
function canChangeStatus(parcel, userId, newStatut) {
  const isExpediteur  = parcel.expediteur.toString()         === userId.toString();
  const isTransporteur = parcel.transporteurAccepte?.toString() === userId.toString();

  if (newStatut === 'annule')       return isExpediteur || isTransporteur;
  if (newStatut === 'en_livraison') return isTransporteur;
  if (newStatut === 'livre')        return isTransporteur;
  return false;
}

// GET liste des colis avec filtres + pagination
router.get('/', async (req, res) => {
  try {
    const {
      page = 1, limit = 10,
      wilaya, statut, poidsMax, search, expediteur,
      sortBy = 'createdAt',
    } = req.query;

    const filter = {};
    if (wilaya)     filter.$or = [{ wilayaDepart: wilaya }, { wilayaArrivee: wilaya }];
    if (statut)     filter.statut = statut;
    if (poidsMax)   filter.poids = { $lte: Number(poidsMax) };
    if (expediteur) filter.expediteur = expediteur;
    if (search) {
      filter.$or = [
        { titre:        { $regex: search, $options: 'i' } },
        { description:  { $regex: search, $options: 'i' } },
        { wilayaDepart: { $regex: search, $options: 'i' } },
        { wilayaArrivee:{ $regex: search, $options: 'i' } },
        { villeDepart:  { $regex: search, $options: 'i' } },
        { villeArrivee: { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Parcel.countDocuments(filter);
    const parcels = await Parcel.find(filter)
      .populate('expediteur',        'prenom nom photoProfil wilaya moyenne totalAvis typeCompte documents')
      .populate('transporteurAccepte','prenom nom photoProfil wilaya moyenne')
      .sort({ [sortBy]: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({ parcels, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// GET un colis par ID
router.get('/:id', async (req, res) => {
  try {
    const parcel = await Parcel.findById(req.params.id)
      .populate('expediteur',        'prenom nom photoProfil wilaya moyenne totalAvis telephone typeCompte documents')
      .populate('transporteurAccepte','prenom nom photoProfil wilaya moyenne telephone');
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    res.json(parcel);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST créer un colis
router.post('/', auth, async (req, res) => {
  try {
    const {
      titre, description, poids, longueur, largeur, hauteur, volume,
      prixDemande, typeVehicule, dateSouhaitee, urgent, wilayaDepart, villeDepart, adresseDepart, latDepart, lngDepart,
      wilayaArrivee, villeArrivee, adresseArrivee, latArrivee, lngArrivee,
      distance, photos,
    } = req.body;

    const parcel = new Parcel({
      titre, description, poids, longueur, largeur, hauteur, volume,
      prixDemande, typeVehicule: typeVehicule || [], dateSouhaitee: dateSouhaitee || null, urgent: urgent || false, wilayaDepart, villeDepart, adresseDepart,
      latDepart:   Number(latDepart),
      lngDepart:   Number(lngDepart),
      wilayaArrivee, villeArrivee, adresseArrivee,
      latArrivee:  Number(latArrivee),
      lngArrivee:  Number(lngArrivee),
      distance:    Number(distance),
      photos:      photos || [],
      expediteur:  req.user._id,
    });

    await parcel.save();
    // ✅ Incrémenter le compteur de colis publiés de l'expéditeur
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'statistiques.colisPublies': 1 },
    });
    await parcel.populate('expediteur', 'prenom nom photoProfil wilaya moyenne');
    res.status(201).json(parcel);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST upload photo
router.post('/upload/photo', auth, uploadParcel, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucune photo fournie' });
    const result = await uploadToCloudinary(req.file.buffer, 'ucolis/parcels', {
      transformation: [{ width: 800, quality: 'auto' }],
    });
    res.json({ url: result.secure_url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT modifier un colis
router.put('/:id', auth, async (req, res) => {
  try {
    const parcel = await Parcel.findById(req.params.id);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    if (parcel.expediteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    if (parcel.statut !== PARCEL_STATUS.DISPONIBLE && parcel.statut !== PARCEL_STATUS.EN_NEGOCIATION) {
      return res.status(400).json({ message: 'Ce colis ne peut plus être modifié' });
    }

    const allowedFields = ['titre', 'description', 'poids', 'longueur', 'largeur', 'hauteur', 'volume', 'prixDemande', 'photos', 'typeVehicule', 'dateSouhaitee', 'urgent', 'wilayaDepart', 'villeDepart', 'adresseDepart', 'latDepart', 'lngDepart', 'wilayaArrivee', 'villeArrivee', 'adresseArrivee', 'latArrivee', 'lngArrivee'];
    allowedFields.forEach(f => { if (req.body[f] !== undefined) parcel[f] = req.body[f]; });

    await parcel.save();
    await parcel.populate('expediteur', 'prenom nom photoProfil wilaya moyenne');
    res.json(parcel);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE supprimer un colis
router.delete('/:id', auth, async (req, res) => {
  try {
    const parcel = await Parcel.findById(req.params.id);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    if (parcel.expediteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }
    await Offer.deleteMany({ colis: parcel._id });
    await Parcel.findByIdAndDelete(parcel._id);
    res.json({ message: 'Colis supprimé' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PATCH changer le statut d'un colis
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { statut } = req.body;
    const parcel = await Parcel.findById(req.params.id);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });

    // ✅ Vérification des permissions
    if (!canChangeStatus(parcel, req.user._id, statut)) {
      return res.status(403).json({ message: 'Non autorisé pour cette action' });
    }

    // ✅ Vérification de la transition
    const allowed = TRANSITIONS[parcel.statut] || [];
    if (!allowed.includes(statut)) {
      return res.status(400).json({
        message: `Transition impossible : ${parcel.statut} → ${statut}`,
      });
    }

    const oldStatut = parcel.statut;
    parcel.statut = statut;
    if (statut === PARCEL_STATUS.LIVRE) parcel.dateLivraison = new Date();
    await parcel.save();

    const io = req.app.locals.io;

    // ✅ Notifications selon la transition
    if (statut === 'en_livraison') {
      // Notifier l'expéditeur
      await createNotification({
        destinataire: parcel.expediteur,
        type:    'colis_en_livraison',
        titre:   '🚚 Livraison démarrée',
        message: `Le transporteur est en route pour "${parcel.titre}"`,
        data:    { parcelId: parcel._id },
      });
      if (io) io.to(parcel.expediteur.toString()).emit('parcel_status', { parcelId: parcel._id, statut });
    }

    if (statut === 'livre') {
      // ✅ Incrémenter le compteur de livraisons du transporteur
      if (parcel.transporteurAccepte) {
        await User.findByIdAndUpdate(parcel.transporteurAccepte, {
          $inc: { 'statistiques.colisLivres': 1 },
        });
      }
      // ✅ Notifier l'expéditeur → lui demander de noter le transporteur
      await createNotification({
        destinataire: parcel.expediteur,
        type:    'colis_livre',
        titre:   '🎉 Colis livré !',
        message: `Votre colis "${parcel.titre}" a été livré. Notez votre transporteur !`,
        data:    { parcelId: parcel._id },
      });
      // ✅ Notifier le transporteur → lui demander de noter l'expéditeur
      if (parcel.transporteurAccepte) {
        await createNotification({
          destinataire: parcel.transporteurAccepte,
          type:    'colis_livre',
          titre:   '✅ Livraison confirmée !',
          message: `Livraison de "${parcel.titre}" confirmée. Notez l'expéditeur !`,
          data:    { parcelId: parcel._id },
        });
        if (io) io.to(parcel.transporteurAccepte.toString()).emit('parcel_status', { parcelId: parcel._id, statut });
      }
      if (io) io.to(parcel.expediteur.toString()).emit('parcel_status', { parcelId: parcel._id, statut });
    }

    if (statut === 'annule') {
      const isExpediteur = parcel.expediteur.toString() === req.user._id.toString();
      const autreUserId  = isExpediteur ? parcel.transporteurAccepte : parcel.expediteur;
      if (autreUserId) {
        await createNotification({
          destinataire: autreUserId,
          type:    'offre_refusee', // type générique pour annulation
          titre:   '❌ Annonce annulée',
          message: `L'annonce "${parcel.titre}" a été annulée`,
          data:    { parcelId: parcel._id },
        });
        if (io) io.to(autreUserId.toString()).emit('parcel_status', { parcelId: parcel._id, statut });
      }
    }

    res.json(parcel);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;