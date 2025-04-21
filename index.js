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

// Función para enviar correo de verificación
const sendVerificationEmail = async (correo, token) => {
  const verificationLink = `http://localhost:3000/verify/${token}`; // Cambia si usas dominio real
  const mailOptions = {
    from: `"SetMatch Soporte" <${process.env.EMAIL_USER}>`,
    to: correo,
    subject: 'Verifica tu cuenta en SetMatch',
    html: `
      <h2>¡Bienvenido a SetMatch!</h2>
      <p>Haz clic en el siguiente enlace para verificar tu correo:</p>
      <a href="${verificationLink}">${verificationLink}</a>
    `
  };
  await transporter.sendMail(mailOptions);
};

// Definir el esquema de usuario
const userSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  apodo: { type: String, unique: true, required: true },
  correo: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  verificado: { type: Boolean, default: false },
  tokenVerificacion: { type: String }
});

// Crear el modelo de usuario
const Usuario = mongoose.model('user', userSchema);

// 👉 Ruta para registrar un usuario
app.post('/register', async (req, res) => {
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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const tokenVerificacion = crypto.randomBytes(32).toString('hex');

    const nuevoUsuario = new Usuario({
      nombre,
      apellido,
      apodo,
      correo,
      password: hashedPassword,
      verificado: false,
      tokenVerificacion
    });

    await nuevoUsuario.save();
    await sendVerificationEmail(correo, tokenVerificacion);

    res.status(201).json({
      message: 'Registro exitoso. Verifica tu correo para activar la cuenta.'
    });

  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el usuario', detalles: err.message });
  }
});

// 👉 Ruta para verificar correo
app.get('/verify/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const usuario = await Usuario.findOne({ tokenVerificacion: token });
    if (!usuario) {
      return res.status(400).json({ error: 'Token inválido o expirado' });
    }

    usuario.verificado = true;
    usuario.tokenVerificacion = undefined;
    await usuario.save();

    res.status(200).json({ message: 'Correo verificado correctamente. Ya puedes iniciar sesión.' });
  } catch (err) {
    res.status(500).json({ error: 'Error al verificar el correo', detalles: err.message });
  }
});

// 👉 Ruta para registrar con Google (sin verificación)
app.post('/register-google', async (req, res) => {
  const { nombre, apellido, correo, apodo, password } = req.body;

  if (!nombre || !apellido || !correo || !apodo || !password) {
    return res.status(400).json({ error: 'Faltan datos requeridos para el registro con Google' });
  }

  try {
    const apodoExistente = await Usuario.findOne({ apodo });
    if (apodoExistente) {
      return res.status(400).json({ error: 'El apodo ya está en uso' });
    }

    const correoExistente = await Usuario.findOne({ correo });
    if (correoExistente) {
      return res.status(400).json({ error: 'Ya existe un usuario registrado con ese correo' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const nuevoUsuario = new Usuario({
      nombre,
      apellido,
      apodo,
      correo,
      password: hashedPassword,
      verificado: true
    });

    await nuevoUsuario.save();

    res.status(201).json({
      message: 'Usuario registrado con Google correctamente',
      usuario: {
        id: nuevoUsuario._id,
        nombre: nuevoUsuario.nombre,
        apellido: nuevoUsuario.apellido,
        apodo: nuevoUsuario.apodo,
        correo: nuevoUsuario.correo
      }
    });

  } catch (err) {
    res.status(500).json({ error: 'Error al registrar con Google', detalles: err.message });
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

    if (!usuario.verificado) {
      return res.status(403).json({ error: 'Verifica tu correo antes de iniciar sesión' });
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
