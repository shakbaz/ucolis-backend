const express    = require('express');
const bcrypt     = require('bcryptjs');
const cloudinary = require('cloudinary').v2;
const User       = require('../models/User');
const Parcel     = require('../models/Parcel');
const auth       = require('../middleware/auth');
const { uploadPhoto, uploadDocument } = require('../middleware/upload');
const { ENDPOINTS } = require('../utils/constants');

const router = express.Router();

// GET profil public d'un utilisateur
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-motDePasse -resetToken -resetTokenExpiry');
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PUT modifier profil
router.put(ENDPOINTS.UPDATE_PROFILE, auth, async (req, res) => {
  try {
    const allowedFields = ['prenom', 'nom', 'telephone', 'wilaya', 'ville', 'bio', 'role'];
    const updates = {};
    allowedFields.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-motDePasse');

    res.json(user);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// PUT changer mot de passe
router.put(ENDPOINTS.CHANGE_PASSWORD, auth, async (req, res) => {
  try {
    const { currentPassword, nouveauMotDePasse } = req.body;
    const user = await User.findById(req.user._id).select('+motDePasse');

    if (!(await user.comparePassword(currentPassword))) {
      return res.status(400).json({ message: 'Mot de passe actuel incorrect' });
    }

    user.motDePasse = nouveauMotDePasse;
    await user.save();
    res.json({ message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST upload photo de profil
router.post('/upload/photo', auth, uploadPhoto, async (req, res) => {
  try {
    let photoUrl = '';

    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'ucolis/profiles',
        width: 300,
        height: 300,
        crop: 'fill',
        quality: 'auto',
      });
      photoUrl = result.secure_url;
    } else {
      photoUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/uploads/${req.file.filename}`;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { photoProfil: photoUrl } },
      { new: true }
    ).select('-motDePasse');

    res.json({ url: photoUrl, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST upload document
router.post('/upload/document', auth, uploadDocument, async (req, res) => {
  try {
    const { type } = req.body;
    const allowedTypes = ['carteIdentite', 'permisConduire', 'carteGrise', 'assurance'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ message: 'Type de document invalide' });
    }

    let docUrl = '';
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: `ucolis/documents/${req.user._id}`,
        resource_type: 'auto',
      });
      docUrl = result.secure_url;
    } else {
      docUrl = `${process.env.BASE_URL || 'http://localhost:3001'}/uploads/${req.file.filename}`;
    }

    const updatePath = `documents.${type}`;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          [updatePath]: docUrl,
          'documents.statut': 'en_attente',
        },
      },
      { new: true }
    ).select('-motDePasse');

    res.json({ url: docUrl, user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET mes avis reçus
router.get(`${ENDPOINTS.MY_RATINGS}`, auth, async (req, res) => {
  try {
    // À compléter si tu ajoutes un modèle Rating
    res.json({ ratings: [], moyenne: req.user.moyenne, total: req.user.totalAvis });
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;
