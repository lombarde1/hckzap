// config/setupMinio.js
const minioClient = require('./minioConfig');

async function setupMinioPolicy() {
  const bucketName = 'chat-media';

  try {
    // Verifica se o bucket existe
    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      // Cria o bucket se não existir
      await minioClient.makeBucket(bucketName);
      console.log('Bucket criado:', bucketName);
    }

    // Configura a política pública
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            AWS: ['*']
          },
          Action: [
            's3:GetObject'
          ],
          Resource: [`arn:aws:s3:::${bucketName}/*`]
        }
      ]
    };

    await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    console.log('Política pública configurada com sucesso para o bucket:', bucketName);
  } catch (error) {
    console.error('Erro ao configurar MinIO:', error);
  }
}

module.exports = setupMinioPolicy;