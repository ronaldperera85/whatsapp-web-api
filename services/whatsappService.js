const { Client, LocalAuth } = require('whatsapp-web.js'); // Importar el cliente de WhatsApp
const fs = require('fs'); // Importar el módulo de sistema de archivos
const path = require('path'); // Importar el módulo de rutas
const qrcode = require('qrcode'); // Importar el módulo de generación de códigos QR
const sessionManager = require('../utils/sessionManager'); // Importar el gestor de sesiones
const axios = require('axios'); // Importar Axios para enviar el POST
const logger = require('../utils/logger'); // Importar logger parar registrar eventos
const multer = require('multer'); // Para el manejo de archivos
const FormData = require('form-data'); // Para enviar datos de formulario
const { exec } = require('child_process'); // Para ejecutar comandos de terminal


const sessionsPath = path.join(__dirname, '..', '.wwebjs_auth'); // Ruta de las sesiones
const activeClients = {}; // Mantener las sesiones activas en memoria

const chromePath = path.join(__dirname, 'chrome', 'chrome.exe'); // Ruta de Chrome

// Crear el directorio temporal si no existe
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

const FILE_UPLOAD_ENDPOINT = process.env.FILE_UPLOAD_ENDPOINT; // Endpoint para subir archivos
const FILE_UPLOAD_TOKEN = process.env.FILE_UPLOAD_TOKEN; // Token para subir archivos

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

// Conversión de audio a AAC
const convertToAAC = async (inputPath) => {
  const outputPath = inputPath.replace(/\.\w+$/, `_converted.aac`);
  return new Promise((resolve, reject) => {
    const command = `ffmpeg -i "${inputPath}" -y -vn -acodec aac "${outputPath}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Error converting audio to AAC: ${stderr}`);
        return reject(new Error('Failed to convert audio to AAC.'));
      }
      logger.info(`Audio converted to AAC: ${outputPath}`);
      resolve(outputPath);
    });
  });
};

// Construcción del cuerpo del mensaje
const buildMessageBody = (msg, type, publicUrl = null, thumb = null) => {
  switch (type) {
    case 'chat':
      return { text: msg.body };
    case 'image':
    case 'video':
    case 'document':
    case 'sticker':
    case 'audio':
      return {
        caption: msg.caption || '',
        mimetype: msg.mimetype || '',
        size: msg.size || '',
        duration: type === 'video' ? msg.duration || '' : undefined,
        thumb: thumb || '',
        url: publicUrl || '',
      };
      case 'location':
        logger.info(`Location details: ${JSON.stringify(msg.locationData)}`); // Verificar datos
        return {
          lng: msg.location?.longitude || msg.locationLongitude || '',
          lat: msg.location?.latitude || msg.locationLatitude || '',
        };           
    case 'vcard':
      return {
        contact: 'vcard',
        vcard: msg.body || '',
      };
    default:
      throw new Error(`Unsupported message type: ${type}`);
  }
};

// Subir archivo
const uploadFile = async (filePath, originalName) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), originalName);

    const response = await axios.post(FILE_UPLOAD_ENDPOINT, formData, {
      headers: {
        token: FILE_UPLOAD_TOKEN,
        'Content-Type': 'multipart/form-data',
        ...formData.getHeaders(),
      },
    });

    return response.data.content.publicUrl;
  } catch (error) {
    logger.error(`Error uploading file: ${error.message}`);
    return null;
  }
};

// Interceptar mensajes
const setupMessageListener = (client, uid) => {
  client.on('message', async (msg) => {
    try {
      if (msg.from.startsWith('status@')) return;

      logger.info(`[Incoming] [${new Date().toISOString()}] Message from ${msg.from.replace('@c.us', '')} to ${uid} (Type: ${msg.type}): ${msg.body || '(Media message)'}`);

      let type = 'chat';
      let thumb = null;
      let publicUrl = null;

      if (msg.hasMedia) {
        const media = await msg.downloadMedia();

        if (!media || !media.data) {
          throw new Error('Media data is undefined or invalid.');
        }

        type = media.mimetype.startsWith('image')
          ? 'image'
          : media.mimetype.startsWith('video')
          ? 'video'
          : media.mimetype.startsWith('application')
          ? 'document'
          : media.mimetype.startsWith('audio')
          ? 'audio'
          : 'sticker';

        const extension = media.mimetype.split('/')[1] || 'bin';
        const sanitizedFilename = (media.filename || `file_${Date.now()}.${extension}`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(tempDir, `${msg.id.id}-${sanitizedFilename}`);
        fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
        // Obtener el tamaño del archivo en bytes
        const stats = fs.statSync(filePath);
        const fileSizeInBytes = stats.size;

        // Registrar el tamaño del archivo
        logger.info(`Media file downloaded. Size: ${fileSizeInBytes} bytes. Path: ${filePath}`);

        try {
          if (type === 'audio') {
            // Convertir audio a AAC
            const convertedPath = await convertToAAC(filePath);
            publicUrl = await uploadFile(convertedPath, path.basename(convertedPath));
            fs.unlinkSync(convertedPath);
          } else {
            publicUrl = await uploadFile(filePath, sanitizedFilename);
            thumb = media.thumbnail || null; // Usar miniatura si está disponible
          }

          if (!publicUrl) throw new Error('Failed to upload the file.');
        } finally {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      } else if (msg.type === 'location') {
        // Procesar mensajes de tipo 'location'
        type = 'location';
        thumb = msg.thumb || null;

        const locationData = {
          name: msg.locationName || '', // El nombre si está disponible
          lng: msg.locationLongitude || '', // Longitud
          lat: msg.locationLatitude || '', // Latitud
          thumb: thumb || '', // Miniatura de la ubicación
        };

        publicUrl = JSON.stringify(locationData); // Usamos los datos como JSON para el endpoint
      } else if (msg.type === 'vcard') {
        type = 'chat';
      }

      const body = buildMessageBody(msg, type, publicUrl, thumb);
      const payload = {
        event: 'message',
        token: sessionManager.getToken(uid),
        uid,
        contact: {
          uid: msg.from.replace('@c.us', ''),
          name: msg._data.notifyName || 'Unknown',
          type: 'user',
        },
        message: {
          dtm: Math.floor(Date.now() / 1000),
          uid: msg.id.id,
          cuid: '',
          dir: 'i',
          type,
          body,
          ack: msg.ack.toString(),
        },
      };

      await axios.post(process.env.POST_ENDPOINT, payload, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      //logger.info(`Location payload to send: ${JSON.stringify(payload)}`);
      logger.info(`Message of type '${type}' sent successfully to endpoint.`);
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
          dataPath: path.join(sessionsPath, uid),
        }),
        puppeteer: {
          executablePath: chromePath, // Usar la ruta generada dinámicamente
          headless: true, // Modo sin interfaz gráfica
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-popup-blocking',
            '--disable-sync',
            '--no-first-run',
            '--disable-infobars',
          ],
        }
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
const createSession = async (uid, qrCallback) => {
  const sessions = sessionManager.readSessions();

  // Verificar si ya existe una sesión activa
  if (activeClients[uid]) {
      logger.warn(`[Session] Destroying existing session for user ${uid}`);
      await activeClients[uid].destroy();
      delete activeClients[uid];
      sessionManager.deleteSession(uid, sessionsPath);
  }

  // Si la sesión no está autenticada en sessions.json, eliminarla
  if (sessions[uid] && !sessions[uid].authenticated) {
      logger.info(`[Session] Removing unauthenticated session for user ${uid}`);
      sessionManager.deleteSession(uid, sessionsPath);
  }

  logger.info(`[Session] Creating session for user ${uid}`);
  const client = new Client({
      authStrategy: new LocalAuth({
          clientId: uid,
          dataPath: path.join(sessionsPath, uid),
      }),
      puppeteer: {
          executablePath: chromePath,
          headless: true,
          args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--disable-gpu',
              '--no-first-run',
              '--disable-infobars',
          ],
      },
  });

  let qrCodeGenerated = false;

  // Establecer un temporizador para destruir sesiones no autenticadas
  const qrTimeout = setTimeout(async () => {
      if (!qrCodeGenerated) {
          logger.warn(`[QR Timeout] QR for user ${uid} expired. Destroying session...`);
          try {
              await client.destroy();
              delete activeClients[uid];
              sessionManager.deleteSession(uid, sessionsPath);
          } catch (err) {
              logger.error(`[QR Timeout] Failed to destroy session for user ${uid}: ${err.message}`);
          }
      }
  }, 60000); // 1 minuto

  activeClients[uid] = client;

  client.on('qr', async (qr) => {
      if (!qrCodeGenerated) {
          clearTimeout(qrTimeout);
          qrCodeGenerated = true;

          const qrBase64 = await qrcode.toDataURL(qr);
          logger.info(`[QR] QR for user ${uid} generated`);
          qrCallback(qrBase64, null);
      }
  });

  client.on('ready', () => {
      clearTimeout(qrTimeout);
      logger.info(`[Ready] WhatsApp client for ${uid} is ready`);
      sessionManager.addSession(uid, sessionManager.getToken(uid));
      sessionManager.updateSessionAuth(uid, true);
  });

  client.on('auth_failure', (msg) => {
      logger.error(`[Auth Failure] Authentication failed for user ${uid}: ${msg}`);
      delete activeClients[uid];
      qrCallback(null, 'Authentication failed.');
  });

  client.on('disconnected', (reason) => {
      logger.warn(`[Disconnected] Client for ${uid} disconnected: ${reason}`);
      delete activeClients[uid];
      sessionManager.updateSessionAuth(uid, false);
  });

  try {
      await client.initialize();
      logger.info(`[Init] Client for user ${uid} initialized.`);
  } catch (error) {
      logger.error(`[Init Error] Failed to initialize client for user ${uid}: ${error.message}`);
      delete activeClients[uid];
      qrCallback(null, `Failed to initialize client: ${error.message}`);
  }
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
