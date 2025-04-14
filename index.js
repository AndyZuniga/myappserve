const express = require('express');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('Conectado a MongoDB Atlas'))
  .catch(err => console.error('Error al conectar a MongoDB', err));

const userSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  apodo: { type: String, unique: true, required: true },
  correo: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

const Usuario = mongoose.model('user', userSchema);

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

    const nuevoUsuario = new Usuario({ nombre, apellido, apodo, correo, password: hashedPassword });
    await nuevoUsuario.save();

    res.json({ message: 'Usuario registrado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el usuario', detalles: err.message });
  }
});

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

    res.json({ message: 'Inicio de sesión exitoso', usuario: { nombre: usuario.nombre, apellido: usuario.apellido, apodo: usuario.apodo, correo: usuario.correo } });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión', detalles: err.message });
  }
});

app.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await Usuario.find();
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios', detalles: err.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.originalUrl} no encontrada` });
});

app.use((err, req, res, next) => {
  console.error('Error interno:', err.stack);
  res.status(500).json({
    error: 'Error interno del servidor',
    mensaje: err.message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
