const express = require('express');
const { registerUser } = require('../controllers/userController');
const router = express.Router();

// Ruta para registrar un usuario
router.post('/register', registerUser);

module.exports = router;