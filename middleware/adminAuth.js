// 📄 ucolis-backend/middleware/adminAuth.js

/**
 * Middleware combiné : vérifie que le user est connecté ET admin
 * À utiliser à la place de `auth` sur toutes les routes /admin
 */
const auth = require('./auth');

module.exports = [
  auth,
  (req, res, next) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ message: 'Accès refusé — réservé aux administrateurs' });
    }
    next();
  },
];