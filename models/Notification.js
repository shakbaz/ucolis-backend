// 📄 ucolis-backend/models/Notification.js

const mongoose = require('mongoose');

const NOTIF_TYPES = {
  NOUVELLE_OFFRE:    'nouvelle_offre',
  OFFRE_ACCEPTEE:    'offre_acceptee',
  OFFRE_REFUSEE:     'offre_refusee',
  CONTRE_OFFRE:      'contre_offre',      // ✅ ajouté
  COLIS_EN_LIVRAISON:'colis_en_livraison',
  COLIS_LIVRE:       'colis_livre',
  NOUVEAU_MESSAGE:   'nouveau_message',
  DOCUMENT_VALIDE:   'document_valide',
  DOCUMENT_REFUSE:   'document_refuse',
};

const notificationSchema = new mongoose.Schema({
  destinataire: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:         { type: String, enum: Object.values(NOTIF_TYPES), required: true },
  titre:        { type: String, required: true },
  message:      { type: String, required: true },
  lu:           { type: Boolean, default: false },
  data: {
    parcelId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', default: null },
    offerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Offer',  default: null },
    userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User',   default: null },
    conversationId:{ type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
  },
}, { timestamps: true });

notificationSchema.index({ destinataire: 1, createdAt: -1 });
notificationSchema.index({ destinataire: 1, lu: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.NOTIF_TYPES = NOTIF_TYPES;