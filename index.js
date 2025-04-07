const express = require('express');
const app = express();
app.use(express.json());

app.post('/register', (req, res) => {
  const { nombre, apellido, apodo, password } = req.body;

    // Validación de que nombre y apellido solo contengan letras
    const nombreValido = /^[a-zA-Z]+$/.test(nombre);
    const apellidoValido = /^[a-zA-Z]+$/.test(apellido);

  // Validación de campos obligatorios
  if (!nombre || !apellido || !password) {
    return res.status(400).json({ error: 'Nombre, apellido y contraseña son obligatorios' });
  }

  // Aquí puedes guardar los datos en memoria (solo para pruebas)
  res.json({ message: 'Usuario registrado correctamente' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
