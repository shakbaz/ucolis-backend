// 📄 ucolis-backend/server.js
require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const http       = require('http');
const socketIo   = require('socket.io');

const authRoutes     = require('./routes/auth');
const parcelRoutes   = require('./routes/parcels');
const offerRoutes    = require('./routes/offers');
const chatRoutes     = require('./routes/chat');
const userRoutes     = require('./routes/users');
const notificationRoutes = require('./routes/notifications');
const ratingRoutes        = require('./routes/ratings');
const adminRoutes         = require('./routes/admin');
const reportRoutes        = require('./routes/reports');
const { ENDPOINTS }  = require('./utils/constants');

const app = express();
const server = http.createServer(app);

// ✅ OBLIGATOIRE sur Render/Railway/Heroku — doit être EN PREMIER
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  validate: { xForwardedForHeader: false },
});
app.use(limiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '✅ UCOLIS API opérationnelle',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connecté' : 'déconnecté',
  });
});

// Routes
app.use(ENDPOINTS.AUTH,    authRoutes);
app.use(ENDPOINTS.PARCELS, parcelRoutes);
app.use(ENDPOINTS.OFFERS,  offerRoutes);
app.use(ENDPOINTS.CHAT,    chatRoutes);
app.use(ENDPOINTS.USERS,   userRoutes);
app.use(ENDPOINTS.NOTIFICATIONS, notificationRoutes);
app.use('/api/ratings',           ratingRoutes);
app.use('/api/admin',             adminRoutes);
app.use('/api/reports',           reportRoutes);

// Socket.io
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => console.error('❌ MongoDB erreur:', err));

// Socket handlers
io.on('connection', (socket) => {
  // ✅ Chaque user rejoint sa room personnelle (userId) pour les notifications ciblées
  socket.on('join_user', (userId) => {
    if (userId) socket.join(userId);
  });

  socket.on('join_conversation', (conversationId) => {
    socket.join(conversationId);
  });
  socket.on('send_message', ({ conversationId, message }) => {
    io.to(conversationId).emit('new_message', { message, senderId: socket.id });
  });

  // ── Tracking transporteur en temps réel ─────────────────────
  socket.on('join_tracking', ({ parcelId }) => {
    socket.join(`tracking_${parcelId}`);
  });
  socket.on('leave_tracking', ({ parcelId }) => {
    socket.leave(`tracking_${parcelId}`);
  });
  socket.on('carrier_location', ({ parcelId, lat, lng }) => {
    // Sauvegarder la dernière position connue
    if (!io._lastCarrierPos) io._lastCarrierPos = {};
    io._lastCarrierPos[parcelId] = { lat, lng, timestamp: Date.now() };
    io.to(`tracking_${parcelId}`).emit('carrier_position', { lat, lng, timestamp: Date.now() });
  });

  // Quand un expéditeur rejoint et demande la dernière position connue
  socket.on('request_carrier_position', ({ parcelId }) => {
    const last = io._lastCarrierPos?.[parcelId];
    if (last) socket.emit('carrier_position', last);
  });
});

app.locals.io = io;

// Ping anti-sleep pour Render free tier
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => {
    try {
      const https = require('https');
      https.get(`${process.env.RENDER_EXTERNAL_URL}/api/health`, () => {});
    } catch (_e) {}
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Serveur UCOLIS sur http://localhost:${PORT}`);
  console.log(`📱 Frontend: ${process.env.FRONTEND_URL || '*'}`);
});