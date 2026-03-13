// 📄 ucolis-backend/models/Report.js

const mongoose = require('mongoose');

const REPORT_TYPES = {
  UTILISATEUR: 'utilisateur',
  ANNONCE:     'annonce',
  AVIS:        'avis',
  MESSAGE:     'message',
};

const REPORT_STATUS = {
  EN_ATTENTE: 'en_attente',
  TRAITE:     'traite',
  IGNORE:     'ignore',
};

const REPORT_REASONS = [
  'contenu_inapproprie',
  'escroquerie',
  'fausse_annonce',
  'comportement_abusif',
  'spam',
  'autre',
];

const reportSchema = new mongoose.Schema({
  auteur:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:        { type: String, enum: Object.values(REPORT_TYPES), required: true },
  raison:      { type: String, enum: REPORT_REASONS, required: true },
  description: { type: String, maxlength: 1000 },
  statut:      { type: String, enum: Object.values(REPORT_STATUS), default: REPORT_STATUS.EN_ATTENTE },

  // Cible du signalement (un seul rempli selon le type)
  cibleUser:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   default: null },
  cibleParcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', default: null },
  cibleAvis:         { type: mongoose.Schema.Types.ObjectId, ref: 'Review',       default: null },
  cibleConversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },

  // Note admin lors du traitement
  noteAdmin:   { type: String, default: '' },
  traitePar:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   default: null },
  traiteAt:    { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Report', reportSchema);
module.exports.REPORT_TYPES   = REPORT_TYPES;
module.exports.REPORT_STATUS  = REPORT_STATUS;
module.exports.REPORT_REASONS = REPORT_REASONS;