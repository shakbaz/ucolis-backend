// 📄 ucolis-backend/routes/auth.js

const express    = require('express');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User       = require('../models/User');
const auth       = require('../middleware/auth');
const { ENDPOINTS } = require('../utils/constants');

const router = express.Router();

// ── POST /login ───────────────────────────────────────────────
router.post(ENDPOINTS.LOGIN, async (req, res) => {
  try {
    const { email, motDePasse } = req.body;

    if (!email || !motDePasse) {
      return res.status(400).json({ message: 'Email et mot de passe requis' });
    }

    // ✅ select('+motDePasse') — obligatoire car select:false dans le schéma
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('+motDePasse');

    if (!user) {
      return res.status(401).json({
        message: 'Aucun compte associé à cet email',
        code:    'EMAIL_NOT_FOUND',
      });
    }

    if (!user.isActif) {
      return res.status(403).json({
        message: 'Compte suspendu',
        code:    'ACCOUNT_SUSPENDED',
      });
    }

    const isMatch = await user.comparePassword(motDePasse);
    if (!isMatch) {
      return res.status(401).json({
        message: 'Mot de passe incorrect',
        code:    'WRONG_PASSWORD',
      });
    }

    const token = user.generateToken();

    // Mettre à jour lastSeen
    user.lastSeen = new Date();
    await user.save({ validateBeforeSave: false });

    res.json({ token, user });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({ message: 'Erreur serveur', detail: error.message });
  }
});

// ── POST /register ────────────────────────────────────────────
router.post(ENDPOINTS.REGISTER, async (req, res) => {
  try {
    const { prenom, nom, email, motDePasse, telephone, wilaya, ville, role, typeCompte } = req.body;

    if (!prenom || !nom || !email || !motDePasse || !telephone || !wilaya || !ville) {
      return res.status(400).json({ message: 'Tous les champs obligatoires doivent être remplis' });
    }

    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase().trim() },
        { telephone },
      ],
    });

    if (existingUser) {
      if (existingUser.email === email.toLowerCase().trim()) {
        return res.status(400).json({ message: 'Email déjà utilisé' });
      }
      return res.status(400).json({ message: 'Téléphone déjà utilisé' });
    }

    const user = new User({
      prenom:     prenom.trim(),
      nom:        nom.trim(),
      email:      email.toLowerCase().trim(),
      motDePasse,
      telephone,
      wilaya,
      ville,
      role:        role       || 'sender',
      typeCompte:  typeCompte || 'particulier',
    });

    await user.save();

    const token = user.generateToken();
    res.status(201).json({ token, user });
  } catch (error) {
    console.error('❌ Register error:', error.message);
    res.status(400).json({ message: error.message });
  }
});

// ── GET /me ───────────────────────────────────────────────────
router.get(ENDPOINTS.ME, auth, async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ── POST /logout ──────────────────────────────────────────────
router.post(ENDPOINTS.LOGOUT, auth, async (req, res) => {
  res.json({ message: 'Déconnecté avec succès' });
});

// ── POST /forgot-password ─────────────────────────────────────
router.post(ENDPOINTS.FORGOT_PASSWORD, async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });

    // Toujours répondre OK même si email inexistant (sécurité)
    if (!user) {
      return res.json({ message: 'Email envoyé si le compte existe' });
    }

    const resetToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    user.resetToken       = resetToken;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    if (process.env.SMTP_USER) {
      try {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT),
          secure: false,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        await transporter.sendMail({
          from:    `"UCOLIS" <${process.env.SMTP_USER}>`,
          to:      email,
          subject: 'Réinitialisation de votre mot de passe UCOLIS',
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <h2 style="color:#4F46E5;">Réinitialisation du mot de passe</h2>
              <p>Bonjour ${user.prenom},</p>
              <p>Cliquez sur le bouton ci-dessous pour réinitialiser votre mot de passe :</p>
              <a href="${resetUrl}"
                 style="display:inline-block;background:#4F46E5;color:#fff;
                        padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
                Réinitialiser mon mot de passe
              </a>
              <p style="color:#999;margin-top:24px;">Ce lien expire dans 1 heure.</p>
            </div>
          `,
        });
      } catch (mailError) {
        console.warn('⚠️ Email non envoyé:', mailError.message);
      }
    }

    res.json({ message: 'Email envoyé si le compte existe' });
  } catch (error) {
    console.error('❌ ForgotPassword error:', error.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// ── POST /reset-password ──────────────────────────────────────
router.post(ENDPOINTS.RESET_PASSWORD, async (req, res) => {
  try {
    const { token, nouveauMotDePasse } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findOne({
      _id:              decoded.userId,
      resetToken:       token,
      resetTokenExpiry: { $gt: Date.now() },
    }).select('+motDePasse');

    if (!user) {
      return res.status(400).json({ message: 'Token invalide ou expiré' });
    }

    user.motDePasse       = nouveauMotDePasse;
    user.resetToken       = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.json({ message: 'Mot de passe modifié avec succès' });
  } catch (error) {
    console.error('❌ ResetPassword error:', error.message);
    res.status(400).json({ message: 'Token invalide' });
  }
});

module.exports = router;