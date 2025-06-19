const express     = require('express');
const cors        = require('cors');
const mongoose    = require('mongoose');
const nodemailer  = require('nodemailer');
const crypto      = require('crypto');
require('dotenv').config();
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');

// Validar variables de entorno críticas
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET no está definida en el entorno.');
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error('FATAL ERROR: MONGO_URI no está definida en el entorno.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI  = process.env.MONGO_URI;


const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://tu-frontend.com' }));

// Conectar a MongoDB
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch(err => {
    console.error('❌ Error al conectar a MongoDB:', err);
    process.exit(1);
  });

// Middleware para verificar JWT
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Formato de token inválido' });
  }

  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { id: decoded.userId, apodo: decoded.apodo };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}



// Configurar transporter de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// === Esquema de Mongoose para historial de ofertas ===
const offerSchema = new mongoose.Schema({
  sellerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },  // ID del vendedor
  buyerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },  // ID del comprador
  buyerName:  { type: String, required: true },                                      // Nombre visible del comprador
  amount:     { type: Number, required: true },                                      // Monto total de la oferta
  mode:       { type: String, enum: ['trend','low','manual'], required: true },       // Modo de cálculo (agregado para inmutabilidad)
  date:       { type: Date, default: Date.now },                                     // Fecha de creación
  cards: [                                                                             // Detalles de cada carta incluida en la oferta
    {
      cardId:    { type: String, required: true },  // ID de la carta
      quantity:  { type: Number, required: true },  // Cantidad ofertada
      unitPrice: { type: Number, required: true }   // Precio unitario fijado en ese momento
    }
  ]
});
const Offer = mongoose.model('offer', offerSchema);

// --- Envío de enlaces de verificación ---
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://myappserve-go.onrender.com';

const sendVerificationLink = async (correo, token) => {
  const safeToken = encodeURIComponent(token);
  const link = `${APP_BASE_URL}/open-app?token=${safeToken}`;
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
// Ruta de deep link para verificación
app.get('/open-app', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('Token faltante');
  }

  const safeToken = encodeURIComponent(token);
  const deepLink = `setmatch://verificar?token=${safeToken}`;

  res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Redirigiendo…</title>
  <meta http-equiv="refresh" content="0;url=${deepLink}" />
  <script>window.location.href='${deepLink}';</script>
</head>
<body>
  <p>Redirigiendo a la app…</p>
  <p>Si no funciona automáticamente, <a href="${deepLink}">haz clic aquí</a>.</p>
</body>
</html>`);
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
  nombre:       { type: String, required: true },
  apellido:     { type: String, required: true },
  apodo:        { type: String, unique: true, required: true },
  correo:       { type: String, unique: true, required: true },
  password:     { type: String, required: true },
  verificado: { type: Boolean, default: false },
  tokenReset:   String,
  tokenExpira:  Date,
  library: [
    {
      cardId:   { type: String, required: true },
      quantity: { type: Number, default: 1 }
    }
  ],
  friends:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],  // lista de amigos
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }]   // usuarios bloqueados
});
const Usuario = mongoose.model('user', userSchema);

// === Definición de esquema y modelo para solicitudes de amistad ===
const friendRequestSchema = new mongoose.Schema({
  from:   { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  to:     { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  status: { type: String, enum: ['pending','accepted','rejected'], default: 'pending' }
}, { timestamps: true });
friendRequestSchema.index({ from: 1, to: 1, status: 1 }, { unique: true });
const FriendRequest = mongoose.model('friend_request', friendRequestSchema);

// Esquema de notificaciones con partner, friendRequestId, cards y amount para ofertas
const notificationSchema = new mongoose.Schema({
  user:            { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  partner:         { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
  role:            { type: String, enum: ['sender', 'receiver'], required: true },
  friendRequestId: { type: mongoose.Schema.Types.ObjectId, ref: 'friend_request' },
  message:         { type: String, required: true },
  type:            { type: String, enum: ['offer', 'friend_request', 'system'], default: 'system' },
  isRead:          { type: Boolean, default: false },
  status:          { type: String, enum: ['pendiente', 'aceptada', 'rechazada'], default: 'pendiente' },
  cards: [
    {
      cardId:    { type: String, required: true },
      quantity:  { type: Number, required: true },
      name:      String,
      image:     String
    }
  ],
  amount:          Number
}, { timestamps: true });

notificationSchema.index({ user: 1, isRead: 1 });

const Notification = mongoose.model('notification', notificationSchema);

// === CREAR NOTIFICACIÓN (general) – ahora con “role” obligatorio ===
app.post('/notifications', authMiddleware, async (req, res) => {
  const { userId, partner, role, message, type, cards, amount } = req.body;

  // Validar primero que el token coincide con el userId del body
  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'No autorizado para crear notificaciones para otro usuario' });
  }

  // Verificar que userId sea un ObjectId válido y que message y role existan
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !message ||
    (role !== 'sender' && role !== 'receiver')
  ) {
    return res.status(400).json({ error: 'Datos inválidos (falta userId, role o message)' });
  }

  try {
    // Crear la notificación en la base de datos
    const noti = await Notification.create({
      user:   userId,
      partner,
      role,
      message,
      type,
      cards,
      amount
    });

    // Emitir evento WebSocket al usuario destino
    io.to(userId.toString()).emit('newNotification', {
      id:        noti._id,
      user:      noti.user,
      partner:   noti.partner,
      role:      noti.role,
      message:   noti.message,
      type:      noti.type,
      cards:     noti.cards,
      amount:    noti.amount,
      createdAt: noti.createdAt
    });

    return res.status(201).json({ notification: noti });
  } catch (err) {
    console.error('[notifications/create]', err);
    return res.status(500).json({ error: 'Error interno al crear notificación' });
  }
});





app.post('/offer', authMiddleware, async (req, res) => {
  const { from, to, cardsArray, offerAmount } = req.body;

  // Validar primero que el token coincide con el campo “from”
  if (req.user.id !== from) {
    return res.status(403).json({ error: 'No puedes enviar oferta en nombre de otro usuario' });
  }

  // Validaciones básicas de formato
  if (
    !mongoose.Types.ObjectId.isValid(from) ||
    !mongoose.Types.ObjectId.isValid(to) ||
    !Array.isArray(cardsArray) ||
    !offerAmount
  ) {
    return res.status(400).json({ error: 'Datos de oferta inválidos' });
  }

  try {
    const sender = await Usuario.findById(from).select('apodo');
    const receiver = await Usuario.findById(to).select('apodo');

    // Crear notificación para el RECEPTOR
    const receiverNoti = await Notification.create({
      user:    to,
      partner: from,
      role:    'receiver',
      message: `Has recibido una oferta de ${sender.apodo}`,
      type:    'offer',
      cards:   cardsArray,
      amount:  parseFloat(offerAmount)
    });

    io.to(to.toString()).emit('newNotification', {
      id:        receiverNoti._id,
      user:      receiverNoti.user,
      partner:   receiverNoti.partner,
      role:      receiverNoti.role,
      message:   receiverNoti.message,
      type:      receiverNoti.type,
      cards:     receiverNoti.cards,
      amount:    receiverNoti.amount,
      createdAt: receiverNoti.createdAt
    });

    // Crear notificación para el EMISOR
    const senderNoti = await Notification.create({
      user:    from,
      partner: to,
      role:    'sender',
      message: `Esperando respuesta de ${receiver.apodo}`,
      type:    'offer',
      cards:   cardsArray,
      amount:  parseFloat(offerAmount)
    });

    io.to(from.toString()).emit('newNotification', {
      id:        senderNoti._id,
      user:      senderNoti.user,
      partner:   senderNoti.partner,
      role:      senderNoti.role,
      message:   senderNoti.message,
      type:      senderNoti.type,
      cards:     senderNoti.cards,
      amount:    senderNoti.amount,
      createdAt: senderNoti.createdAt
    });

    return res.status(201).json({ message: 'Oferta enviada y notificaciones creadas' });
  } catch (err) {
    console.error('[offer] error:', err);
    return res.status(500).json({ error: 'Error interno al enviar oferta' });
  }
});





// 3) Obtener notificaciones de un usuario (filtra por `user` y opcionalmente por `isRead`)
app.get('/notifications', authMiddleware, async (req, res) => {
  const { userId, isRead } = req.query;

  // 1) Verificar que userId viene en la query y es el mismo que en el token
  if (!userId || req.user.id !== userId) {
    return res.status(403).json({ error: 'No autorizado para ver estas notificaciones' });
  }

  // 2) Validar que sea un ObjectId válido
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  // 3) Construir filtro
  const filter = { user: userId };
  if (isRead === 'false') filter.isRead = false;

  try {
    const notis = await Notification.find(filter)
      .populate('partner', 'nombre apodo')
      .sort({ createdAt: -1 });
    const result = notis.map(n => n.toObject());
    return res.json({ notifications: result });
  } catch (err) {
    console.error('[notifications/get]', err);
    return res.status(500).json({ error: 'Error interno al obtener notificaciones' });
  }
});


// Responder oferta: cambia estado en ambas notificaciones (receptor y emisor)
app.patch('/notifications/:id/respond', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    // 1) Validar formato de ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // 2) Buscar notificación
    const noti = await Notification.findById(id);
    if (!noti) {
      return res.status(404).json({ error: 'Notificación no encontrada' });
    }

    // 3) Verificar que el usuario autenticado sea el destinatario
    if (req.user.id !== noti.user.toString()) {
      return res.status(403).json({ error: 'No autorizado para responder esta notificación' });
    }

    // 4) Validar acción
    const { action, byApodo } = req.body; // action: 'accept' | 'reject'
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Acción inválida' });
    }
    const newStatus = action === 'accept' ? 'aceptada' : 'rechazada';

    // 5) Actualizar la propia notificación
    noti.message   = action === 'accept'
                      ? `Has aceptado la oferta de ${byApodo}`
                      : `Rechazaste la oferta de ${byApodo}`;
    noti.status    = newStatus;
    noti.isRead    = false;
    noti.createdAt = new Date();
    await noti.save();

    // 6) Emitir evento WebSocket al receptor original
    io.to(noti.user.toString()).emit('newNotification', {
      id:        noti._id,
      user:      noti.user,
      partner:   noti.partner,
      role:      noti.role,
      message:   noti.message,
      type:      noti.type,
      status:    noti.status,
      cards:     noti.cards,
      amount:    noti.amount,
      createdAt: noti.createdAt
    });

    // 7) Buscar y actualizar la notificación contrapartida (emisor)
    const counterpart = await Notification.findOne({
      user:    noti.partner,
      partner: noti.user,
      type:    'offer',
      amount:  noti.amount,
      'cards.cardId': { $in: noti.cards.map(c => c.cardId) }
    });
    if (counterpart) {
      counterpart.message   = action === 'accept'
                              ? `Tu oferta ha sido aceptada por ${byApodo}`
                              : `Tu oferta ha sido rechazada por ${byApodo}`;
      counterpart.status    = newStatus;
      counterpart.isRead    = false;
      counterpart.createdAt = new Date();
      await counterpart.save();

      // 8) Emitir evento WebSocket al emisor original
      io.to(counterpart.user.toString()).emit('newNotification', {
        id:        counterpart._id,
        user:      counterpart.user,
        partner:   counterpart.partner,
        role:      counterpart.role,
        message:   counterpart.message,
        type:      counterpart.type,
        status:    counterpart.status,
        cards:     counterpart.cards,
        amount:    counterpart.amount,
        createdAt: counterpart.createdAt
      });
    }

    return res.json({ message: `Notificación(es) actualizada(s) a estado '${newStatus}'` });
  } catch (err) {
    console.error('[notifications/respond]', err);
    return res.status(500).json({ error: 'Error interno al actualizar notificación' });
  }
});


// === REGISTRO Y VERIFICACIÓN ===
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
    await PendingUser.create({
      nombre,
      apellido,
      apodo,
      correo,
      password: hashed,
      tokenVerificacion: token,
      tokenExpira: new Date(Date.now() + 10 * 60 * 1000)
    });
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
    await Usuario.create({
      nombre: p.nombre,
      apellido: p.apellido,
      apodo: p.apodo,
      correo: p.correo,
      password: p.password,
      verificado: true
    });
    await PendingUser.deleteOne({ correo: p.correo });
    res.status(201).json({ message: 'Cuenta verificada exitosamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al verificar token', detalles: err.message });
  }
});

// ====================
//   Ruta de LOGIN
// ====================
app.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
  }

  try {
    const u = await Usuario.findOne({ correo });
    if (!u) {
      return res.status(400).json({ error: 'Correo no registrado' });
    }

    // Verificar que la cuenta esté confirmada
    if (!u.verificado) {
      return res.status(403).json({ error: 'Cuenta no verificada. Revisa tu correo.' });
    }

    // Comparar contraseña
    const match = await bcrypt.compare(password, u.password);
    if (!match) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Generar payload mínimo para el JWT
    const payload = {
      userId: u._id.toString(),
      apodo:  u.apodo
    };

    // Firmar el token con la clave secreta (aquí aseguramos que expire en 1 día)
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

    return res.status(200).json({
      message: 'Inicio de sesión exitoso',
      token,   
      usuario: {
        id:      u._id,
        apodo:   u.apodo,
        correo:  u.correo,
        nombre:  u.nombre,
        apellido:u.apellido
      }
    });
  } catch (err) {
    console.error('[login] error:', err);
    return res.status(500).json({ error: 'Error al iniciar sesión', detalles: err.message });
  }
});



app.get('/usuarios', async (req, res) => {
  try {
    res.json(await Usuario.find().select('-password'));
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios', detalles: err.message });
  }
});

// Recuperación de contraseña
app.post('/forgot-password', async (req, res) => {
  const { correo } = req.body;
  if (!correo) return res.status(400).json({ error: 'Correo es obligatorio' });
  try {
    const u = await Usuario.findOne({ correo });
    if (!u) return res.status(400).json({ error: 'Correo no registrado' });
    const token = crypto.randomBytes(32).toString('hex');
    u.tokenReset  = token;
    u.tokenExpira = new Date(Date.now() + 10 * 60 * 1000);
    await u.save();
    const link = `${APP_BASE_URL}/reset-redirect?token=${encodeURIComponent(token)}`;
    await transporter.sendMail({
      from: `"SetMatch Soporte" <${process.env.EMAIL_USER}>`,
      to: correo,
      subject: 'Restablecer contraseña - SetMatch',
      html: `<h2>Restablecer tu contraseña</h2><p><a href="${link}">${link}</a></p><p>Expira en 10 minutos.</p>`
    });
    console.log('[forgot-password] Token generado', { correo, token });
    res.status(200).json({ message: 'Enlace de recuperación enviado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar recuperación', detalles: err.message });
  }
});

app.get('/reset-redirect', (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('Token faltante');
  }

  const deepLink = `setmatch://restablecer?token=${encodeURIComponent(token)}`;
  res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Redirigiendo…</title>
  <!-- Meta-refresh correctamente formateado -->
  <meta http-equiv="refresh" content="0;url=${deepLink}" />
  <!-- Fallback JavaScript -->
  <script>window.location.href='${deepLink}';</script>
</head>
<body>
  <p>Redirigiendo a la app…</p>
  <p>Si no funciona automáticamente, <a href="${deepLink}">haz clic aquí</a>.</p>
</body>
</html>`);
});


app.post('/reset-password', async (req, res) => {
  const { token, nuevaPassword } = req.body;
  if (!token || !nuevaPassword) {
    console.error('[reset-password] Falta token o nuevaPassword', { token, nuevaPassword });
    return res.status(400).json({ error: 'Token y nueva contraseña son obligatorios' });
  }
  try {
    const u = await Usuario.findOne({ tokenReset: token });
    if (!u) {
      console.error('[reset-password] Token inválido o ya usado', { token });
      return res.status(400).json({ error: 'Token inválido o ya usado', details: { receivedToken: token } });
    }
    if (u.tokenExpira < new Date()) {
      console.error('[reset-password] Token expirado', { token, expiresAt: u.tokenExpira });
      u.tokenReset = undefined;
      u.tokenExpira = undefined;
      await u.save();
      return res.status(400).json({ error: 'El token ha expirado', details: { receivedToken: token, expiredAt: u.tokenExpira } });
    }
    const salt = await bcrypt.genSalt(10);
    u.password = await bcrypt.hash(nuevaPassword, salt);
    u.tokenReset = undefined;
    u.tokenExpira = undefined;
    await u.save();
    console.log('[reset-password] Contraseña restablecida', { userId: u._id });
    res.status(200).json({ message: 'Contraseña restablecida correctamente' });
  } catch (err) {
    console.error('[reset-password] Error interno', err);
    res.status(500).json({ error: 'Error al restablecer contraseña', detalles: err.message, stack: err.stack });
  }
});



// --- Librería de cartas: agregar, remover y listar ---

// 📥 Agregar 1 carta (incrementa cantidad o la inserta)
app.post('/library/add', authMiddleware, async (req, res) => {
  const { userId, cardId } = req.body;
  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'No autorizado para modificar esta biblioteca' });
  }
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
app.post('/library/remove', authMiddleware, async (req, res) => {
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
app.get('/library', authMiddleware, async (req, res) => {
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

// 👥 Buscar usuarios
app.get('/users/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Falta query' });
  const regex = new RegExp(query, 'i');
  try {
    const users = await Usuario.find({
      $or: [
        { nombre:  regex },
        { apellido: regex },
        { apodo:   regex }
      ]
    }).select('nombre apellido apodo _id correo');
    res.json({ users });
  } catch (err) {
    console.error('[users/search]', err);
    res.status(500).json({ error: 'Error interno en búsqueda' });
  }
});

// === Obtener solicitudes de amistad pendientes para un usuario ===
app.get('/friend-requests', authMiddleware, async (req, res) => {
  const { userId } = req.query;
  if (!mongoose.Types.ObjectId.isValid(userId))
    return res.status(400).json({ error: 'ID inválido o faltante' });
  try {
    const requests = await FriendRequest.find({ to: userId, status: 'pending' })
      .populate('from', 'nombre apellido apodo _id');
    res.json({ requests });
  } catch (err) {
    console.error('[friend-requests] error:', err);
    res.status(500).json({ error: 'Error interno al obtener solicitudes' });
  }
});


app.post('/friend-request',authMiddleware, async (req, res) => {
  const { from, to } = req.body;
  if (
    !mongoose.Types.ObjectId.isValid(from) ||
    !mongoose.Types.ObjectId.isValid(to)
  ) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  if (from === to) {
    return res.status(400).json({ error: 'No puedes enviarte una solicitud a ti mismo' });
  }

  try {
    const exists = await FriendRequest.findOne({ from, to, status: 'pending' });
    if (exists) {
      return res.status(400).json({ error: 'Solicitud ya enviada' });
    }
    const request = await FriendRequest.create({ from, to });
    const userFrom = await Usuario.findById(from).select('nombre apodo');
    const userTo = await Usuario.findById(to).select('nombre apodo');

    // Notificación para el RECEPTOR (receiver)
    const recvNoti = await Notification.create({
      user:            to,
      partner:         from,
      role:            'receiver',
      friendRequestId: request._id,
      message:         `Nueva solicitud de amistad de ${userFrom.nombre}`,
      type:            'friend_request',
      status:          'pendiente'
    });
    io.to(to.toString()).emit('newNotification', {
      id:        recvNoti._id,
      user:      recvNoti.user,
      partner:   recvNoti.partner,
      role:      recvNoti.role,
      message:   recvNoti.message,
      type:      recvNoti.type,
      status:    recvNoti.status,
      createdAt: recvNoti.createdAt
    });

    // Notificación para el EMISOR (sender)
    const sendNoti = await Notification.create({
      user:            from,
      partner:         to,
      role:            'sender',
      friendRequestId: request._id,
      message:         `Enviaste una solicitud a ${userTo.nombre}`,
      type:            'friend_request',
      status:          'pendiente'
    });
    io.to(from.toString()).emit('newNotification', {
      id:        sendNoti._id,
      user:      sendNoti.user,
      partner:   sendNoti.partner,
      role:      sendNoti.role,
      message:   sendNoti.message,
      type:      sendNoti.type,
      status:    sendNoti.status,
      createdAt: sendNoti.createdAt
    });

    return res.json({ request });
  } catch (err) {
    console.error('[friend-request] error:', err);
    return res.status(500).json({ error: 'Error interno al enviar solicitud' });
  }
});


// === Solicitudes enviadas por mí ===
app.get('/friend-requests/sent', authMiddleware, async (req, res) => {
  const { userId } = req.query;
  // 1) Validaciones
  if (!mongoose.Types.ObjectId.isValid(userId))
    return res.status(400).json({ error: 'ID inválido' });
  if (req.user.id !== userId)
    return res.status(403).json({ error: 'No autorizado' });

  try {
    // 2) Buscar solicitudes donde yo soy el emisor
    const requests = await FriendRequest
      .find({ from: userId, status: 'pending' })
      .populate('to', 'nombre apellido apodo _id');

    return res.json({ requests });
  } catch (err) {
    console.error('[friend-requests/sent] error:', err);
    return res.status(500).json({ error: 'Error interno al obtener solicitudes enviadas' });
  }
});

// === (Opcional) Solicitudes recibidas para mí ===
app.get('/friend-requests/received', authMiddleware, async (req, res) => {
  const { userId } = req.query;
  if (!mongoose.Types.ObjectId.isValid(userId))
    return res.status(400).json({ error: 'ID inválido' });
  if (req.user.id !== userId)
    return res.status(403).json({ error: 'No autorizado' });

  try {
    const requests = await FriendRequest
      .find({ to: userId, status: 'pending' })
      .populate('from', 'nombre apellido apodo _id');

    return res.json({ requests });
  } catch (err) {
    console.error('[friend-requests/received] error:', err);
    return res.status(500).json({ error: 'Error interno al obtener solicitudes recibidas' });
  }
});


// === RUTA ACTUALIZADA DE ACEPTAR SOLICITUD ===
app.post('/friend-request/:id/accept', authMiddleware, async (req, res) => {
  const { id } = req.params;

  // 1) Validar formato de ID
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID de solicitud inválido' });
  }

  try {
    // 2) Obtener solicitud
    const reqDoc = await FriendRequest.findById(id);
    if (!reqDoc || reqDoc.status !== 'pending') {
      return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada' });
    }

    // 3) Verificar que el usuario autenticado sea el receptor (“to”)
    if (req.user.id !== reqDoc.to.toString()) {
      return res.status(403).json({ error: 'No autorizado para aceptar esta solicitud' });
    }

    // 4) Cambiar estado de la solicitud
    reqDoc.status = 'accepted';
    await reqDoc.save();

    const { from, to } = reqDoc;

    // 5) Agregar a amigos mutuamente
    await Promise.all([
      Usuario.findByIdAndUpdate(from, { $addToSet: { friends: to } }),
      Usuario.findByIdAndUpdate(to,   { $addToSet: { friends: from } })
    ]);

    const userFrom = await Usuario.findById(from).select('nombre apodo');
    const userTo   = await Usuario.findById(to).select('nombre apodo');

    // 6) Actualizar notificación del EMISOR a “aceptada”
    const updateSend = await Notification.findOneAndUpdate(
      { user: from, partner: to, type: 'friend_request', status: 'pendiente', friendRequestId: id },
      { message: `Tu solicitud fue aceptada por ${userTo.nombre}`, status: 'aceptada', isRead: false, createdAt: new Date() },
      { new: true }
    );
    io.to(from.toString()).emit('newNotification', {
      id:        updateSend._id,
      user:      updateSend.user,
      partner:   updateSend.partner,
      role:      updateSend.role,
      message:   updateSend.message,
      type:      updateSend.type,
      status:    updateSend.status,
      createdAt: updateSend.createdAt
    });

    // 7) Crear notificación para el RECEPTOR de aceptación
    const recvNoti = await Notification.create({
      user:            to,
      partner:         from,
      role:            'receiver',
      friendRequestId: id,
      message:         `Has aceptado la solicitud de amistad de ${userFrom.nombre}`,
      type:            'friend_request',
      status:          'aceptada'
    });
    io.to(to.toString()).emit('newNotification', {
      id:        recvNoti._id,
      user:      recvNoti.user,
      partner:   recvNoti.partner,
      role:      recvNoti.role,
      message:   recvNoti.message,
      type:      recvNoti.type,
      status:    recvNoti.status,
      createdAt: recvNoti.createdAt
    });

    return res.json({ message: 'Solicitud aceptada' });
  } catch (err) {
    console.error('[accept-request] error:', err);
    return res.status(500).json({ error: 'Error interno al aceptar solicitud' });
  }
});



// === RUTA ACTUALIZADA DE RECHAZAR SOLICITUD ===
app.post('/friend-request/:id/reject', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID de solicitud inválido' });
  }

  try {
    const reqDoc = await FriendRequest.findById(id);
    if (!reqDoc || reqDoc.status !== 'pending') {
      return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada' });
    }

    // Cambiar estado a 'rejected'
    reqDoc.status = 'rejected';
    await reqDoc.save();

    const { from, to } = reqDoc;
    const userFrom = await Usuario.findById(from).select('nombre apodo');
    const userTo = await Usuario.findById(to).select('nombre apodo');

    // Actualizar la notificación del EMISOR (sender) a rechazada
    const updateSend = await Notification.findOneAndUpdate(
      {
        user:            from,
        partner:         to,
        type:            'friend_request',
        status:          'pendiente',
        friendRequestId: id
      },
      {
        message:   `Tu solicitud fue rechazada por ${userTo.nombre}`,
        status:    'rechazada',
        isRead:    false,
        createdAt: new Date()
      },
      { new: true }
    );
    io.to(from.toString()).emit('newNotification', {
      id:        updateSend._id,
      user:      updateSend.user,
      partner:   updateSend.partner,
      role:      updateSend.role,
      message:   updateSend.message,
      type:      updateSend.type,
      status:    updateSend.status,
      createdAt: updateSend.createdAt
    });

    // Crear notificación para el RECEPTOR (receiver) de rechazo
    const recvNoti = await Notification.create({
      user:            to,
      partner:         from,
      role:            'receiver',
      friendRequestId: id,
      message:         `Has rechazado la solicitud de amistad de ${userFrom.nombre}`,
      type:            'friend_request',
      status:          'rechazada'
    });
    io.to(to.toString()).emit('newNotification', {
      id:        recvNoti._id,
      user:      recvNoti.user,
      partner:   recvNoti.partner,
      role:      recvNoti.role,
      message:   recvNoti.message,
      type:      recvNoti.type,
      status:    recvNoti.status,
      createdAt: recvNoti.createdAt
    });

    return res.json({ message: 'Solicitud rechazada' });
  } catch (err) {
    console.error('[reject-request] error:', err);
    return res.status(500).json({ error: 'Error interno al rechazar solicitud' });
  }
});




// === ELIMINAR AMISTAD ===
app.post('/friend-remove',authMiddleware, async (req, res) => {
  const { userId, friendId } = req.body;
  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'No autorizado para eliminar esta amistad' });
  }
  if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(friendId)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    await Promise.all([
      Usuario.findByIdAndUpdate(userId, { $pull: { friends: friendId }}),
      Usuario.findByIdAndUpdate(friendId, { $pull: { friends: userId }})
    ]);
    // Eliminar solicitudes de amistad pendientes entre ambos
    await FriendRequest.deleteMany({
      $or: [
        { from: userId, to: friendId },
        { from: friendId, to: userId }
      ]
    });
    res.json({ message: 'Amistad eliminada y solicitudes pendientes borradas' });
  } catch (err) {
    console.error('[friend-remove] error:', err);
    res.status(500).json({ error: 'Error interno al eliminar amistad' });
  }
});

// === BLOQUEAR USUARIO ===
app.post('/user-block', authMiddleware ,async (req, res) => {
  const { blocker, blocked } = req.body;
  if (!mongoose.Types.ObjectId.isValid(blocker) || !mongoose.Types.ObjectId.isValid(blocked)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    await Promise.all([
      Usuario.findByIdAndUpdate(blocker, { $addToSet: { blockedUsers: blocked }, $pull: { friends: blocked }}),
      Usuario.findByIdAndUpdate(blocked, { $pull: { friends: blocker }})
    ]);
    // Eliminar solicitudes pendientes
    await FriendRequest.deleteMany({
      $or: [
        { from: blocker, to: blocked },
        { from: blocked, to: blocker }
      ]
    });
    res.json({ message: 'Usuario bloqueado' });
  } catch (err) {
    console.error('[user-block] error:', err);
    res.status(500).json({ error: 'Error interno al bloquear usuario' });
  }
});

// === DESBLOQUEAR USUARIO ===
app.post('/user-unblock', authMiddleware, async (req, res) => {
  const unblocker = req.user.id;
  const { unblocked } = req.body;

  console.info(`[user-unblock] Solicitud de desbloqueo por ${unblocker}, target=${unblocked}`);

  // 1) Validación de ID
  if (!mongoose.Types.ObjectId.isValid(unblocked)) {
    console.warn(`[user-unblock] ID inválido: ${unblocked}`);
    return res
      .status(400)
      .json({ success: false, message: 'ID de usuario inválido.' });
  }

  try {
    // 2) Operación de actualización
    const result = await Usuario.findByIdAndUpdate(
      unblocker,
      { $pull: { blockedUsers: unblocked } },
      { new: true }
    );

    if (!result) {
      console.warn(`[user-unblock] Usuario origin ${unblocker} no encontrado`);
      return res
        .status(404)
        .json({ success: false, message: 'Usuario no encontrado.' });
    }

    console.info(
      `[user-unblock] Éxito: bloqueados ahora = ${result.blockedUsers.join(', ')}`
    );
    return res.json({
      success: true,
      message: 'Usuario desbloqueado correctamente.',
      data: { blockedUsers: result.blockedUsers }
    });
  } catch (err) {
    console.error('[user-unblock] Error interno:', err);
    return res
      .status(500)
      .json({ success: false, message: 'Error interno al desbloquear usuario.' });
  }
});



// === OBTENER USUARIOS BLOQUEADOS ===
app.get('/user-blocked',authMiddleware , async (req, res) => {
  const { userId } = req.query;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID inválido o faltante' });
  }
  try {
    const user = await Usuario.findById(userId).populate('blockedUsers', 'nombre apellido apodo _id');
    res.json({ blocked: user.blockedUsers || [] });
  } catch (err) {
    console.error('[user-blocked] error:', err);
    res.status(500).json({ error: 'Error interno al obtener bloqueados' });
  }
});


app.get('/friends', authMiddleware, async (req, res) => {
  const { userId } = req.query;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID inválido o faltante' });
  }
  // Verificar que userId coincide con el token
  if (req.user.id !== userId) {
    return res.status(403).json({ error: 'No autorizado para ver esta lista de amigos' });
  }
  try {
    const user = await Usuario.findById(userId).populate('friends', 'nombre apellido apodo _id');
    return res.json({ friends: user ? user.friends : [] });
  } catch (err) {
    console.error('[friends/get] error:', err);
    return res.status(500).json({ error: 'Error interno al obtener amigos' });
  }
});

// === NUEVO ENDPOINT: GUARDAR HISTORIAL DE OFERTAS ===
app.post('/api/offers', authMiddleware, async (req, res) => {
  // Desestructuramos también `mode` que es obligatorio en el esquema
  const { sellerId, buyerId, buyerName, amount, mode, date, cards } = req.body;

  // 1) Verificar que el token coincide con sellerId
  if (req.user.id !== sellerId) {
    return res.status(403).json({ error: 'No autorizado para crear oferta para otro usuario' });
  }

  // 2) Validaciones básicas
  if (
    !mongoose.Types.ObjectId.isValid(sellerId) ||
    !mongoose.Types.ObjectId.isValid(buyerId) ||
    typeof amount !== 'number' ||
    !['trend', 'low', 'manual'].includes(mode) ||
    !Array.isArray(cards)
  ) {
    return res.status(400).json({ error: 'Datos de oferta inválidos' });
  }

  try {
    // 3) Creamos el documento incluyendo `mode`
    const offer = new Offer({ sellerId, buyerId, buyerName, amount, mode, date, cards });
    await offer.save();
    return res.status(201).json({ offer });
  } catch (err) {
    console.error('[offers/create]', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/offers', authMiddleware, async (req, res) => {
  // No usar req.query.userId: mejor usar el que viene en el token
  const sellerId = req.user.id;

  if (!mongoose.Types.ObjectId.isValid(sellerId)) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }

  try {
    const offers = await Offer.find({ sellerId }).sort({ date: -1 });
    return res.json({ offers });
  } catch (err) {
    console.error('[offers/get]', err);
    return res.status(500).json({ error: 'Error interno al obtener historial' });
  }
});




// === Manejadores de rutas no encontradas y errores globales ===
app.use((req, res) => res.status(404).json({ error: `Ruta ${req.method} ${req.originalUrl} no encontrada` }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno', mensaje: err.message });
});

// -------------------- INTEGRACIÓN DE SOCKET.IO --------------------
// Al final del archivo:
const http = require('http');
const { Server } = require('socket.io');

// …[todas las rutas y middlewares arriba]…

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' }  // ← restringir a tu frontend
});

io.on('connection', socket => {
  console.log('🔌 Cliente conectado:', socket.id);
  socket.on('registerUser', userId => {
    socket.join(userId);
    console.log(`🆔 Usuario ${userId} registrado en la sala ${userId}`);
  });
  socket.on('disconnect', () => {
    console.log('❌ Cliente desconectado:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor (Express + Socket.IO) corriendo en puerto ${PORT}`);
});
