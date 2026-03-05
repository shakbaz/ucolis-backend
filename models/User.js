// 📄 ucolis-backend/models/User.js

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken'); // ✅ manquait

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
  motDePasse:  { type: String, required: true, select: false }, // ✅ select: false — jamais retourné par défaut
  telephone:   { type: String, required: true },
  wilaya:      { type: String, required: true },
  ville:       { type: String, required: true },
  role:        { type: String, enum: Object.values(USER_ROLES), default: USER_ROLES.SENDER },
  typeCompte:  { type: String, enum: ['particulier', 'professionnel'], default: 'particulier' },
  photoProfil: { type: String, default: 'https://via.placeholder.com/120x120/4F46E5/FFFFFF?text=U' },
  bio:         { type: String, maxlength: 200, default: '' },
  moyenne:     { type: Number, default: 0, min: 0, max: 5 },
  totalAvis:   { type: Number, default: 0 },
  isAdmin:     { type: Boolean, default: false },
  isActif:     { type: Boolean, default: true },
  lastSeen:    { type: Date, default: Date.now },
  documents: {
    carteIdentite:  { type: String, default: null },
    permisConduire: { type: String, default: null },
    carteGrise:     { type: String, default: null },
    assurance:      { type: String, default: null },
    statut: {
      type: String,
      enum: Object.values(DOCUMENT_STATUS),
      default: DOCUMENT_STATUS.NON_SOUMIS,
    },
  },
  resetToken:       { type: String, default: null },
  resetTokenExpiry: { type: Date,   default: null },
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.motDePasse;   // ✅ jamais exposé dans les réponses JSON
      delete ret.resetToken;
      delete ret.resetTokenExpiry;
      return ret;
    },
  },
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
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.motDePasse);
};

// ── Générer JWT ───────────────────────────────────────────────
userSchema.methods.generateToken = function() {
  return jwt.sign(                        // ✅ jwt maintenant importé
    { userId: this._id, email: this.email, isAdmin: this.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

module.exports = mongoose.model('User', userSchema);
module.exports.USER_ROLES      = USER_ROLES;
module.exports.DOCUMENT_STATUS = DOCUMENT_STATUS;
