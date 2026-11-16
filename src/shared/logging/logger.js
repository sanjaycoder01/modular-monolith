const { getCorrelationId } = require('../context/requestContext');

function write(level, message, metadata) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    correlationId: getCorrelationId(),
    message,
  };

  if (metadata !== undefined) {
    entry.metadata = metadata;
  }

  const line = JSON.stringify(entry);

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

const logger = {
  info(message, metadata) {
    write('info', message, metadata);
  },
  warn(message, metadata) {
    write('warn', message, metadata);
  },
  error(message, metadata) {
    write('error', message, metadata);
  },
};

module.exports = { logger };
