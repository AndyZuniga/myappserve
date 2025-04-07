const express = require('express');
const app = express();
app.use(express.json());

app.post('/register', (req, res) => {
  const { nombre, apellido, apodo, password } = req.body;
  // Aquí puedes guardar los datos en memoria (solo para pruebas)
  res.json({ message: 'Usuario registrado correctamente' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
