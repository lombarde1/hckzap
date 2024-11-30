const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Readable } = require('stream');
const minioClient = require('../config/minioConfig');

const BUCKET_NAME = 'chat-media';

// Função para garantir que o bucket existe
async function ensureBucketExists() {
  try {
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME);
      console.log(`Bucket ${BUCKET_NAME} criado com sucesso`);
    }
  } catch (error) {
    console.error('Erro ao verificar/criar bucket:', error);
    throw error;
  }
}

// Função para fazer upload de arquivo base64
async function uploadbase64(base64File, type) {
  try {
    await ensureBucketExists();

    const filename = uuidv4();
    let nomearqv;
    
    // Definir extensão do arquivo baseado no tipo
    switch (type) {
      case 'image':
        nomearqv = `${filename}.jpg`;
        break;
      case 'audio':
        nomearqv = `${filename}.mp3`;
        break;
      case 'video':
        nomearqv = `${filename}.mp4`;
        break;
      case 'document':
        nomearqv = `${filename}.pdf`;
        break;
      case 'sticker':
        nomearqv = `${filename}.webp`;
        break;
      default:
        nomearqv = `${filename}.${type}`;
    }

    // Converter base64 para buffer e criar stream
    const buffer = Buffer.from(base64File, 'base64');
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    // Upload para o MinIO
    await minioClient.putObject(BUCKET_NAME, nomearqv, stream, buffer.length);

    // Gerar URL do arquivo
    const mediaUrl = `/media/${nomearqv}`;
    console.log(`${type} hospedado com sucesso no MinIO:`, mediaUrl);

    return mediaUrl;
  } catch (error) {
    console.error(`Erro ao hospedar o arquivo no MinIO:`, error);
    throw error;
  }
}

// Função para download e salvamento de mídia
async function downloadAndSaveMedia(mediaData, mediaType) {
  try {
    await ensureBucketExists();

    const mediaId = uuidv4();
    let fileName;
    
    // Definir nome do arquivo baseado no tipo
    switch (mediaType) {
      case 'image':
        fileName = `${mediaId}.jpg`;
        break;
      case 'audio':
        fileName = `${mediaId}.mp3`;
        break;
      case 'video':
        fileName = `${mediaId}.mp4`;
        break;
      default:
        fileName = `${mediaId}.${mediaType}`;
    }

    // Converter dados para buffer e criar stream
    const buffer = Buffer.from(mediaData, 'base64');
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    // Upload para o MinIO
    await minioClient.putObject(BUCKET_NAME, fileName, stream, buffer.length);

    // Gerar URL do arquivo
    const mediaUrl = `/media/${fileName}`;
    console.log(`Mídia salva com sucesso no MinIO:`, mediaUrl);

    return mediaUrl;
  } catch (error) {
    console.error('Erro em downloadAndSaveMedia:', error);
    throw error;
  }
}

module.exports = {
  downloadAndSaveMedia,
  uploadbase64
};