// 📄 ucolis-backend/models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  auteur:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contenu:      { type: String, required: true },
  type:         { type: String, enum: ['text', 'image'], default: 'text' },
  luPar:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

module.exports = mongoose.model('Message', messageSchema);
