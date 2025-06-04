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
mongoose
  .connect(MONGO_URI)
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
  nombre:       { type: String, required: true },
  apellido:     { type: String, required: true },
  apodo:        { type: String, unique: true, required: true },
  correo:       { type: String, unique: true, required: true },
  password:     { type: String, required: true },
  verificado:   { type: Boolean, default: true },
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




// === CREAR NOTIFICACIÓN (general) ===
// ========== Rutas de la API ==========

// 1) Crear notificación genérica (se usa para ofrecer o para solicitudes)
// === CREAR NOTIFICACIÓN (general) – ahora con “role” obligatorio ===
// === CREAR NOTIFICACIÓN (general) – ahora con “role” obligatorio ===
app.post('/notifications', async (req, res) => {
  const { userId, partner, role, message, type, cards, amount } = req.body;
  // Verificamos que venga userId válido, message y role
  if (
    !mongoose.Types.ObjectId.isValid(userId) ||
    !message ||
    (role !== 'sender' && role !== 'receiver')
  ) {
    return res.status(400).json({ error: 'Datos inválidos (falta userId, role o message)' });
  }

  try {
    // Ahora incluimos `role` en el objeto que creamos
    const noti = await Notification.create({
      user:    userId,
      partner,
      role,      // ← aquí
      message,
      type,
      cards,
      amount
    });

    return res.status(201).json({ notification: noti });
  } catch (err) {
    console.error('[notifications/create]', err);
    return res.status(500).json({ error: 'Error interno al crear notificación' });
  }
});




app.post('/offer', async (req, res) => {
  const { from, to, cardsArray, offerAmount } = req.body;

  // 1) Validaciones básicas de formato
  if (
    !mongoose.Types.ObjectId.isValid(from) ||
    !mongoose.Types.ObjectId.isValid(to)   ||
    !Array.isArray(cardsArray)             ||
    !offerAmount
  ) {
    return res.status(400).json({ error: 'Datos de oferta inválidos' });
  }

  try {
    // 2) Obtener apodos de emisor y receptor
    const sender   = await Usuario.findById(from).select('apodo');
    const receiver = await Usuario.findById(to).select('apodo');

    // 3) Crear notificación para el RECEPTOR
    await Notification.create({
      user:    to,                                  // el receptor recibe esta notificación
      partner: from,                                // partner = el emisor real
      role:    'receiver',                          // marcamos explícitamente que esta es “receiver”
      message: `Has recibido una oferta de ${sender.apodo}`,
      type:    'offer',
      cards:   cardsArray,
      amount:  parseFloat(offerAmount)
    });

    // 4) Crear notificación para el EMISOR
    await Notification.create({
      user:    from,                                // el emisor recibe esta notificación
      partner: to,                                  // partner = el receptor real
      role:    'sender',                            // marcamos explícitamente que esta es “sender”
      message: `Esperando respuesta de ${receiver.apodo}`,
      type:    'offer',
      cards:   cardsArray,
      amount:  parseFloat(offerAmount)
    });

    return res.status(201).json({ message: 'Oferta enviada y notificaciones creadas' });
  } catch (err) {
    console.error('[offer] error:', err);
    return res.status(500).json({ error: 'Error interno al enviar oferta' });
  }
});



// 3) Obtener notificaciones de un usuario (filtra por `user` y opcionalmente por `isRead`)
app.get('/notifications', async (req, res) => {
  const { userId, isRead } = req.query;

  // 1) Validar que userId sea ObjectId válido
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  // 2) Construir filtro básico
  const filter = { user: userId };
  if (isRead === 'false') filter.isRead = false;

  try {
    // 3) Buscar notificaciones y poblar el campo partner (traemos nombre y apodo)
    const notis = await Notification.find(filter)
      .populate('partner', 'nombre apodo')
      .sort({ createdAt: -1 });

    // 4) Convertir a JSON “puro” para enviarlo
    const result = notis.map(n => n.toObject());
    return res.json({ notifications: result });
  } catch (err) {
    console.error('[notifications/get]', err);
    return res.status(500).json({ error: 'Error interno al obtener notificaciones' });
  }
});


// 4) Responder oferta: cambia estado en ambas notificaciones (receptor y emisor)
app.patch('/notifications/:id/respond', async (req, res) => {
  const { id } = req.params;
  const { action, byApodo } = req.body; // action: 'accept' | 'reject'
  if (!['accept','reject'].includes(action)) {
    return res.status(400).json({ error: 'Acción inválida' });
  }
  const newStatus = action === 'accept' ? 'aceptada' : 'rechazada';

  try {
    // 4.1) Actualizar la notificación del receptor
    const noti = await Notification.findById(id);
    if (!noti) return res.status(404).json({ error: 'Notificación no encontrada' });

    noti.message   = action === 'accept'
                      ? `Has aceptado la oferta de ${byApodo}`
                      : `Rechazaste la oferta de ${byApodo}`;
    noti.status    = newStatus;
    noti.isRead    = false;
    noti.createdAt = new Date();
    await noti.save();

    // 4.2) Buscar la notificación contrapartida (emisor) y actualizarla
    const counterpart = await Notification.findOne({
      user:    noti.partner,    // si noti.user era el receptor, noti.partner es el emisor
      partner: noti.user,       // noti.user era el receptor
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
    }

    return res.json({
      message: `Notificación(es) actualizada(s) a estado '${newStatus}'`
    });
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
//aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
//aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
//aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
//aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
//aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
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

// Autenticación estándar
app.post('/login', async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
  try {
    const u = await Usuario.findOne({ correo });
    if (!u) return res.status(400).json({ error: 'Correo no registrado' });
    if (!await bcrypt.compare(password, u.password)) return res.status(401).json({ error: 'Contraseña incorrecta' });
    res.json({
      message: 'Inicio de sesión exitoso',
      usuario: {
        id: u._id,
        apodo: u.apodo,
        correo: u.correo,
        nombre: u.nombre
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión', detalles: err.message });
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
    const link = `https://myappserve-go.onrender.com/reset-redirect?token=${token}`;
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
  if (!token) return res.status(400).send('Token faltante');
  res.send(`<html><head><meta http-equiv="refresh" content="0; url=setmatch://restablecer?token=${token}" /></head><body><p>Redirigiendo a la app...</p></body></html>`);
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
app.get('/friend-requests', async (req, res) => {
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


app.post('/friend-request', async (req, res) => {
  const { from, to } = req.body;
  if (!mongoose.Types.ObjectId.isValid(from) || !mongoose.Types.ObjectId.isValid(to)) {
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
    const userTo   = await Usuario.findById(to).select('nombre apodo');

    // Notificación para el RECEPTOR (role: 'receiver')
    await Notification.create({
      user:            to,                           // A quién va dirigida la notificación
      partner:         from,                         // Quién envía la solicitud
      role:            'receiver',                   // <-- marcado como receptor
      friendRequestId: request._id,                  // Guardamos el ID de la solicitud aquí
      message:         `Nueva solicitud de amistad de ${userFrom.nombre}`, 
      type:            'friend_request',
      status:          'pendiente'
    });

    // Notificación para el EMISOR (role: 'sender')
    await Notification.create({
      user:            from,                         // A quién va dirigida esta notificación (el que envía)
      partner:         to,                           // Quién recibe la solicitud
      role:            'sender',                     // <-- marcado como emisor
      friendRequestId: request._id,                  // Mismo ID de solicitud
      message:         `Enviaste una solicitud a ${userTo.nombre}`, 
      type:            'friend_request',
      status:          'pendiente'
    });

    return res.json({ request });
  } catch (err) {
    console.error('[friend-request] error:', err);
    return res.status(500).json({ error: 'Error interno al enviar solicitud' });
  }
});



// === RUTA ACTUALIZADA DE ACEPTAR SOLICITUD ===
// --- Ruta actualizada de aceptar solicitud ---
app.post('/friend-request/:id/accept', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID de solicitud inválido' });
  }
  try {
    const reqDoc = await FriendRequest.findById(id);
    if (!reqDoc || reqDoc.status !== 'pending') {
      return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada' });
    }

    // 1) Cambiar estado de la solicitud
    reqDoc.status = 'accepted';
    await reqDoc.save();

    const { from, to } = reqDoc;

    // 2) Agregar a amigos mutuamente
    await Promise.all([
      Usuario.findByIdAndUpdate(from, { $addToSet: { friends: to } }),
      Usuario.findByIdAndUpdate(to,   { $addToSet: { friends: from } })
    ]);

    // 3) Obtener datos para armar los mensajes
    const userFrom = await Usuario.findById(from).select('nombre apodo');
    const userTo   = await Usuario.findById(to).select('nombre apodo');

    // 4) Actualizar la notificación del EMISOR (el que envió la solicitud)
    await Notification.findOneAndUpdate(
      {
        user:            from,          // el “from” original
        partner:         to,            // el “to” original
        type:            'friend_request',
        status:          'pendiente',
        friendRequestId: id
      },
      {
        message:   `Tu solicitud fue aceptada por ${userTo.nombre}`,
        status:    'aceptada',
        isRead:    false,
        createdAt: new Date()
      },
      { new: true }
    );

    // 5) Crear la nueva notificación para el RECEPTOR (quien acaba de aceptar)
    await Notification.create({
      user:            to,                    // el receptor original
      partner:         from,                  // quien envió la solicitud
      role:            'receiver',            // <--- aquí agregamos `role`
      friendRequestId: id,
      message:         `Has aceptado la solicitud de amistad de ${userFrom.nombre}`,
      type:            'friend_request',
      status:          'aceptada'
    });

    return res.json({ message: 'Solicitud aceptada' });
  } catch (err) {
    console.error('[accept-request] error:', err);
    return res.status(500).json({ error: 'Error interno al aceptar solicitud' });
  }
});




// === RUTA ACTUALIZADA DE RECHAZAR SOLICITUD ===
app.post('/friend-request/:id/reject', async (req, res) => {
  const { id } = req.params;

  // 1) Validar ID de solicitud
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID de solicitud inválido' });
  }

  try {
    // 2) Buscar y verificar estado pending
    const reqDoc = await FriendRequest.findById(id);
    if (!reqDoc || reqDoc.status !== 'pending') {
      return res.status(404).json({ error: 'Solicitud no encontrada o ya procesada' });
    }

    // 3) Cambiar estado a 'rejected'
    reqDoc.status = 'rejected';
    await reqDoc.save();

    const { from, to } = reqDoc;

    // Obtener datos de nombre/apodo
    const userFrom = await Usuario.findById(from).select('nombre apodo');
    const userTo   = await Usuario.findById(to).select('nombre apodo');

    // 4) Actualizar la notificación del emisor (user: from)
    await Notification.findOneAndUpdate(
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

    // 5) Crear nueva notificación para el receptor (user: to)
    await Notification.create({
      user:            to,
      partner:         from,
      friendRequestId: id,
      message:         `Has rechazado la solicitud de amistad de ${userFrom.nombre}`,
      type:            'friend_request',
      status:          'rechazada'
    });

    return res.json({ message: 'Solicitud rechazada' });
  } catch (err) {
    console.error('[reject-request] error:', err);
    return res.status(500).json({ error: 'Error interno al rechazar solicitud' });
  }
});



// === OBTENER LISTA DE AMIGOS ===
app.get('/friends', async (req, res) => {
  const { userId } = req.query;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID inválido o faltante' });
  }
  try {
    const user = await Usuario.findById(userId).populate('friends', 'nombre apellido apodo _id');
    res.json({ friends: user ? user.friends : [] });
  } catch (err) {
    console.error('[friends/get] error:', err);
    res.status(500).json({ error: 'Error interno al obtener amigos' });
  }
});

// === ELIMINAR AMISTAD ===
app.post('/friend-remove', async (req, res) => {
  const { userId, friendId } = req.body;
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
app.post('/user-block', async (req, res) => {
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
app.post('/user-unblock', async (req, res) => {
  const { unblocker, unblocked } = req.body;
  if (!mongoose.Types.ObjectId.isValid(unblocker) || !mongoose.Types.ObjectId.isValid(unblocked)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    await Usuario.findByIdAndUpdate(unblocker, { $pull: { blockedUsers: unblocked }});
    res.json({ message: 'Usuario desbloqueado' });
  } catch (err) {
    console.error('[user-unblock] error:', err);
    res.status(500).json({ error: 'Error interno al desbloquear usuario' });
  }
});

// === OBTENER USUARIOS BLOQUEADOS ===
app.get('/user-blocked', async (req, res) => {
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



// === NUEVO ENDPOINT: GUARDAR HISTORIAL DE OFERTAS ===
app.post('/api/offers', async (req, res) => {
  // Desestructuramos también `mode` que es obligatorio en el esquema
  const { sellerId, buyerId, buyerName, amount, mode, date, cards } = req.body;

  // Validaciones básicas
  if (
    !mongoose.Types.ObjectId.isValid(sellerId) ||
    !mongoose.Types.ObjectId.isValid(buyerId) ||
    typeof amount !== 'number' ||
    !['trend','low','manual'].includes(mode) ||  // Validamos el modo
    !Array.isArray(cards)
  ) {
    return res.status(400).json({ error: 'Datos de oferta inválidos' });
  }

  try {
    // Creamos el documento incluyendo `mode`
    const offer = new Offer({ sellerId, buyerId, buyerName, amount, mode, date, cards });
    await offer.save();
    return res.status(201).json({ offer });
  } catch (err) {
    console.error('[offers/create]', err);
    // Devolvemos el mensaje real de error para depuración
    return res.status(500).json({ error: err.message });
  }
});

// === Endpoint para obtener historial de ofertas de un usuario ===
app.get('/api/offers', async (req, res) => {
  const { userId } = req.query;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return res.status(400).json({ error: 'ID de usuario inválido' });
  }
  try {
    // Filtramos por sellerId (obras vendidas por el usuario)
    const offers = await Offer.find({ sellerId: userId }).sort({ date: -1 });
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

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));