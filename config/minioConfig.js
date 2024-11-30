const Minio = require('minio');

const minioClient = new Minio.Client({
    endPoint: '147.79.111.143',  // Use seu IP público aqui
    port: 9000,
    useSSL: false,          // altere para true se usar SSL
    accessKey: 'miniouser', // use as credenciais que você definiu
    secretKey: 'miniopassword123' // use a senha que você definiu
});

module.exports = minioClient;