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

// Configurar el transporter de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Función para enviar enlace de verificación
const sendVerificationLink = async (correo, token) => {
  const link = `setmatch://verificar?token=${token}`;
  const mailOptions = {
    from: `"SetMatch Soporte" <${process.env.EMAIL_USER}>`,
    to: correo,
    subject: 'Verificación de correo - SetMatch',
    html: `
      <h2>¡Bienvenido a SetMatch!</h2>
      <p>Haz clic en el siguiente enlace para verificar tu cuenta:</p>
      <a href="${link}">${link}</a>
      <p>Este enlace expirará en 10 minutos.</p>
    `
  };
  await transporter.sendMail(mailOptions);
};

// Definir el esquema de usuario temporal (para verificación)
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

// Definir el esquema de usuario final
const userSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  apodo: { type: String, unique: true, required: true },
  correo: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  verificado: { type: Boolean, default: true }
});

const Usuario = mongoose.model('user', userSchema);

// 👉 Ruta para iniciar registro y enviar token de verificación
app.post('/register-request', async (req, res) => {
  const { nombre, apellido, apodo, correo, password } = req.body;

  if (!nombre || !apellido || !apodo || !correo || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    const apodoExistente = await Usuario.findOne({ apodo });
    if (apodoExistente) {
      return res.status(400).json({ error: 'El apodo ya está en uso' });
    }

    const correoExistente = await Usuario.findOne({ correo });
    if (correoExistente) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }

    await PendingUser.deleteOne({ correo }); // eliminar intentos anteriores

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const token = crypto.randomBytes(32).toString('hex');

    const nuevoPendiente = new PendingUser({
      nombre,
      apellido,
      apodo,
      correo,
      password: hashedPassword,
      tokenVerificacion: token,
      tokenExpira: new Date(Date.now() + 10 * 60 * 1000) // 10 minutos
    });

    await nuevoPendiente.save();
    await sendVerificationLink(correo, token);

    res.status(200).json({ message: 'Correo de verificación enviado' });
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar registro', detalles: err.message });
  }
});

// 👉 Ruta para verificar el token desde el deep link
app.get('/verify-token', async (req, res) => {
  const { token } = req.query;

  try {
    const pendiente = await PendingUser.findOne({ tokenVerificacion: token });
    if (!pendiente) {
      return res.status(400).json({ error: 'Token inválido o ya utilizado' });
    }

    if (pendiente.tokenExpira < new Date()) {
      return res.status(400).json({ error: 'El token ha expirado' });
    }

    const nuevoUsuario = new Usuario({
      nombre: pendiente.nombre,
      apellido: pendiente.apellido,
      apodo: pendiente.apodo,
      correo: pendiente.correo,
      password: pendiente.password,
      verificado: true
    });

    await nuevoUsuario.save();
    await PendingUser.deleteOne({ correo: pendiente.correo });

    res.status(201).json({ message: 'Cuenta verificada y creada exitosamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al verificar token', detalles: err.message });
  }
});

// 👉 Ruta de login sin token
app.post('/login', async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
  }

  try {
    const usuario = await Usuario.findOne({ correo });
    if (!usuario) {
      return res.status(400).json({ error: 'Correo no registrado' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password);
    if (!passwordValido) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    res.json({
      message: 'Inicio de sesión exitoso',
      usuario: {
        id: usuario._id,
        apodo: usuario.apodo,
        correo: usuario.correo,
        nombre: usuario.nombre,
        apellido: usuario.apellido
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión', detalles: err.message });
  }
});

// 👉 Ruta para obtener todos los usuarios
app.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await Usuario.find().select('-password');
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios', detalles: err.message });
  }
});

// ⚠️ Ruta 404
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.originalUrl} no encontrada` });
});

// 🛠 Middleware de errores
app.use((err, req, res, next) => {
  console.error('Error interno:', err.stack);
  res.status(500).json({ error: 'Error interno del servidor', mensaje: err.message });
});

// 🟢 Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
