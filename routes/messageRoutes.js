const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Ruta para registrar un usuario (generar QR)
router.post('/register', messageController.registerUser);

// Ruta para obtener el estado de la sesión
router.get('/status/:uid', messageController.getSessionStatus);

// Ruta para desconectar a un usuario
router.post('/disconnect/:uid', messageController.disconnectUser);

// Ruta para enviar un mensaje
router.post('/send/chat', messageController.sendMessage);

// Ruta para enviar un mensaje multimedia
router.post('/send/media', messageController.sendMediaMessage);

// exporta el router sin la propiedad default
module.exports = router;