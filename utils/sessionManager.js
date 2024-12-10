const fs = require('fs');
const path = require('path');

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
  
  module.exports = {
    addSession,
    updateSessionAuth,
    validateToken,
    isAuthenticated,
    getToken, // Exporta la nueva función
  };
  
