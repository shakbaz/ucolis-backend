// 📄 ucolis-backend/routes/users.js

const express    = require('express');
const cloudinary = require('cloudinary').v2;
const User       = require('../models/User');
const auth       = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');

const router = express.Router();

// ── GET /users/me — profil du user connecté ───────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /users/:id — profil public d'un user ──────────────────
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('prenom nom photoProfil wilaya ville bio moyenne totalAvis role typeCompte statistiques createdAt');
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /users/profile — modifier infos profil ────────────────
router.put('/profile', auth, async (req, res) => {
  try {
    const { prenom, nom, telephone, wilaya, ville, bio } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    if (prenom)    user.prenom    = prenom.trim();
    if (nom)       user.nom       = nom.trim();
    if (telephone) user.telephone = telephone.trim();
    if (wilaya)    user.wilaya    = wilaya;
    if (ville !== undefined) user.ville = ville;
    if (bio !== undefined)   user.bio   = bio.trim();

    user.lastSeen = new Date();
    await user.save();

    res.json(user);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── PUT /users/profile/photo — upload photo de profil ─────────
router.put('/profile/photo', auth, uploadPhoto.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Aucune photo fournie' });

    let photoUrl = '';

    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder:         'ucolis/users',
        width:          400,
        height:         400,
        crop:           'fill',
        gravity:        'face',   // ✅ cadrage automatique sur le visage
        quality:        'auto',
        fetch_format:   'auto',
      });
      photoUrl = result.secure_url;
    } else {
      photoUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/uploads/${req.file.filename}`;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { photoProfil: photoUrl },
      { new: true }
    );

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /users/password — changer mot de passe ────────────────
router.put('/password', auth, async (req, res) => {
  try {
    const { ancienMotDePasse, nouveauMotDePasse } = req.body;
    if (!ancienMotDePasse || !nouveauMotDePasse)
      return res.status(400).json({ message: 'Les deux champs sont requis' });
    if (nouveauMotDePasse.length < 6)
      return res.status(400).json({ message: 'Minimum 6 caractères' });

    const user = await User.findById(req.user._id).select('+motDePasse');
    const ok   = await user.comparePassword(ancienMotDePasse);
    if (!ok) return res.status(400).json({ message: 'Ancien mot de passe incorrect' });

    user.motDePasse = nouveauMotDePasse; // ← pre('save') hashera automatiquement
    await user.save();

    res.json({ message: 'Mot de passe mis à jour' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── PATCH /users/last-seen — mettre à jour lastSeen ───────────
router.patch('/last-seen', auth, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { lastSeen: new Date() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
