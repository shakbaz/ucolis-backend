const express      = require('express');
const Notification = require('../models/Notification');
const auth         = require('../middleware/auth');

const router = express.Router();

// ── GET /notifications — liste des notifs du user connecté ───
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, lu } = req.query;
    const skip   = (Number(page) - 1) * Number(limit);
    const filter = { destinataire: req.user._id };
    if (lu !== undefined) filter.lu = lu === 'true';

    const [notifications, total, nonLues] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate('data.parcelId', 'titre wilayaDepart wilayaArrivee')
        .populate('data.userId',   'prenom nom photoProfil'),
      Notification.countDocuments(filter),
      Notification.countDocuments({ destinataire: req.user._id, lu: false }),
    ]);

    res.json({
      notifications,
      total,
      nonLues,   // ✅ badge compteur
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /notifications/:id/lu — marquer une notif comme lue ─
router.patch('/:id/lu', auth, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, destinataire: req.user._id },
      { lu: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ message: 'Notification non trouvée' });
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /notifications/tout-lire — marquer toutes comme lues ─
router.patch('/tout-lire', auth, async (req, res) => {
  try {
    await Notification.updateMany(
      { destinataire: req.user._id, lu: false },
      { lu: true }
    );
    res.json({ message: 'Toutes les notifications marquées comme lues' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /notifications/:id — supprimer une notif ──────────
router.delete('/:id', auth, async (req, res) => {
  try {
    await Notification.findOneAndDelete({
      _id: req.params.id,
      destinataire: req.user._id,
    });
    res.json({ message: 'Notification supprimée' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /notifications — tout supprimer ───────────────────
router.delete('/', auth, async (req, res) => {
  try {
    await Notification.deleteMany({ destinataire: req.user._id });
    res.json({ message: 'Toutes les notifications supprimées' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
