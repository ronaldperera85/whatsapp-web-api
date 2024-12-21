// Exportar un logger con winston para imprimir logs en la consola y guardarlos en un archivo
const winston = require('winston');

// Crear el logger
const logger = winston.createLogger({
  level: 'info', // Establecer el nivel de log (info, warn, error)
  format: winston.format.combine(
    winston.format.timestamp(), // Agregar un timestamp
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [
    // Imprimir los logs en la consola
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Colorear el log en la consola
        winston.format.simple()
      ),
    }),
    // Guardar los logs en un archivo
    new winston.transports.File({ filename: 'logs/server.log' }),
  ],
});

module.exports = logger;
