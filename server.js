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

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    message:   '✅ UCOLIS API opérationnelle',
    timestamp: new Date().toISOString(),
    mongodb:   mongoose.connection.readyState === 1 ? 'connecté' : 'déconnecté',
  });
});

// Rate limiting — exclut /api/health
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max:      300,             // 300 req / IP / 15 min (était 100)
  message:  { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
  validate: { xForwardedForHeader: false },
  skip: (req) => req.path === '/api/health',
});
app.use(limiter);

// Routes
app.use(ENDPOINTS.AUTH,    authRoutes);
app.use(ENDPOINTS.PARCELS, parcelRoutes);
app.use(ENDPOINTS.OFFERS,  offerRoutes);
app.use(ENDPOINTS.CHAT,    chatRoutes);
app.use(ENDPOINTS.USERS,   userRoutes);
app.use(ENDPOINTS.NOTIFICATIONS, notificationRoutes);

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
  socket.on('join_conversation', (conversationId) => {
    socket.join(conversationId);
  });
  socket.on('send_message', ({ conversationId, message }) => {
    io.to(conversationId).emit('new_message', { message, senderId: socket.id });
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
