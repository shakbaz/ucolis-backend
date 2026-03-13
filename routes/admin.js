// 📄 ucolis-backend/routes/admin.js

const express = require('express');
const User    = require('../models/User');
const Parcel  = require('../models/Parcel');
const Offer   = require('../models/Offer');
const Review  = require('../models/Review');
const adminAuth = require('../middleware/adminAuth');
const Report        = require('../models/Report');
const Conversation  = require('../models/Conversation');
const Message       = require('../models/Message');

const router = express.Router();

// ════════════════════════════════════════════════════
// DASHBOARD — statistiques globales
// GET /admin/stats
// ════════════════════════════════════════════════════
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      totalParcels,
      parcelsByStatus,
      totalReviews,
      docsEnAttente,
      signalementsEnAttente,
      newUsersThisMonth,
      newParcelsThisMonth,
    ] = await Promise.all([
      User.countDocuments({ isAdmin: false }),
      User.countDocuments({ isAdmin: false, isActif: true }),
      User.countDocuments({ isAdmin: false, isActif: false }),
      Parcel.countDocuments(),
      Parcel.aggregate([
        { $group: { _id: '$statut', count: { $sum: 1 } } },
      ]),
      Review.countDocuments(),
      User.countDocuments({ 'documents.statut': 'en_attente' }),
      Report.countDocuments({ statut: 'en_attente' }),
      User.countDocuments({
        isAdmin: false,
        createdAt: { $gte: new Date(new Date().setDate(1)) },
      }),
      Parcel.countDocuments({
        createdAt: { $gte: new Date(new Date().setDate(1)) },
      }),
    ]);

    const statusMap = {};
    parcelsByStatus.forEach(s => { statusMap[s._id] = s.count; });

    res.json({
      users:   { total: totalUsers, actifs: activeUsers, bannis: bannedUsers, newThisMonth: newUsersThisMonth },
      parcels: { total: totalParcels, parStatus: statusMap, newThisMonth: newParcelsThisMonth },
      reviews: { total: totalReviews },
      docs:    { enAttente: docsEnAttente },
      signalements: { enAttente: signalementsEnAttente },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════════════════
// UTILISATEURS
// ════════════════════════════════════════════════════

// GET /admin/users — liste paginée avec filtres
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = '', actif = '' } = req.query;
    const skip   = (Number(page) - 1) * Number(limit);

    const filter = { isAdmin: false };
    if (search)    filter.$or = [
      { prenom:    { $regex: search, $options: 'i' } },
      { nom:       { $regex: search, $options: 'i' } },
      { email:     { $regex: search, $options: 'i' } },
      { telephone: { $regex: search, $options: 'i' } },
    ];
    if (role)      filter.role    = role;
    if (actif !== '') filter.isActif = actif === 'true';

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-motDePasse')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    res.json({ users, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /admin/users/:id — détail d'un utilisateur
router.get('/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-motDePasse');
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    const [parcels, reviews] = await Promise.all([
      Parcel.find({ $or: [{ expediteur: user._id }, { transporteurAccepte: user._id }] })
        .select('titre statut villeDepart villeArrivee createdAt')
        .sort({ createdAt: -1 })
        .limit(10),
      Review.find({ destinataire: user._id })
        .populate('auteur', 'prenom nom photoProfil')
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    res.json({ user, parcels, reviews });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /admin/users/:id/toggle-ban — suspendre ou réactiver
router.patch('/users/:id/toggle-ban', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user)       return res.status(404).json({ message: 'Utilisateur non trouvé' });
    if (user.isAdmin) return res.status(403).json({ message: 'Impossible de bannir un admin' });

    user.isActif = !user.isActif;
    await user.save();

    res.json({
      message: user.isActif ? 'Compte réactivé' : 'Compte suspendu',
      isActif: user.isActif,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /admin/users/:id/promote — promouvoir / rétrograder admin
router.patch('/users/:id/promote', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    user.isAdmin = !user.isAdmin;
    await user.save();

    res.json({
      message: user.isAdmin ? 'Utilisateur promu admin' : 'Droits admin retirés',
      isAdmin: user.isAdmin,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /admin/users/:id — supprimer définitivement
router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user)        return res.status(404).json({ message: 'Utilisateur non trouvé' });
    if (user.isAdmin) return res.status(403).json({ message: 'Impossible de supprimer un admin' });

    await Promise.all([
      User.findByIdAndDelete(req.params.id),
      Parcel.deleteMany({ expediteur: req.params.id }),
      Review.deleteMany({ $or: [{ auteur: req.params.id }, { destinataire: req.params.id }] }),
    ]);

    res.json({ message: 'Compte supprimé définitivement' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════════════════
// DOCUMENTS — validation transporteurs
// ════════════════════════════════════════════════════

// GET /admin/documents — transporteurs avec docs en attente
router.get('/documents', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, statut = 'en_attente' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (statut) filter['documents.statut'] = statut;
    else        filter['documents.statut'] = { $ne: 'non_soumis' };

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('prenom nom email photoProfil telephone wilaya documents createdAt')
        .sort({ 'documents.updatedAt': -1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    res.json({ users, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /admin/users/:id/validate-docs — valider ou refuser les documents
router.patch('/users/:id/validate-docs', adminAuth, async (req, res) => {
  try {
    const { statut, motif } = req.body; // statut: 'valide' | 'refuse'
    if (!['valide', 'refuse'].includes(statut)) {
      return res.status(400).json({ message: "Statut invalide, 'valide' ou 'refuse' attendu" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { 'documents.statut': statut },
      { new: true }
    ).select('-motDePasse');

    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    // Créer une notification pour l'utilisateur
    try {
      const { createNotification } = require('../utils/notifHelper');
      await createNotification({
        destinataire: user._id,
        type:    statut === 'valide' ? 'document_valide' : 'document_refuse',
        titre:   statut === 'valide' ? '✅ Documents validés' : '❌ Documents refusés',
        message: statut === 'valide'
          ? 'Vos documents ont été vérifiés et validés par un administrateur.'
          : `Vos documents ont été refusés.${motif ? ' Motif : ' + motif : ''}`,
      });
    } catch (_) { /* notif non bloquante */ }

    res.json({ message: statut === 'valide' ? 'Documents validés' : 'Documents refusés', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════════════════
// ANNONCES
// ════════════════════════════════════════════════════

// GET /admin/parcels — toutes les annonces paginées
router.get('/parcels', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, statut = '', search = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const filter = {};
    if (statut) filter.statut = statut;
    if (search) filter.$or = [
      { titre:        { $regex: search, $options: 'i' } },
      { villeDepart:  { $regex: search, $options: 'i' } },
      { villeArrivee: { $regex: search, $options: 'i' } },
    ];

    const [parcels, total] = await Promise.all([
      Parcel.find(filter)
        .populate('expediteur',          'prenom nom email photoProfil')
        .populate('transporteurAccepte', 'prenom nom email photoProfil')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Parcel.countDocuments(filter),
    ]);

    res.json({ parcels, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /admin/parcels/:id/status — forcer le statut d'un colis
router.patch('/parcels/:id/status', adminAuth, async (req, res) => {
  try {
    const { statut } = req.body;
    const VALID = ['disponible','en_negociation','accepte','en_livraison','livre','annule'];
    if (!VALID.includes(statut)) return res.status(400).json({ message: 'Statut invalide' });

    const parcel = await Parcel.findByIdAndUpdate(
      req.params.id,
      { statut },
      { new: true }
    ).populate('expediteur', 'prenom nom');

    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });
    res.json({ message: 'Statut mis à jour', parcel });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /admin/parcels/:id — supprimer une annonce
router.delete('/parcels/:id', adminAuth, async (req, res) => {
  try {
    const parcel = await Parcel.findByIdAndDelete(req.params.id);
    if (!parcel) return res.status(404).json({ message: 'Colis non trouvé' });

    // Supprimer les offres associées
    await Offer.deleteMany({ colis: req.params.id });

    res.json({ message: 'Annonce supprimée' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════════════════
// AVIS
// ════════════════════════════════════════════════════

// GET /admin/reviews — tous les avis
router.get('/reviews', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [reviews, total] = await Promise.all([
      Review.find()
        .populate('auteur',       'prenom nom photoProfil')
        .populate('destinataire', 'prenom nom photoProfil')
        .populate('colis',        'titre villeDepart villeArrivee')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Review.countDocuments(),
    ]);

    res.json({ reviews, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /admin/reviews/:id — supprimer un avis
router.delete('/reviews/:id', adminAuth, async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    if (!review) return res.status(404).json({ message: 'Avis non trouvé' });

    // Recalculer la moyenne du destinataire
    const stats = await Review.aggregate([
      { $match: { destinataire: review.destinataire } },
      { $group: { _id: null, moyenne: { $avg: '$note' }, total: { $sum: 1 } } },
    ]);
    await User.findByIdAndUpdate(review.destinataire, {
      moyenne:   stats[0]?.moyenne || 0,
      totalAvis: stats[0]?.total   || 0,
    });

    res.json({ message: 'Avis supprimé' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});



// ── GET /admin/conversations/between/:u1/:u2 ─────────────────
// Fallback : retrouve la conversation entre deux utilisateurs
router.get('/conversations/between/:u1/:u2', adminAuth, async (req, res) => {
  try {
    const { u1, u2 } = req.params;
    const conversation = await Conversation.findOne({
      participants: { $all: [u1, u2], $size: 2 },
    }).populate('participants', 'prenom nom photoProfil');

    if (!conversation) return res.status(404).json({ message: 'Aucune conversation trouvée' });
    res.json({ conversation });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── GET /admin/conversations ─────────────────────────────────
router.get('/conversations', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let conversations = await Conversation.find()
      .populate('participants', 'prenom nom photoProfil')
      .populate('dernierMessage')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Conversation.countDocuments();

    if (search) {
      const s = search.toLowerCase();
      conversations = conversations.filter(conv =>
        conv.participants.some(p =>
          `${p.prenom} ${p.nom}`.toLowerCase().includes(s)
        )
      );
    }

    res.json({ conversations, total, page: Number(page) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── GET /admin/conversations/:id/messages ────────────────────
router.get('/conversations/:id/messages', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [messages, total, conversation] = await Promise.all([
      Message.find({ conversation: req.params.id })
        .populate('auteur', 'prenom nom photoProfil')
        .sort({ createdAt: 1 })
        .skip(skip).limit(Number(limit)),
      Message.countDocuments({ conversation: req.params.id }),
      Conversation.findById(req.params.id)
        .populate('participants', 'prenom nom photoProfil'),
    ]);

    if (!conversation) return res.status(404).json({ message: 'Conversation introuvable' });
    res.json({ messages, total, conversation, page: Number(page) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── DELETE /admin/conversations/:id ──────────────────────────
router.delete('/conversations/:id', adminAuth, async (req, res) => {
  try {
    await Message.deleteMany({ conversation: req.params.id });
    await Conversation.findByIdAndDelete(req.params.id);
    res.json({ message: 'Conversation supprimée' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;