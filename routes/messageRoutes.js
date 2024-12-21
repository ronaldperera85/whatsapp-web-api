const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Ruta para registrar un usuario (generar QR)
router.post('/register', messageController.registerUser);

// Ruta para obtener el estado de la sesión
router.get('/:uid/status', messageController.getSessionStatus);

// Ruta para desconectar a un usuario
router.post('/:uid/disconnect', messageController.disconnectUser);

// Ruta para enviar un mensaje
router.post('/send/chat', messageController.sendMessage);

// Ruta para enviar un mensaje multimedia
router.post('/send/media', messageController.sendMediaMessage);

module.exports = router;
