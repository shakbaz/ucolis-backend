require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');

const authRoutes = require('./routes/auth');
const parcelRoutes = require('./routes/parcels');
const offerRoutes = require('./routes/offers');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/users');

const { ENDPOINTS } = require('./utils/constants');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:19006',
    credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Trop de requêtes. Réessayez dans 15 minutes.' },
});
app.use(limiter);

// Routes
app.use(`${ENDPOINTS.AUTH}`, authRoutes);
app.use(`${ENDPOINTS.PARCELS}`, parcelRoutes);
app.use(`${ENDPOINTS.OFFERS}`, offerRoutes);
app.use(`${ENDPOINTS.CHAT}`, chatRoutes);
app.use(`${ENDPOINTS.USERS}`, userRoutes);

// Socket.io pour chat temps réel
const io = socketIo(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:19006',
        methods: ['GET', 'POST'],
        credentials: true,
    },
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '✅ UCOLIS API opérationnelle',
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connecté' : 'déconnecté',
  });
});

// Connexion MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB connecté'))
    .catch(err => console.error('❌ MongoDB erreur:', err));

// Socket.io handlers
io.on('connection', (socket) => {
    console.log('👤 Client connecté:', socket.id);

    socket.on('join_conversation', (conversationId) => {
        socket.join(conversationId);
        console.log(`🔗 ${socket.id} rejoint conversation ${conversationId}`);
    });

    socket.on('send_message', async ({ conversationId, message }) => {
        io.to(conversationId).emit('new_message', { message, senderId: socket.id });
    });

    socket.on('disconnect', () => {
        console.log('👋 Client déconnecté:', socket.id);
    });
});

app.locals.io = io;

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Serveur UCOLIS sur http://localhost:${PORT}`);
    console.log(`📱 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:19006'}`);
});
