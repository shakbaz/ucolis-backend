// 📄 ucolis-backend/models/User.js

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const USER_ROLES = {
  SENDER:  'sender',
  CARRIER: 'carrier',
  BOTH:    'both',
};

const DOCUMENT_STATUS = {
  NON_SOUMIS: 'non_soumis',
  EN_ATTENTE: 'en_attente',
  VALIDE:     'valide',
  REFUSE:     'refuse',
};

const userSchema = new mongoose.Schema({
  prenom:      { type: String, required: true, trim: true },
  nom:         { type: String, required: true, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  motDePasse:  { type: String, required: true, select: false },
  telephone:   { type: String, required: true },
  wilaya:      { type: String, required: true },
  ville:       { type: String, default: '' },       // ✅ pas required — optionnel à l'édition
  bio:         { type: String, maxlength: 500, default: '' }, // ✅ 500 au lieu de 200
  role:        { type: String, enum: Object.values(USER_ROLES), default: USER_ROLES.SENDER },
  typeCompte:  { type: String, enum: ['particulier', 'professionnel'], default: 'particulier' },
  photoProfil: { type: String, default: null },     // ✅ null par défaut — Avatar gère le fallback
  moyenne:     { type: Number, default: 0, min: 0, max: 5 },
  totalAvis:   { type: Number, default: 0 },
  isAdmin:     { type: Boolean, default: false },
  isActif:     { type: Boolean, default: true },
  lastSeen:    { type: Date, default: Date.now },
  // ✅ Statistiques embarquées — évite des aggregations
  statistiques: {
    colisPublies:  { type: Number, default: 0 },
    colisLivres:   { type: Number, default: 0 },
    offresEnvoyees:{ type: Number, default: 0 },
  },
  documents: {
    carteIdentite:  { type: String, default: null },
    permisConduire: { type: String, default: null },
    carteGrise:     { type: String, default: null },
    assurance:      { type: String, default: null },
    statut: {
      type:    String,
      enum:    Object.values(DOCUMENT_STATUS),
      default: DOCUMENT_STATUS.NON_SOUMIS,
    },
  },
  resetToken:       { type: String, default: null, select: false },
  resetTokenExpiry: { type: Date,   default: null, select: false },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.motDePasse;
      delete ret.resetToken;
      delete ret.resetTokenExpiry;
      return ret;
    },
  },
});

// ── Virtuel : nom complet ─────────────────────────────────────
userSchema.virtual('nomComplet').get(function() {
  return `${this.prenom} ${this.nom}`;
});

// ── Hash mot de passe avant save ──────────────────────────────
userSchema.pre('save', async function(next) {
  if (!this.isModified('motDePasse')) return next();
  try {
    this.motDePasse = await bcrypt.hash(this.motDePasse, 12);
    next();
  } catch (err) {
    next(err);
  }
});

// ── Comparer mot de passe ─────────────────────────────────────
userSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.motDePasse);
};

// ── Générer JWT ───────────────────────────────────────────────
userSchema.methods.generateToken = function() {
  return jwt.sign(
    { userId: this._id, email: this.email, isAdmin: this.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

module.exports = mongoose.model('User', userSchema);
module.exports.USER_ROLES      = USER_ROLES;
module.exports.DOCUMENT_STATUS = DOCUMENT_STATUS;
