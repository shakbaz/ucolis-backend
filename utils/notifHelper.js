// 📄 ucolis-backend/utils/notifHelper.js
const Notification = require('../models/Notification');
const { NOTIF_TYPES } = require('../models/Notification');

async function createNotification({ destinataire, type, titre, message, data = {} }) {
  try {
    await Notification.create({ destinataire, type, titre, message, data });
  } catch (err) {
    console.error('❌ createNotification error:', err.message);
  }
}

// ✅ Helpers prêts à l'emploi — appelle dans routes/offers.js etc.
module.exports = {
  createNotification,

  notifNouvelleOffre: (expediteurId, transporteurNom, parcelTitre, parcelId, offerId) =>
    createNotification({
      destinataire: expediteurId,
      type:    NOTIF_TYPES.NOUVELLE_OFFRE,
      titre:   '📦 Nouvelle offre reçue',
      message: `${transporteurNom} a fait une offre sur "${parcelTitre}"`,
      data:    { parcelId, offerId },
    }),

  notifOffreAcceptee: (transporteurId, parcelTitre, parcelId, offerId) =>
    createNotification({
      destinataire: transporteurId,
      type:    NOTIF_TYPES.OFFRE_ACCEPTEE,
      titre:   '✅ Offre acceptée !',
      message: `Votre offre pour "${parcelTitre}" a été acceptée`,
      data:    { parcelId, offerId },
    }),

  notifOffreRefusee: (transporteurId, parcelTitre, parcelId) =>
    createNotification({
      destinataire: transporteurId,
      type:    NOTIF_TYPES.OFFRE_REFUSEE,
      titre:   '❌ Offre refusée',
      message: `Votre offre pour "${parcelTitre}" n'a pas été retenue`,
      data:    { parcelId },
    }),

  notifColisLivre: (expediteurId, parcelTitre, parcelId) =>
    createNotification({
      destinataire: expediteurId,
      type:    NOTIF_TYPES.COLIS_LIVRE,
      titre:   '🎉 Colis livré !',
      message: `Votre colis "${parcelTitre}" a été livré avec succès`,
      data:    { parcelId },
    }),
};
