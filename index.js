const express = require('express');
const app = express();
app.use(express.json());

// Arreglo para almacenar usuarios (en memoria)
let usuarios = [];

app.post('/register', (req, res) => {
  const { nombre, apellido, apodo, password } = req.body;

  // Validación de campos obligatorios
  if (!nombre || !apellido || !password || !apodo) {
    return res.status(400).json({ error: 'Nombre, apellido, apodo y contraseña son obligatorios' });
  }

  // Validación de que nombre y apellido solo contengan letras
  const nombreValido = /^[a-zA-Z]+$/.test(nombre);
  const apellidoValido = /^[a-zA-Z]+$/.test(apellido);

  if (!nombreValido || !apellidoValido) {
    return res.status(400).json({ error: 'Nombre y apellido solo pueden contener letras' });
  }

  // Verificar si el apodo ya está registrado
  const usuarioExistente = usuarios.find(user => user.apodo === apodo);

  if (usuarioExistente) {
    return res.status(400).json({ error: 'El apodo ya está registrado' });
  }

  // Registrar nuevo usuario
  const nuevoUsuario = { nombre, apellido, apodo, password };
  usuarios.push(nuevoUsuario);

  res.json({ message: 'Usuario registrado correctamente' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
