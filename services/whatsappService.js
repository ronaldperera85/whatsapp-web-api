const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const sessionManager = require('../utils/sessionManager');
const axios = require('axios'); // Importar Axios para enviar el POST
const logger = require('../utils/logger'); // Importar logger
const multer = require('multer'); // Para el manejo de archivos
const FormData = require('form-data');

const sessionsPath = path.join(__dirname, '..', '.wwebjs_auth');
const activeClients = {}; // Mantener las sesiones activas en memoria

// Crear el directorio temporal si no existe
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

const FILE_UPLOAD_ENDPOINT = process.env.FILE_UPLOAD_ENDPOINT;
const FILE_UPLOAD_TOKEN = process.env.FILE_UPLOAD_TOKEN;

// Configuración de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
      cb(null, tempDir);
  },
  filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Función para subir archivos al endpoint
const uploadFile = async (filePath, originalName) => {
  try {
    // Asegúrate de que el archivo existe antes de intentar procesarlo
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), originalName); // Usar createReadStream

    const response = await axios.post(FILE_UPLOAD_ENDPOINT, formData, {
      headers: {
        'token': FILE_UPLOAD_TOKEN, // Token específico
      'Content-Type': 'multipart/form-data',
        ...formData.getHeaders(), // Headers generados por form-data
      },
    });

    return response.data.content.publicUrl; // URL pública del archivo
  } catch (error) {
    logger.error(`Error uploading file: ${error.message}`);
    return null;
  }
};

// Configurar interceptación de mensajes
const setupMessageListener = (client, uid) => {
  client.on('message', async (msg) => {
      try {
          if (msg.from.startsWith('status@')) {
              return; // Ignorar mensajes de estado
          }

          logger.info(`[Incoming] Message from ${msg.from.replace("@c.us", "")} to ${uid}: ${msg.body || "(Media message)"}`);

          if (msg.hasMedia) {
            const media = await msg.downloadMedia();
          
            if (!media || !media.data) {
              throw new Error('Media data is undefined or invalid.');
            }
          
            const extension = media.mimetype.split('/')[1] || 'bin';
            const sanitizedFilename = (media.filename || `file_${Date.now()}.${extension}`).replace(/[^a-zA-Z0-9._-]/g, '_');
            const filePath = path.join(tempDir, `${msg.id.id}-${sanitizedFilename}`);
            const fileBuffer = Buffer.from(media.data, 'base64');
          
            // Guardar archivo temporalmente
            fs.writeFileSync(filePath, fileBuffer);
            logger.info(`File saved temporarily at: ${filePath}`);
          
            try {
              // Subir el archivo al endpoint
              const publicUrl = await uploadFile(filePath, sanitizedFilename);
              if (!publicUrl) throw new Error('Failed to upload the file.');
          
              logger.info(`File uploaded successfully. Public URL: ${publicUrl}`);
          
              // Enviar el payload del archivo subido
              const payload = {
                event: "media_message",
                token: sessionManager.getToken(uid),
                uid,
                contact: {
                  uid: msg.from.replace("@c.us", ""),
                  name: msg._data.notifyName || "Unknown",
                  type: "user",
                },
                message: {
                  dtm: Math.floor(Date.now() / 1000),
                  uid: msg.id.id,
                  cuid: "",
                  dir: "i",
                  type: media.mimetype.split('/')[0],
                  body: {
                    url: `${publicUrl}`,
                  },
                  ack: msg.ack.toString(),
                },
              };
          
              const endpoint = process.env.POST_ENDPOINT;
              await axios.post(endpoint, payload, {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
              });
          
              logger.info(`Media message sent successfully to endpoint.`);
            } finally {
              // Eliminar archivo después de todas las operaciones
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.info(`Temporary file deleted: ${filePath}`);
              }
            }
          
          } else {
              // Procesar mensajes de texto normales
              const payload = {
                  event: "message",
                  token: sessionManager.getToken(uid),
                  uid,
                  contact: {
                      uid: msg.from.replace("@c.us", ""),
                      name: msg._data.notifyName || "Unknown",
                      type: "user",
                  },
                  message: {
                      dtm: Math.floor(Date.now() / 1000),
                      uid: msg.id.id,
                      cuid: "",
                      dir: "i",
                      type: "chat",
                      body: {
                          text: msg.body,
                      },
                      ack: msg.ack.toString(),
                  },
              };

              const endpoint = process.env.POST_ENDPOINT;
              await axios.post(endpoint, payload, {
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
              });

              logger.info(`Text message sent successfully to endpoint.`);
          }
      } catch (error) {
          logger.error(`Error processing message: ${error.message}`);
      }
  });
};

// Obtener el estado de la sesión
const getSessionState = (uid) => {
  const sessionPath = path.join(sessionsPath, uid);
  if (fs.existsSync(sessionPath)) {
    return 'authenticated';
  } else {
    return 'unauthenticated';
  }
};

// Inicializar sesiones y restaurar tokens
const initializeSessions = () => {
  if (!fs.existsSync(sessionsPath)) {
    logger.warn(`Sessions path not found: ${sessionsPath}`);
    return;
  }

  const directories = fs.readdirSync(sessionsPath);
  directories.forEach((uid) => {
    const userSessionPath = path.join(sessionsPath, uid);

    if (fs.statSync(userSessionPath).isDirectory()) {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: uid,
          dataPath: userSessionPath,
        }),
      });

      client.on('ready', () => {
        logger.info(`Restored WhatsApp client for ${uid}`);
        activeClients[uid] = client;
      });

      // Configurar interceptación de mensajes
      setupMessageListener(client, uid);

      client.initialize();
    }
  });
};

// Crear una sesión de WhatsApp para un usuario
const createSession = (uid, qrCallback) => {
  if (activeClients[uid]) {
    logger.warn(`Session already exists for user ${uid}`);
    return;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: uid,
      dataPath: path.join(sessionsPath, uid),
    }),
  });

  client.on('qr', async (qr) => {
    logger.info(`QR for user ${uid} generated`);
    const qrBase64 = await qrcode.toDataURL(qr);
    qrCallback(qrBase64);
  });

  client.on('ready', () => {
    logger.info(`WhatsApp client for ${uid} is ready`);
    activeClients[uid] = client;
    sessionManager.updateSessionAuth(uid, true); // Marcar como autenticado
  });

  client.on('authenticated', () => {
    logger.info(`Authenticated for ${uid}`);
  });

  client.on('disconnected', () => {
    logger.warn(`Client for ${uid} disconnected`);
    delete activeClients[uid];
    sessionManager.updateSessionAuth(uid, false); // Marcar como no autenticado
  });

  // Configurar interceptación de mensajes
  setupMessageListener(client, uid);

  client.initialize();
};

// Desconectar una sesión
const disconnectSession = (uid) => {
  if (activeClients[uid]) {
    activeClients[uid].destroy();
    delete activeClients[uid];
    logger.info(`Session for user ${uid} has been disconnected successfully`);
    return 'disconnected';
  }
  return 'Session not found';
};

// Enviar un mensaje
const sendMessage = async (uid, to, text) => {
  const client = activeClients[uid]; // Usar el cliente de memoria
  if (!client) {
    logger.warn(`User ${uid} is not authenticated`);
    return 'Session not found';
  }

  try {
    const chatId = `${to}@c.us`; // Formato internacional para el número
    const message = await client.sendMessage(chatId, text);
    logger.info(`Message sent to ${to} by user ${uid}: ${text}`);
    return message.id ? 'sent' : 'failed';
  } catch (error) {
    logger.error(`Error sending message to ${to} by user ${uid}: ${error.message}`);
    return 'failed';
  }
};

// Enviar un mensaje con media
const sendMediaMessage = async (uid, to, url) => {
  const client = activeClients[uid]; // Usar el cliente de memoria
  if (!client) {
    logger.warn(`User ${uid} is not authenticated`);
    return 'Session not found';
  }

  try {
    const chatId = `${to}@c.us`; // Formato internacional para el número

    // Formato del mensaje a enviar (URL como texto)
    const messageText = `Imagen: ${url}`;

    // Enviar el mensaje como texto
    const message = await client.sendMessage(chatId, messageText);
    logger.info(`URL message sent to ${to} by user ${uid}`);
    return message.id ? 'sent' : 'failed';
  } catch (error) {
    logger.error(`Error sending URL message to ${to} by user ${uid}: ${error.message}`);
    return 'failed';
  }
};

module.exports = {
  initializeSessions,
  createSession,
  getSessionState,
  disconnectSession,
  sendMessage,
  sendMediaMessage,
  setupMessageListener,
  uploadFile,
};
