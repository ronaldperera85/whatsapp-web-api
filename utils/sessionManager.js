const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Ruta del archivo sessions.json
const sessionFilePath = path.join(__dirname, '..', 'sessions.json');

// Leer las sesiones desde el archivo
const readSessions = () => {
  try {
    if (!fs.existsSync(sessionFilePath)) {
      fs.writeFileSync(sessionFilePath, JSON.stringify({}), 'utf8'); // Crear archivo vacío si no existe
    }
    const data = fs.readFileSync(sessionFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading sessions file:', error.message);
    return {};
  }
};

// Guardar las sesiones en el archivo
const writeSessions = (sessions) => {
  try {
    fs.writeFileSync(sessionFilePath, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing sessions file:', error.message);
  }
};

// Registrar una nueva sesión
const addSession = (uid, token) => {
  try {
    const sessions = readSessions();
    sessions[uid] = { token, authenticated: false }; // Guardar sesión con token y estado de autenticación
    writeSessions(sessions);
  } catch (error) {
    console.error(`Error adding session for user ${uid}:`, error.message);
  }
};

// Actualizar el estado de autenticación
const updateSessionAuth = (uid, authenticated) => {
  try {
    const sessions = readSessions();
    if (sessions[uid]) {
      sessions[uid].authenticated = authenticated; // Actualizar autenticación
      writeSessions(sessions);
    }
  } catch (error) {
    console.error(`Error updating authentication for user ${uid}:`, error.message);
  }
};

// Validar token
const validateToken = (token) => {
  try {
    const sessions = readSessions();
    return Object.values(sessions).some(session => session.token === token);
  } catch (error) {
    console.error('Error validating token:', error.message);
    return false;
  }
};

// Verificar autenticación de usuario
const isAuthenticated = (uid) => {
  try {
    const sessions = readSessions();
    return sessions[uid]?.authenticated || false;
  } catch (error) {
    console.error(`Error checking authentication for user ${uid}:`, error.message);
    return false;
  }
};

// Obtener el token de un UID
const getToken = (uid) => {
    const sessions = readSessions();
    return sessions[uid]?.token || null; // Devuelve el token o null si no existe
};

const deleteSession = (uid) => {
  try {
    logger.info(`[Delete] Attempting to delete session for user ${uid}`);

    // Leer el archivo sessions.json
    const sessions = readSessions();
    if (sessions[uid]) {
      // Eliminar del archivo sessions.json
      delete sessions[uid];
      writeSessions(sessions);
      logger.info(`[Delete] Session for user ${uid} removed from sessions.json`);
    } else {
      logger.warn(`[Delete] No session found in sessions.json for user ${uid}`);
    }

    // Eliminar la carpeta física de la sesión
    const sessionPath = path.join(__dirname, '..', '.wwebjs_auth', uid);
    if (fs.existsSync(sessionPath)) {
      try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        logger.info(`[Delete] Physical session data for user ${uid} deleted.`);
      } catch (error) {
        logger.error(`[Delete Error] Failed to delete session directory for user ${uid}: ${error.message}`);
        // Si falla, intenta limpiar manualmente
        cleanDirectory(sessionPath);
      }
    } else {
      logger.warn(`[Delete] No physical session data found for user ${uid}`);
    }
  } catch (error) {
    logger.error(`[Delete Error] Error deleting session for user ${uid}: ${error.message}`);
  }
};

// Función auxiliar para limpiar el contenido del directorio
const cleanDirectory = (dirPath) => {
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach((file) => {
      const filePath = path.join(dirPath, file);
      if (fs.lstatSync(filePath).isDirectory()) {
        cleanDirectory(filePath); // Llamada recursiva para eliminar subdirectorios
      } else {
        fs.unlinkSync(filePath); // Eliminar archivo
      }
    });
    fs.rmdirSync(dirPath); // Eliminar el directorio vacío
    logger.info(`[Cleanup] Directory cleaned and removed: ${dirPath}`);
  } catch (err) {
    logger.error(`[Cleanup] Failed to forcibly delete directory: ${dirPath}, Error: ${err.message}`);
  }
};

module.exports = {
    addSession,
    updateSessionAuth,
    validateToken,
    isAuthenticated,
    getToken,
    deleteSession,
    readSessions,
};
  