// 📄 ucolis-backend/models/Conversation.js
const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  }],
  colis: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel' },
  dernierMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  unreadCount: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    count: { type: Number, default: 0 },
  }],
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

module.exports = mongoose.model('Conversation', conversationSchema);
