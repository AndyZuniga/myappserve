const express = require('express');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

// Conectar a MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://AndyZuniga:Aatrox2887@cluster0.p07nln0.mongodb.net/MyAppServe?retryWrites=true&w=majority';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Conectado a MongoDB Atlas'))
  .catch(err => console.error('❌ Error al conectar a MongoDB', err));

// Definir el esquema de usuario
const userSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  apellido: { type: String, required: true },
  apodo: { type: String, unique: true, required: true },
  correo: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

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

    // Crear un nuevo usuario
    const nuevoUsuario = new Usuario({ nombre, apellido, apodo, correo, password });
    await nuevoUsuario.save();

    // Respuesta de éxito
    res.json({ message: 'Usuario registrado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el usuario', detalles: err.message });
  }
});

// Ruta para obtener todos los usuarios (opcional)
app.get('/usuarios', async (req, res) => {
  try {
    const usuarios = await Usuario.find();
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener usuarios', detalles: err.message });
  }
});

// Configurar el puerto
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
