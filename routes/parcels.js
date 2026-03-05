const express    = require('express');
const cloudinary = require('cloudinary').v2;
const Parcel     = require('../models/Parcel');
const Offer      = require('../models/Offer');
const auth       = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');
const { PARCEL_STATUS } = require('../models/Parcel');

const router = express.Router();

// GET liste des colis avec filtres + pagination
router.get('/', async (req, res) => {
  try {
    const {
      page = 1, limit = 10,
      wilaya, statut, poidsMax, search,
      expediteur, sortBy = 'createdAt',
    } = req.query;

    const filter = {};
    if (wilaya)    filter.$or = [{ wilayaDepart: wilaya }, { wilayaArrivee: wilaya }];
    if (statut)    filter.statut = statut;
    if (poidsMax)  filter.poids = { $lte: Number(poidsMax) };
    if (expediteur) filter.expediteur = expediteur;
    if (search) {
      filter.$or = [
        { titre:          { $regex: search, $options: 'i' } },
        { description:    { $regex: search, $options: 'i' } },
        { wilayaDepart:   { $regex: search, $options: 'i' } },
        { wilayaArrivee:  { $regex: search, $options: 'i' } },
        { villeDepart:    { $regex: search, $options: 'i' } },
        { villeArrivee:   { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Parcel.countDocuments(filter);

    const parcels = await Parcel.find(filter)
      .populate('expediteur', 'prenom nom photoProfil wilaya moyenne totalAvis typeCompte documents')
      .populate('transporteurAccepte', 'prenom nom photoProfil wilaya moyenne')
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
      .populate('expediteur', 'prenom nom photoProfil wilaya moyenne totalAvis telephone typeCompte documents')
      .populate('transporteurAccepte', 'prenom nom photoProfil wilaya moyenne telephone');

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
      prixDemande, wilayaDepart, villeDepart, adresseDepart, latDepart, lngDepart,
      wilayaArrivee, villeArrivee, adresseArrivee, latArrivee, lngArrivee,
      distance, photos,
    } = req.body;

    const parcel = new Parcel({
      titre, description, poids, longueur, largeur, hauteur, volume,
      prixDemande, wilayaDepart, villeDepart, adresseDepart,
      latDepart:  Number(latDepart),
      lngDepart:  Number(lngDepart),
      wilayaArrivee, villeArrivee, adresseArrivee,
      latArrivee:  Number(latArrivee),
      lngArrivee:  Number(lngArrivee),
      distance:    Number(distance),
      photos:      photos || [],
      expediteur:  req.user._id,
    });

    await parcel.save();
    await parcel.populate('expediteur', 'prenom nom photoProfil wilaya moyenne');
    res.status(201).json(parcel);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// POST upload photo pour un colis
router.post('/upload/photo', auth, uploadPhoto, async (req, res) => {
  try {
    let photoUrl = '';
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'ucolis/parcels',
        width: 800,
        quality: 'auto',
      });
      photoUrl = result.secure_url;
    } else {
      photoUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/uploads/${req.file.filename}`;
    }
    res.json({ url: photoUrl });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
    if (parcel.statut !== PARCEL_STATUS.DISPONIBLE) {
      return res.status(400).json({ message: 'Ce colis ne peut plus être modifié' });
    }

    const allowedFields = [
      'titre', 'description', 'poids', 'longueur', 'largeur', 'hauteur',
      'volume', 'prixDemande', 'photos',
    ];
    allowedFields.forEach(f => {
      if (req.body[f] !== undefined) parcel[f] = req.body[f];
    });

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

// PUT changer le statut d'un colis
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { statut } = req.body;
    const parcel = await Parcel.findById(req.params.id);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    if (parcel.expediteur.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    parcel.statut = statut;
    if (statut === PARCEL_STATUS.LIVRE) parcel.dateLivraison = new Date();
    await parcel.save();
    res.json(parcel);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
