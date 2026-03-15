// 📄 ucolis-backend/routes/ratings.js

const express = require('express');
const Review  = require('../models/Review');
const Parcel  = require('../models/Parcel');
const User    = require('../models/User');
const auth    = require('../middleware/auth');
const { PARCEL_STATUS } = require('../models/Parcel');

const router = express.Router();

// ── POST /ratings — Créer un avis ─────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { colisId, note, commentaire } = req.body;

    if (!colisId || !note) {
      return res.status(400).json({ message: 'colisId et note sont requis' });
    }
    if (note < 1 || note > 5) {
      return res.status(400).json({ message: 'La note doit être entre 1 et 5' });
    }

    const parcel = await Parcel.findById(colisId);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });

    if (parcel.statut !== PARCEL_STATUS.LIVRE) {
      return res.status(400).json({ message: 'Ce colis n\'a pas encore été livré' });
    }

    const userId = req.user._id.toString();
    const expediteurId   = parcel.expediteur.toString();
    const transporteurId = parcel.transporteurAccepte?.toString();

    if (!transporteurId) {
      return res.status(400).json({ message: 'Aucun transporteur associé à ce colis' });
    }

    let destinataireId, type;
    if (userId === expediteurId) {
      destinataireId = transporteurId;
      type = 'expediteur';
    } else if (userId === transporteurId) {
      destinataireId = expediteurId;
      type = 'transporteur';
    } else {
      return res.status(403).json({ message: 'Vous n\'êtes pas concerné par ce colis' });
    }

    const existing = await Review.findOne({ colis: colisId, auteur: req.user._id });
    if (existing) {
      return res.status(409).json({ message: 'Vous avez déjà noté ce colis' });
    }

    const review = await Review.create({
      colis:        colisId,
      auteur:       req.user._id,
      destinataire: destinataireId,
      note,
      commentaire:  commentaire?.trim() || '',
      type,
    });

    const stats = await Review.aggregate([
      { $match: { destinataire: review.destinataire } },
      { $group: { _id: null, moyenne: { $avg: '$note' }, total: { $sum: 1 } } },
    ]);
    if (stats.length > 0) {
      await User.findByIdAndUpdate(destinataireId, {
        moyenne:   Math.round(stats[0].moyenne * 10) / 10,
        totalAvis: stats[0].total,
      });
    }

    await review.populate('auteur', 'prenom nom photoProfil');
    res.status(201).json(review);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Vous avez déjà noté ce colis' });
    }
    res.status(500).json({ message: error.message });
  }
});

// ── GET /ratings/check/:colisId — Vérifier si déjà noté ──────────────────
router.get('/check/:colisId', auth, async (req, res) => {
  try {
    const existing = await Review.findOne({
      colis:  req.params.colisId,
      auteur: req.user._id,
    });
    res.json({ aDejaNote: !!existing, avis: existing || null });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ── GET /ratings/user/:userId — Avis reçus par un utilisateur ─────────────
router.get('/user/:userId', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Review.countDocuments({ destinataire: req.params.userId });
    const avis  = await Review.find({ destinataire: req.params.userId })
      .populate('auteur', 'prenom nom photoProfil')
      .populate('colis', 'titre wilayaDepart wilayaArrivee')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({ avis, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;