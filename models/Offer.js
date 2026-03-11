// 📄 ucolis-backend/models/Offer.js

const mongoose = require('mongoose');

const OFFER_STATUS = {
  EN_ATTENTE:   'en_attente',
  ACCEPTE:      'accepte',
  REFUSE:       'refuse',
  ANNULE:       'annule',
  CONTRE_OFFRE: 'contre_offre',  // ✅ ajouté
};

const offerSchema = new mongoose.Schema({
  colis:        { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true },
  transporteur: { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  prixPropose:  { type: Number, required: true, min: 0 },
  message:      { type: String, maxlength: 500 },
  statut:       { type: String, enum: Object.values(OFFER_STATUS), default: OFFER_STATUS.EN_ATTENTE },
  // ✅ Contre-offre de l'expéditeur
  contreOffre: {
    prix:    { type: Number },
    message: { type: String, maxlength: 500 },
  },
}, {
  timestamps: true,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true },
});

module.exports = mongoose.model('Offer', offerSchema);
module.exports.OFFER_STATUS = OFFER_STATUS;