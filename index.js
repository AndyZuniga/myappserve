const express = require('express');
const app = express();
app.use(express.json());

// Almacén temporal en memoria
let usuarios = [];

app.post('/register', (req, res) => {
  const { nombre, apellido, apodo, correo, password } = req.body;

  // Validación de campos obligatorios
  if (!nombre || !apellido || !apodo || !correo || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios: nombre, apellido, apodo, correo y contraseña' });
  }

  // Validación de que nombre y apellido solo contengan letras
  const nombreValido = /^[a-zA-Z]+$/.test(nombre);
  const apellidoValido = /^[a-zA-Z]+$/.test(apellido);
  if (!nombreValido || !apellidoValido) {
    return res.status(400).json({ error: 'Nombre y apellido solo pueden contener letras' });
  }

  // Validación de formato de correo
  const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
  if (!correoValido) {
    return res.status(400).json({ error: 'El formato del correo es inválido' });
  }

  // Verificar duplicados por apodo o correo
  const apodoExistente = usuarios.find(user => user.apodo === apodo);
  const correoExistente = usuarios.find(user => user.correo === correo);

  if (apodoExistente) {
    return res.status(400).json({ error: 'El apodo ya está registrado' });
  }

  if (correoExistente) {
    return res.status(400).json({ error: 'El correo ya está registrado' });
  }

  // Registro de usuario
  const nuevoUsuario = { nombre, apellido, apodo, correo, password };
  usuarios.push(nuevoUsuario);

  res.json({ message: 'Usuario registrado correctamente' });
});

// Puerto
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
