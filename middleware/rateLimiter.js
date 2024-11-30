const rateLimit = require('express-rate-limit');

const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite de 100 requisições por IP
    message: {
        status: 'error',
        message: 'Muitas requisições deste IP, por favor tente novamente em 15 minutos'
    }
});

module.exports = rateLimiter;