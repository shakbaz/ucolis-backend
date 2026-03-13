// 📄 ucolis-backend/routes/reports.js

const express  = require('express');
const Report   = require('../models/Report');
const auth     = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

// ── POST /reports — signaler quelque chose (utilisateur connecté) ──
router.post('/', auth, async (req, res) => {
  try {
    const { type, raison, description, cibleUser, cibleParcel, cibleAvis, cibleConversation } = req.body;

    // Empêcher de se signaler soi-même
    if (cibleUser && String(cibleUser) === String(req.user._id)) {
      return res.status(400).json({ message: 'Vous ne pouvez pas vous signaler vous-même' });
    }

    // Vérifier doublon (même auteur + même cible)
    const existing = await Report.findOne({
      auteur: req.user._id,
      ...(cibleUser   ? { cibleUser }   : {}),
      ...(cibleParcel ? { cibleParcel } : {}),
      ...(cibleAvis   ? { cibleAvis }   : {}),
      statut: 'en_attente',
    });
    if (existing) {
      return res.status(409).json({ message: 'Vous avez déjà signalé cet élément' });
    }

    const report = await Report.create({
      auteur: req.user._id,
      type, raison, description,
      cibleUser:         cibleUser         || null,
      cibleParcel:       cibleParcel       || null,
      cibleAvis:         cibleAvis         || null,
      cibleConversation: cibleConversation || null,
    });

    res.status(201).json({ message: 'Signalement envoyé', report });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════
// ROUTES ADMIN
// ══════════════════════════════════════════════════════

// GET /reports — tous les signalements paginés
router.get('/', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, statut = '' } = req.query;
    const skip   = (Number(page) - 1) * Number(limit);
    const filter = statut ? { statut } : {};

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .populate('auteur',      'prenom nom photoProfil email')
        .populate('cibleUser',   'prenom nom photoProfil email')
        .populate('cibleParcel', 'titre villeDepart villeArrivee statut')
        .populate('cibleAvis',   'note commentaire')
        .populate({ path: 'cibleConversation', populate: { path: 'participants', select: 'prenom nom photoProfil' } })
        .populate('traitePar',   'prenom nom')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Report.countDocuments(filter),
    ]);

    res.json({ reports, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /reports/:id — traiter ou ignorer un signalement
router.patch('/:id', adminAuth, async (req, res) => {
  try {
    const { statut, noteAdmin } = req.body;
    if (!['traite', 'ignore'].includes(statut)) {
      return res.status(400).json({ message: "statut doit être 'traite' ou 'ignore'" });
    }

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      {
        statut,
        noteAdmin:  noteAdmin || '',
        traitePar:  req.user._id,
        traiteAt:   new Date(),
      },
      { new: true }
    );

    if (!report) return res.status(404).json({ message: 'Signalement non trouvé' });
    res.json({ message: `Signalement ${statut}`, report });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /reports/:id — supprimer un signalement
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: 'Signalement supprimé' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;