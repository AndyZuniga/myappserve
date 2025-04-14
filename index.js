const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());
// Conectar a MongoDB
require('dotenv').config();
const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('Conectado a MongoDB Atlas'))
  .catch(err => console.error('Error al conectar a MongoDB', err));
// Definir el esquema de usuario
const userSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  apodo: { type: String, unique: true, required: true },
  correo: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
// Middleware verificarToken 
function verificarToken(req, res, next) {
  const authHeader = req.header('Authorization');

  if (!authHeader) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  try {
    const verificado = jwt.verify(token, JWT_SECRET);
    req.usuario = verificado;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Token inválido' });
  }
}

// Crear el modelo de usuario
const Usuario = mongoose.model('user', userSchema); // Colección 'user' en 'MyAppServe'

// Ruta para registrar un usuario
app.post('/register', async (req, res) => {
  const { nombre, apellido, apodo, correo, password } = req.body;

  // Validación de campos obligatorios
  if (!nombre || !apellido || !apodo || !correo || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  // Validar que el apodo y correo no existan
  try {
    const apodoExistente = await Usuario.findOne({ apodo });
    if (apodoExistente) {
      return res.status(400).json({ error: 'El apodo ya está en uso' });
    }

    const correoExistente = await Usuario.findOne({ correo });
    if (correoExistente) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }


    // Hashear la contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    // Crear nuevo usuario con la contraseña protegida
    const nuevoUsuario = new Usuario({ nombre, apellido, apodo, correo, password: hashedPassword });
    await nuevoUsuario.save();
    // Respuesta de éxito
    res.json({ message: 'Usuario registrado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el usuario', detalles: err.message }); // aqui igual //me enmarca en rojo el nuevoUsuario
  }
});

// Ruta de login
app.post('/login', async (req, res, next) => {
  try {
    const { correo, password } = req.body;

    if (!correo || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });
    }

    const usuario = await Usuario.findOne({ correo });

    if (!usuario) {
      return res.status(400).json({ error: 'Correo no registrado' });
    }

    const passwordValido = await bcrypt.compare(password, usuario.password);
    if (!passwordValido) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      { id: usuario._id, apodo: usuario.apodo },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ message: 'Inicio de sesión exitoso', token });
  } catch (err) {
    next(err); // Pasa error al middleware global
  }
});

// Ruta protegida para perfil
app.get('/perfil', verificarToken, async (req, res, next) => {
  try {
    const usuario = await Usuario.findById(req.usuario.id).select('-password');
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ perfil: usuario });
  } catch (err) {
    next(err);
  }
});

// Ruta para obtener todos los usuarios
app.get('/usuarios', async (req, res, next) => {
  try {
    const usuarios = await Usuario.find();
    res.json(usuarios);
  } catch (err) {
    next(err);
  }
});


// ⚠️ Ruta 404 para cualquier método o URL no registrada
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.originalUrl} no encontrada` });
});


// 🛠 Middleware global de manejo de errores (último middleware siempre)
app.use((err, req, res, next) => {
  console.error('Error interno:', err.stack);
  res.status(500).json({
    error: 'Error interno del servidor',
    mensaje: err.message,
  });
});


// Configurar el puerto
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
