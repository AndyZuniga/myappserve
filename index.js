const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

// Conectar a MongoDB
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// Configurar transporter de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --- Envío de enlaces de verificación ---
const sendVerificationLink = async (correo, token) => {
  const link = `https://myappserve-go.onrender.com/open-app?token=${token}`;
  await transporter.sendMail({
    from: `"SetMatch Soporte" <${process.env.EMAIL_USER}>`,
    to: correo,
    subject: 'Verificación de correo - SetMatch',
    html: `<h2>¡Bienvenido a SetMatch!</h2>
           <p>Verifica tu cuenta:</p>
           <p><a href="${link}">${link}</a></p>
           <p>Expira en 10 minutos.</p>`
  });
};

// Ruta de deep link para verificación
app.get('/open-app', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Token faltante');
  res.send(`<html><head>
    <meta http-equiv="refresh" content="0; url=setmatch://verificar?token=${token}" />
  </head><body><p>Redirigiendo a la app...</p></body></html>`);
});

// Esquema de usuario temporal
const pendingUserSchema = new mongoose.Schema({
  nombre: String,
  apellido: String,
  apodo: String,
  correo: { type: String, unique: true },
  password: String,
  tokenVerificacion: String,
  tokenExpira: Date
});
const PendingUser = mongoose.model('pending_user', pendingUserSchema);

// Esquema de usuario final incluyendo recuperación de contraseña
const userSchema = new mongoose.Schema({
  nombre:    { type: String, required: true },
  apellido:  { type: String, required: true },
  apodo:     { type: String, unique: true, required: true },
  correo:    { type: String, unique: true, required: true },
  password:  { type: String, required: true },
  verificado:{ type: Boolean, default: true },
  tokenReset:  String,
  tokenExpira: Date,
    library: [{
    cardId:   { type: String, required: true },
    quantity: { type: Number, default: 1 }
  }]
});
const Usuario = mongoose.model('user', userSchema);

// Registro y verificación
app.post('/register-request', async (req, res) => {
  const { nombre, apellido, apodo, correo, password } = req.body;
  if (!nombre || !apellido || !apodo || !correo || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }
  try {
    if (await Usuario.findOne({ apodo }))  return res.status(400).json({ error: 'El apodo ya está en uso' });
    if (await Usuario.findOne({ correo })) return res.status(400).json({ error: 'El correo ya está registrado' });
    await PendingUser.deleteOne({ correo });
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);
    const token = crypto.randomBytes(32).toString('hex');
    await PendingUser.create({ nombre, apellido, apodo, correo, password: hashed, tokenVerificacion: token, tokenExpira: new Date(Date.now()+10*60*1000) });
    await sendVerificationLink(correo, token);
    res.status(200).json({ message: 'Correo de verificación enviado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar registro', detalles: err.message });
  }
});
app.get('/verify-token', async (req, res) => {
  const { token } = req.query;
  try {
    const p = await PendingUser.findOne({ tokenVerificacion: token });
    if (!p) return res.status(400).json({ error: 'Token inválido o ya usado' });
    if (p.tokenExpira < new Date()) return res.status(400).json({ error: 'Token expirado' });
    await Usuario.create({ nombre:p.nombre, apellido:p.apellido, apodo:p.apodo, correo:p.correo, password:p.password, verificado:true });
    await PendingUser.deleteOne({ correo:p.correo });
    res.status(201).json({ message: 'Cuenta verificada exitosamente' });
  } catch (err) {
    res.status(500).json({ error:'Error al verificar token', detalles:err.message });
  }
});

// Autenticación estándar
app.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ error:'Correo y contraseña son obligatorios' });
  try {
    const u = await Usuario.findOne({ correo });
    if (!u) return res.status(400).json({ error:'Correo no registrado' });
    if (!await bcrypt.compare(password, u.password)) return res.status(401).json({ error:'Contraseña incorrecta' });
    res.json({ message:'Inicio de sesión exitoso', usuario:{ id:u._id, apodo:u.apodo, correo:u.correo, nombre:u.nombre } });
  } catch(err) {
    res.status(500).json({ error:'Error al iniciar sesión', detalles:err.message });
  }
});
app.get('/usuarios', async (req, res) => {
  try { res.json(await Usuario.find().select('-password')); } catch(err) { res.status(500).json({ error:'Error al obtener usuarios', detalles:err.message }); }
});

// Recuperación de contraseña
app.post('/forgot-password', async (req, res) => {
  const { correo } = req.body;
  if (!correo) return res.status(400).json({ error:'Correo es obligatorio' });
  try {
    const u = await Usuario.findOne({ correo });
    if (!u) return res.status(400).json({ error:'Correo no registrado' });
    const token = crypto.randomBytes(32).toString('hex');
    u.tokenReset  = token;
    u.tokenExpira = new Date(Date.now()+10*60*1000);
    await u.save();
    const link = `https://myappserve-go.onrender.com/reset-redirect?token=${token}`;
    await transporter.sendMail({ from:`"SetMatch Soporte" <${process.env.EMAIL_USER}>`, to:correo, subject:'Restablecer contraseña - SetMatch', html:`<h2>Restablecer tu contraseña</h2><p><a href="${link}">${link}</a></p><p>Expira en 10 minutos.</p>` });
    console.log('[forgot-password] Token generado', { correo, token });
    res.status(200).json({ message:'Enlace de recuperación enviado' });
  } catch(err) {
    res.status(500).json({ error:'Error al procesar recuperación', detalles:err.message });
  }
});
app.get('/reset-redirect', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Token faltante');
  res.send(`<html><head><meta http-equiv="refresh" content="0; url=setmatch://restablecer?token=${token}" /></head><body><p>Redirigiendo a la app...</p></body></html>`);
});
app.post('/reset-password', async (req, res) => {
  const { token, nuevaPassword } = req.body;
  if (!token || !nuevaPassword) {
    console.error('[reset-password] Falta token o nuevaPassword', { token, nuevaPassword });
    return res.status(400).json({ error:'Token y nueva contraseña son obligatorios' });
  }
  try {
    const u = await Usuario.findOne({ tokenReset:token });
    if (!u) {
      console.error('[reset-password] Token inválido o ya usado', { token });
      return res.status(400).json({ error:'Token inválido o ya usado', details:{ receivedToken:token } });
    }
    if (u.tokenExpira < new Date()) {
      console.error('[reset-password] Token expirado', { token, expiresAt:u.tokenExpira });
      u.tokenReset = undefined;
      u.tokenExpira=undefined;
      await u.save();
      return res.status(400).json({ error:'El token ha expirado', details:{ receivedToken:token, expiredAt:u.tokenExpira } });
    }
    const salt = await bcrypt.genSalt(10);
    u.password = await bcrypt.hash(nuevaPassword, salt);
    u.tokenReset = undefined;
    u.tokenExpira=undefined;
    await u.save();
    console.log('[reset-password] Contraseña restablecida', { userId:u._id });
    res.status(200).json({ message:'Contraseña restablecida correctamente' });
  } catch(err) {
    console.error('[reset-password] Error interno', err);
    res.status(500).json({ error:'Error al restablecer contraseña', detalles:err.message, stack:err.stack });
  }
});

// --- Librería de cartas: agregar, remover y listar ---


// 📥 Agregar 1 carta (incrementa cantidad o la inserta)
app.post('/library/add', async (req, res) => {
  const { userId, cardId } = req.body;
  if (!userId || !cardId) {
    return res.status(400).json({ error: 'Falta userId o cardId' });
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }

  try {
    const user = await Usuario.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const entry = user.library.find(e => e.cardId === cardId);
    if (entry) {
      entry.quantity += 1;
    } else {
      user.library.push({ cardId, quantity: 1 });
    }

    await user.save();
    res.json({ library: user.library });
  } catch (err) {
    console.error('[library/add]', err);
    res.status(500).json({ error: 'Error interno al agregar carta' });
  }
});

// 📤 Quitar 1 carta (decrementa o elimina si queda 0)
app.post('/library/remove', async (req, res) => {
  const { userId, cardId } = req.body;
  if (!userId || !cardId) {
    return res.status(400).json({ error: 'Falta userId o cardId' });
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }

  try {
    const user = await Usuario.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const idx = user.library.findIndex(e => e.cardId === cardId);
    if (idx === -1) {
      return res.status(400).json({ error: 'Carta no existe en librería' });
    }

    user.library[idx].quantity -= 1;
    if (user.library[idx].quantity <= 0) {
      user.library.splice(idx, 1);
    }

    await user.save();
    res.json({ library: user.library });
  } catch (err) {
    console.error('[library/remove]', err);
    res.status(500).json({ error: 'Error interno al quitar carta' });
  }
});

// 📄 Obtener biblioteca del usuario
app.get('/library', async (req, res) => {
  const { userId } = req.query;

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID de usuario inválido o faltante' });
  }

  try {
    const user = await Usuario.findById(userId).select('library');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({ library: user.library || [] });
  } catch (err) {
    console.error('[library/get]', err);
    res.status(500).json({ error: 'Error interno al obtener la biblioteca' });
  }
});



// 404 y errores
app.use((req, res) => res.status(404).json({ error:`Ruta ${req.method} ${req.originalUrl} no encontrada` }));
app.use((err, req, res, next) => { console.error(err.stack); res.status(500).json({ error:'Error interno', mensaje:err.message }); });

// Iniciar servidor
const PORT = process.env.PORT||3000;
app.listen(PORT,()=>console.log(`🚀 Servidor corriendo en puerto ${PORT}`));
