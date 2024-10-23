const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const fileManager = new GoogleAIFileManager("AIzaSyAX1BoKV9FFiQN6lWJuyCEZ80-nzaqJo74");
// Configuração do Multer para upload de vídeos
const storage = multer.diskStorage({
  destination: './public/uploads/videos',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

let originalpath;
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /mp4|webm|avi/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Apenas arquivos de vídeo são permitidos!'));
  }
});
async function waitForFilesActive(files) {
    console.log("Aguardando processamento dos arquivos...");
    try {
      for (const file of files) {
        if (!file || !file.name) {
          throw new Error('Arquivo inválido');
        }
        console.log(`Verificando arquivo: ${file.name}`);
        let currentFile = await fileManager.getFile(file.name);
        let attempts = 0;
        const maxAttempts = 3;
  
        while (attempts < maxAttempts) {
          try {
            if (currentFile.state === "ACTIVE") {
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
            currentFile = await fileManager.getFile(file.name);
            attempts++;
          } catch (error) {
            console.error(`Tentativa ${attempts + 1} falhou:`, error);
            if (attempts === maxAttempts - 1) throw error;
          }
        }
      }
      console.log("Arquivos processados com sucesso");
    } catch (error) {
      console.error("Erro no processamento dos arquivos:", error);
      throw new Error('Falha no processamento dos arquivos');
    }
  }
// Função para extrair áudio do vídeo
async function extractAudio(videoPath, audioPath) {
    originalpath = videoPath
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .toFormat('mp3')
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(audioPath);
  });
}

// Função para verificar linguagem com Gemini
async function checkLanguage(audioPath) {

  const genAI = new GoogleGenerativeAI("AIzaSyAX1BoKV9FFiQN6lWJuyCEZ80-nzaqJo74");


  const uploadResult = await fileManager.uploadFile(audioPath, {
    mimeType: 'audio/mpeg',
    displayName: path.basename(audioPath)
  });

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: "Irei te enviar audios mp3, quero que voce me retorne \"true\" se a linguagem do audio fornecido estiver em portugues-br, caso contrario retorne \"false\""
  });

  const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        resultado: {
          type: "string"
        }
      }
    },
  };

  const chatSession = model.startChat({
    generationConfig,
    history: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              mimeType: uploadResult.file.mimeType,
              fileUri: uploadResult.file.uri,
            },
          },
          {text: "Verifique a linguagem"},
        ],
      }
    ],
  });

  const result = await chatSession.sendMessage("Verifique a linguagem");
  console.log(result.response.text())
  // Obtenção da resposta
  
  const responseText = result.response.text();
  console.log('Resposta da IA:', responseText);

  // Tratamento da resposta
  try {
    // Tenta primeiro fazer o parse direto
    const jsonResponse = JSON.parse(responseText);
    if (typeof jsonResponse.resultado === 'string') {
      return jsonResponse.resultado === "true";
    }
  } catch (e) {
    // Se falhar, tenta extrair o JSON usando regex
    const match = responseText.match(/\{[\s\S]*\}/);
    if (match) {
      const jsonResponse = JSON.parse(match[0]);
      if (typeof jsonResponse.resultado === 'string') {
        return jsonResponse.resultado === "true";
      }
    }
  }

  // Se chegou aqui, não conseguiu processar a resposta corretamente
  console.warn('Resposta não está no formato esperado, assumindo não-português');
  return false;

}

// Funções de utilidade para FFmpeg
function getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });
  }
  
  function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });
  }

  

// Função para adicionar música ao vídeo
// Função para adicionar música ao vídeo
async function findBestMusicPart(videoPath, musicPath) {
    try {
      console.log('Iniciando análise de música...');
      
      const videoUpload = await fileManager.uploadFile(videoPath, {
        mimeType: 'video/mp4',
        displayName: path.basename(videoPath)
      });
  
      const musicUpload = await fileManager.uploadFile(musicPath, {
        mimeType: 'audio/mpeg',
        displayName: path.basename(musicPath)
      });
  
      const genAI = new GoogleGenerativeAI("AIzaSyAX1BoKV9FFiQN6lWJuyCEZ80-nzaqJo74");
      
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-pro",
        systemInstruction: "Irei te enviar uma musica em audio e um video, quero que voce me diga qual a melhor parte da musica para adicionar no contexto do video! Me retorne a duração do audio (na melhor parte) e o contexto/motivo pelo que voce escolheu essa parte (retorne a analise do contexto completo, diga os elementos da musica e sincronização com o video)"
      });
  
      const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            duracao: { 
              type: "string",
              description: "Duração no formato '00:00 - 00:00'"
            },
            contexto: { 
              type: "string",
              description: "Explicação do motivo da escolha desse trecho"
            }
          }
        }
      };
  
      const chatSession = model.startChat({ 
        generationConfig,
        history: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  mimeType: videoUpload.file.mimeType,
                  fileUri: videoUpload.file.uri,
                },
              },
              {text: "Este é o vídeo para análise"},
            ],
          },
          {
            role: "user",
            parts: [
              {
                fileData: {
                  mimeType: musicUpload.file.mimeType,
                  fileUri: musicUpload.file.uri,
                },
              },
              {text: "Esta é a música para análise. Por favor, encontre a melhor parte para combinar com o vídeo."},
            ],
          }
        ],
      });
  
      const result = await chatSession.sendMessage("Com base no vídeo e na música fornecidos, me diga qual a melhor parte da música para usar e por quê.");
      
      const responseText = result.response.text();
      console.log('Resposta da IA:', responseText);
      
      try {
        // Tenta fazer o parse direto primeiro
        return JSON.parse(responseText);
      } catch (e) {
        // Se falhar, tenta extrair o JSON usando regex
        const match = responseText.match(/\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
        throw new Error('Não foi possível extrair JSON válido da resposta');
      }
  
    } catch (error) {
      console.error('Erro na análise:', error);
      // Fallback em caso de erro
      return {
        duracao: "00:00 - 00:30",
        contexto: "Usando trecho inicial da música devido a um erro na análise contextual"
      };
    }
}
  
  
  // Função para cortar música na duração ideal
  async function trimAudio(musicPath, startTime, endTime, outputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg(musicPath)
        .setStartTime(startTime)
        .setDuration(endTime - startTime)
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }
  
  // Função atualizada para adicionar música
  async function addMusicToVideo(videoPath, outputPath, progressCallback) {
    const audiosDir = './public/audios';
    const audioFiles = await fs.readdir(audiosDir);
    
    progressCallback('Selecionando música ideal...');
    
    const randomAudio = audioFiles[Math.floor(Math.random() * audioFiles.length)];
    const musicPath = path.join(audiosDir, randomAudio);
    
    progressCallback('Analisando melhor parte da música para o vídeo...');
    const musicAnalysis = await findBestMusicPart(videoPath, musicPath);
    
    // Extrair tempos de início e fim
    const [startTime, endTime] = musicAnalysis.duracao.split(' - ').map(time => {
      const [min, sec] = time.split(':').map(Number);
      return min * 60 + sec;
    });
  
    // Criar versão cortada da música
    const trimmedMusicPath = path.join('./public/uploads/videos', `trimmed-${Date.now()}.mp3`);
    await trimAudio(musicPath, startTime, endTime, trimmedMusicPath);
  
    progressCallback('Combinando vídeo com música...');
    
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .inputOption('-an') // Remove áudio original
        .input(trimmedMusicPath)
        .audioFilters('volume=1')
        .outputOptions([
          '-map 0:v', // Stream de vídeo do primeiro input
          '-map 1:a', // Stream de áudio do segundo input
          '-c:v copy', // Copia vídeo sem recodificar
          '-c:a aac', // Codec de áudio AAC para melhor qualidade
          '-b:a 320k', // Bitrate de áudio alto
          '-shortest'
        ])
        .on('progress', progress => {
          progressCallback(`Processando: ${Math.floor(progress.percent)}%`);
        })
        .on('end', async () => {
          await fs.unlink(trimmedMusicPath);
          resolve(musicAnalysis);
        })
        .on('error', reject)
        .save(outputPath);
    });
  }
  
  // Rota atualizada
  const fsSync = require('fs');

  // Modifique a rota process
  router.post('/process', upload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum vídeo enviado' });
      }
  
      const videoPath = req.file.path;
      const audioPath = videoPath.replace('.mp4', '.mp3');
      
      // Criar uma cópia do vídeo original
      const originalVideoPath = path.join('./public/uploads/videos', `original-${Date.now()}-${path.basename(videoPath)}`);
      fsSync.copyFileSync(videoPath, originalVideoPath);
  
      const outputPath = path.join('./public/uploads/videos', `processed-${Date.now()}.mp4`);
  
      // Enviar progresso inicial
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
  
      const sendProgress = (message) => {
        res.write(`data: ${JSON.stringify({ message })}\n\n`);
      };
  
      sendProgress('Extraindo áudio do vídeo...');
      await extractAudio(videoPath, audioPath);
  
      sendProgress('Verificando linguagem do áudio...');
      const isPortuguese = await checkLanguage(audioPath);
  
      if (!isPortuguese) {
        sendProgress('Vídeo não está em português, iniciando processamento...');
        const musicAnalysis = await addMusicToVideo(videoPath, outputPath, sendProgress);
        
        res.write(`data: ${JSON.stringify({
          done: true,
          success: true,
          originalVideo: `/uploads/videos/${path.basename(originalVideoPath)}`,
          processedVideo: `/uploads/videos/${path.basename(outputPath)}`,
          message: 'Vídeo processado com sucesso!',
          context: musicAnalysis.contexto
        })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({
          done: true,
          success: true,
          originalVideo: `/uploads/videos/${path.basename(originalVideoPath)}`,
          processedVideo: `/uploads/videos/${path.basename(originalVideoPath)}`,
          message: 'Vídeo mantido original pois está em português.'
        })}\n\n`);
      }
  
      // Limpar arquivos temporários
      await fs.unlink(audioPath);
      await fs.unlink(videoPath); // Removemos apenas o arquivo temporário, não a cópia original
  
      res.end();
    } catch (error) {
      console.error('Erro ao processar vídeo:', error);
      res.write(`data: ${JSON.stringify({
        done: true,
        success: false,
        error: 'Erro ao processar vídeo: ' + error.message
      })}\n\n`);
      res.end();
    }
  });

// Rota principal
router.get('/', (req, res) => {
  res.render('video-edit', {
    title: 'Editor de Vídeo',
    user: req.user
  });
});

// Rota para processar o vídeo
router.post('/process', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum vídeo enviado' });
    }

    const videoPath = req.file.path;
    const audioPath = videoPath.replace('.mp4', '.mp3');
    const outputPath = path.join('./public/uploads/videos', `processed-${Date.now()}.mp4`);

    console.log('Iniciando processamento do vídeo:', videoPath);

    // Extrair áudio
    await extractAudio(videoPath, audioPath);
    console.log('Áudio extraído com sucesso');

    // Verificar linguagem
    const isPortuguese = await checkLanguage(audioPath);
    console.log('Verificação de idioma:', isPortuguese ? 'Português' : 'Não português');

    if (!isPortuguese) {
      console.log('Iniciando substituição do áudio');
      // Adicionar música se não for português
      await addMusicToVideo(videoPath, outputPath);
      
      res.json({
        success: true,
        videoUrl: outputPath.replace('./public', '').replace("public/", '/'),
        message: 'Vídeo processado com sucesso! Áudio substituído por música.'
      });
    } else {
      res.json({
        success: true,
        videoUrl: videoPath.replace('./public', '').replace("public/", '/'),
        message: 'Vídeo mantido original pois está em português.'
      });
    }

    // Limpar arquivos temporários
    await fs.unlink(audioPath);
    if (!isPortuguese) {
      await fs.unlink(videoPath);
    }

  } catch (error) {
    console.error('Erro ao processar vídeo:', error);
    res.status(500).json({ 
      error: 'Erro ao processar vídeo',
      details: error.message 
    });
  }
});

module.exports = router;