const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Ruta para registrar usuario y generar QR
router.post('/register', messageController.registerUser);

// Ruta para obtener el estado de la sesión de un usuario
router.get('/status/:userId', messageController.getSessionStatus);

// Ruta para desconectar una sesión de usuario
router.post('/disconnect/:userId', messageController.disconnectUser);

// Ruta para enviar un mensaje
router.post('/send-message', messageController.sendMessage);

module.exports = router;
