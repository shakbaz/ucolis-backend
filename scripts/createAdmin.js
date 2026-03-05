// 📄 ucolis-backend/scripts/createAdmin.js

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); // ✅ chemin absolu
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// Debug — vérifie que l'URI est bien chargée
console.log('🔍 MONGODB_URI:', process.env.MONGODB_URI ? '✅ chargée' : '❌ undefined');

if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI manquante — vérifie que le fichier .env existe dans ucolis-backend/');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connecté'))
  .catch(err => { console.error('❌', err.message); process.exit(1); });

const userSchema = new mongoose.Schema({
  prenom:      String,
  nom:         String,
  email:       { type: String, unique: true },
  motDePasse:  String,
  telephone:   String,
  wilaya:      String,
  ville:       String,
  role:        String,
  typeCompte:  String,
  photoProfil: String,
  moyenne:     { type: Number, default: 0 },
  totalAvis:   { type: Number, default: 0 },
  isActif:     { type: Boolean, default: true },
  isAdmin:     { type: Boolean, default: false },
  documents:   { statut: { type: String, default: 'non_soumis' } },
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);

async function createAdmin() {
  try {
    const existing = await User.findOne({ email: 'admin@ucolis.dz' });
    if (existing) {
      console.log('⚠️  Admin déjà existant :', existing.email);
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash('Admin@2026!', 12);

    const admin = new User({
      prenom:      'Admin',
      nom:         'UCOLIS',
      email:       'admin@ucolis.dz',
      motDePasse:  hashedPassword,
      telephone:   '0550000000',
      wilaya:      'Algiers',
      ville:       'Alger',
      role:        'both',
      typeCompte:  'professionnel',
      isAdmin:     true,
      photoProfil: 'https://via.placeholder.com/120x120/4F46E5/FFFFFF?text=A',
      documents:   { statut: 'valide' },
    });

    await admin.save();

    console.log('');
    console.log('✅ Compte admin créé avec succès !');
    console.log('─────────────────────────────────');
    console.log('📧 Email    :', admin.email);
    console.log('🔑 Password : Admin@2026!');
    console.log('🆔 ID       :', admin._id.toString());
    console.log('─────────────────────────────────');
    console.log('👉 Change le mot de passe après le premier login !');

  } catch (error) {
    console.error('❌ Erreur :', error.message);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
}

// Attendre la connexion avant d'exécuter
mongoose.connection.once('open', createAdmin);
