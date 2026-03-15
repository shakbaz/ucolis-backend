// 📄 ucolis-backend/models/Parcel.js

const mongoose = require('mongoose');

const PARCEL_STATUS = {
    DISPONIBLE: 'disponible',
    EN_NEGOCIATION: 'en_negociation',
    ACCEPTE: 'accepte',
    EN_LIVRAISON: 'en_livraison',
    EN_ATTENTE_VALIDATION: 'en_attente_validation',
    LIVRE: 'livre',
    ANNULE: 'annule',
};

const parcelSchema = new mongoose.Schema({
    titre: { type: String, required: true },
    description: { type: String, maxlength: 1000 },
    poids: { type: Number, required: true, min: 0.1 },
    longueur: { type: Number, min: 0 },
    largeur: { type: Number, min: 0 },
    hauteur: { type: Number, min: 0 },
    volume: { type: Number, min: 0 },
    typeVehicule:    [{ type: String, enum: ['moto','voiture','break','utilitaire','camionnette','camion','cargo','semi'] }],
    dateSouhaitee:   { type: Date, default: null },
    urgent:          { type: Boolean, default: false },
    prixDemande: { type: Number, required: true, min: 100 },
    wilayaDepart: { type: String, required: true },
    villeDepart: { type: String, required: true },
    adresseDepart: { type: String, required: true },
    latDepart: { type: Number, required: true },
    lngDepart: { type: Number, required: true },
    wilayaArrivee: { type: String, required: true },
    villeArrivee: { type: String, required: true },
    adresseArrivee: { type: String, required: true },
    latArrivee: { type: Number, required: true },
    lngArrivee: { type: Number, required: true },
    distance: { type: Number, required: true },
    photos: [{ type: String }],
    expediteur: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    transporteurAccepte: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    statut: { type: String, enum: Object.values(PARCEL_STATUS), default: PARCEL_STATUS.DISPONIBLE },
    prixFinal: { type: Number },
    dateLivraison: { type: Date },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});

module.exports = mongoose.model('Parcel', parcelSchema);
module.exports.PARCEL_STATUS = PARCEL_STATUS;