const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
require('dotenv').config(); // Asegúrate de que dotenv se configure aquí también

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

// Nueva ruta para probar las variables de entorno
router.get('/test', (req, res, next) => {
    const auth = { login: 'icarosoft', password: '45637954' };

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === auth.login && password === auth.password) {
        const envVariables = {
            POST_ENDPOINT: process.env.POST_ENDPOINT,
            FILE_UPLOAD_ENDPOINT: process.env.FILE_UPLOAD_ENDPOINT,
            FILE_UPLOAD_TOKEN: process.env.FILE_UPLOAD_TOKEN,
            PORT: process.env.PORT,
            DB_HOST: process.env.DB_HOST,
            DB_DATABASE: process.env.DB_DATABASE,
            DB_USERNAME: process.env.DB_USERNAME,
            DB_PASSWORD: process.env.DB_PASSWORD
        };
        console.log('Endpoint /test accessed. Environment Variables:', envVariables); // Loguea para debug
        res.json({
            success: true,
            message: 'Environment variables loaded successfully.',
            data: envVariables
        });
    } else {
        res.set('WWW-Authenticate', 'Basic realm="401"');
        res.status(401).send('Authentication required.');
    }
});

// exporta el router sin la propiedad default
module.exports = router;