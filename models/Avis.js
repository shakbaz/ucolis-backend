// 📄 ucolis-backend/models/Avis.js

const mongoose = require('mongoose');

const avisSchema = new mongoose.Schema({
  colis:       { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true },
  auteur:      { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  destinataire:{ type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  note:        { type: Number, required: true, min: 1, max: 5 },
  commentaire: { type: String, maxlength: 500, default: '' },
  // 'expediteur' = l'expéditeur note le transporteur
  // 'transporteur' = le transporteur note l'expéditeur
  type:        { type: String, enum: ['expediteur', 'transporteur'], required: true },
}, { timestamps: true });

// Un seul avis par personne par colis
avisSchema.index({ colis: 1, auteur: 1 }, { unique: true });

module.exports = mongoose.model('Avis', avisSchema);