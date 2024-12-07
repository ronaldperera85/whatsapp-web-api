const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

// Ruta base para guardar las sesiones
const sessionsPath = path.join(__dirname, '.wwebjs_auth');
const activeClients = {}; // Mantener las sesiones activas en memoria

// Cargar sesiones activas al iniciar el servidor
const initializeSessions = () => {
  if (!fs.existsSync(sessionsPath)) {
    console.log(`Sessions path not found: ${sessionsPath}`);
    return;
  }

  const directories = fs.readdirSync(sessionsPath);
  directories.forEach((userId) => {
    const userSessionPath = path.join(sessionsPath, userId);

    if (fs.statSync(userSessionPath).isDirectory()) {
      console.log(`Restoring session for user: ${userId}`);
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: userId,
          dataPath: userSessionPath,
        }),
      });

      client.on('ready', () => {
        console.log(`Restored WhatsApp client for ${userId}`);
        activeClients[userId] = client;
      });

      client.on('authenticated', () => {
        console.log(`Session authenticated for user ${userId}`);
      });

      client.on('disconnected', () => {
        console.log(`Session disconnected for user ${userId}`);
        delete activeClients[userId];
      });

      client.initialize();
    }
  });
};

// Crear una sesión de WhatsApp para un usuario
const createSession = (userId, qrCallback) => {
  if (activeClients[userId]) {
    console.log(`Session already exists for user ${userId}`);
    return;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: userId,
      dataPath: path.join(sessionsPath, userId),
    }),
  });

  client.on('qr', async (qr) => {
    console.log(`QR for user ${userId}:`, qr);
    const qrBase64 = await qrcode.toDataURL(qr);
    qrCallback(qrBase64);
  });

  client.on('ready', () => {
    console.log(`WhatsApp client for ${userId} is ready!`);
    activeClients[userId] = client; // Almacenar el cliente en memoria
  });

  client.on('authenticated', () => {
    console.log(`Authenticated for ${userId}`);
  });

  client.on('disconnected', () => {
    console.log(`Client for ${userId} disconnected`);
    delete activeClients[userId];
  });

  client.initialize();
};

// Obtener el estado de la sesión
const getSessionState = (userId) => {
  if (activeClients[userId]) {
    return 'authenticated';
  }
  const sessionPath = path.join(sessionsPath, userId);
  if (fs.existsSync(sessionPath)) {
    return 'not authenticated';
  }
  return 'not found';
};

// Desconectar una sesión
const disconnectSession = (userId) => {
  if (activeClients[userId]) {
    activeClients[userId].destroy();
    delete activeClients[userId];
    console.log(`Session for user ${userId} has been disconnected successfully.`);
    return 'disconnected';
  }
  return 'Session not found';
};

// Enviar un mensaje
const sendMessage = async (userId, phoneNumber, message) => {
  const client = activeClients[userId];
  if (!client) {
    console.log(`No session found for user ${userId}`);
    return 'Session not found';
  }

  try {
    const chatId = `${phoneNumber}@c.us`;
    await client.sendMessage(chatId, message);
    console.log(`Message sent to ${phoneNumber}: ${message}`);
    return 'sent';
  } catch (error) {
    console.error(`Error sending message to ${phoneNumber}: ${error.message}`);
    return 'failed';
  }
};

module.exports = {
  initializeSessions,
  createSession,
  getSessionState,
  disconnectSession,
  sendMessage,
};
