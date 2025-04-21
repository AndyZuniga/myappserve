const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const crypto = require('crypto'); // 🔑 Para generar tokens de verificación
require('dotenv').config();

const app = express();
app.use(express.json());

// Conectar a MongoDB
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch(err => console.error('❌ Error al conectar a MongoDB:', err));

// Definir el esquema de usuario
const userSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  apodo: { type: String, unique: true, required: true },
  correo: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  tokenVerificacion: String // 🔑 Token para verificar el correo
});

// Crear el modelo de usuario
const Usuario = mongoose.model('user', userSchema);

// ✉️ Configuración de transporte de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.CORREO_VERIFICACION,
    pass: process.env.PASS_CORREO_VERIFICACION
  }
});

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
    const token = crypto.randomBytes(32).toString('hex'); // 🔑 Crear token de verificación
    
    const nuevoUsuario = new Usuario({ nombre, apellido, apodo, correo, password: hashedPassword, tokenVerificacion: token});
    await nuevoUsuario.save();
    // 📧 Enviar correo con enlace de verificación
    const link = `${process.env.FRONTEND_URL}/verificar?token=${token}&correo=${correo}`;
    await transporter.sendMail({
      from: `"Verificación de Cuenta" <${process.env.CORREO_VERIFICACION}>`,
      to: correo,
      subject: 'Verifica tu cuenta',
      html: `
      <h3>Hola ${nombre},</h3>
      <p>Gracias por registrarte. Por favor verifica tu cuenta haciendo clic en el siguiente enlace:</p>
      <a href="${link}">Verificar cuenta</a>
      <p>Si no fuiste tú, ignora este correo.</p>
    `
  });

  res.status(202).json({
    message: 'Usuario registrado. Verifica tu correo antes de iniciar sesión.'
  });
    

    res.status(201).json({
      message: 'Usuario registrado correctamente',
      usuario: {
        id: nuevoUsuario._id,
        nombre: nuevoUsuario.nombre,
        apellido: nuevoUsuario.apellido,
        apodo: nuevoUsuario.apodo,
        correo: nuevoUsuario.correo
      }
    });

  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el usuario', detalles: err.message });
  }
});
// ✅ Ruta para verificar el correo (activa la cuenta)
app.get('/verificar-correo', async (req, res) => {
  const { token, correo } = req.query;

  if (!token || !correo) {
    return res.status(400).send('Faltan parámetros de verificación');
  }

  try {
    const usuario = await Usuario.findOne({ correo, tokenVerificacion: token });

    if (!usuario) {
      return res.status(400).send('Token inválido o usuario no encontrado');
    }

    usuario.verificado = true;
    usuario.tokenVerificacion = undefined; // 🧹 Eliminar token
    await usuario.save();

    res.send('✅ Correo verificado correctamente. Ya puedes iniciar sesión.');
  } catch (err) {
    res.status(500).send('Error al verificar el correo');
  }
});

//  Modificación en login para chequear verificación
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
      return res.status(401).json({ error: 'Cuenta no verificada. Revisa tu correo.' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password);
    if (!passwordValido) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Devolvemos algunos datos útiles del usuario
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
    const usuarios = await Usuario.find().select('-password'); // sin contraseñas
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
