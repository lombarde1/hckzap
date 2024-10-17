const { GoogleGenerativeAI } = require("@google/generative-ai");
const funnelController = require('./funnelController');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const redisClient = require('../config/redisConfig');
const json5 = require('json5'); // Certifique-se de instalar esta dependência: npm install json5
const PLAN_LIMITS = {
    gratuito: 1,
    basico: 2,
    plus: 25,
    premium: Infinity
};
const FUNNEL_EXPIRY = 60 * 60 * 24 * 30; // 30 dias em segundos

const { v4: uuidv4 } = require('uuid');

// Função para limpar a string JSON
function cleanJsonString(str) {
    // Remove caracteres de controle, exceto novas linhas e tabulações
    return str.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
}


exports.createAIFunnel = async (req, res) => {
    try {
        const { prompt, steps } = req.body;
        const userId = req.user.id;

        const userKey = `user:${userId}`;
        const userPlan = await redisClient.hget(userKey, 'plan');
        const funnelsKey = `user:${userId}:funnels`;
        const funnelCount = await redisClient.scard(funnelsKey);
        
        if (userPlan !== 'premium' && funnelCount >= PLAN_LIMITS[userPlan]) {
          return res.status(403).json({
              message: 'Limite de funis atingido para o seu plano',
              currentPlan: userPlan,
              limit: PLAN_LIMITS[userPlan]
          });
      }

        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          systemInstruction: "Tenho um saas de automação pra whatsapp que faz envio automaticos de funil.\n\nIrei te fornecer prompts/descrições de funis que quero e quero que voce me retorne um funil completo e montado no formato que meu saas aceita. irei te fornecer exemplos.\n\nEXEMPLOS DE FUNIS: {\n  \"id\": \"9711cb5f-3d32-43f8-96c3-fc861c4d17b0\",\n  \"name\": \"hot_novo\",\n  \"nodes\": [\n    {\n      \"id\": \"start_node\",\n      \"type\": \"start\",\n      \"content\": \"\",\n      \"position\": {\n        \"left\": \"50px\",\n        \"top\": \"50px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"wait_1728703148737\",\n      \"type\": \"wait\",\n      \"content\": \"10\",\n      \"position\": {\n        \"left\": \"150px\",\n        \"top\": \"170px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"audio_1728703196951\",\n      \"type\": \"audio\",\n      \"content\": \"https://raw.githubusercontent.com/darkdohot/medias/main/audio/8fcc3d49-5306-4307-afe6-4236bf7bcbe9.mp3\",\n      \"position\": {\n        \"left\": \"470px\",\n        \"top\": \"20px\"\n      },\n      \"delay\": 5,\n      \"caption\": \"\"\n    },\n    {\n      \"id\": \"input_1728703223120\",\n      \"type\": \"input\",\n      \"content\": \"Ta bem? 🥰\",\n      \"position\": {\n        \"left\": \"570px\",\n        \"top\": \"350px\"\n      },\n      \"delay\": 4,\n      \"inputKey\": \"bem\"\n    },\n    {\n      \"id\": \"wait_1728703263275\",\n      \"type\": \"wait\",\n      \"content\": \"12\",\n      \"position\": {\n        \"left\": \"980px\",\n        \"top\": \"60px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"message_1728703293574\",\n      \"type\": \"message\",\n      \"content\": \"Então, to ate sem jeito de falar aqui kkk\",\n      \"position\": {\n        \"left\": \"1400px\",\n        \"top\": \"450px\"\n      },\n      \"delay\": 3\n    },\n    {\n      \"id\": \"input_1728703357766\",\n      \"type\": \"input\",\n      \"content\": \"Posso te fazer uma pergunta?\",\n      \"position\": {\n        \"left\": \"1430px\",\n        \"top\": \"130px\"\n      },\n      \"delay\": 4,\n      \"inputKey\": \"perg\"\n    },\n    {\n      \"id\": \"wait_1728703368958\",\n      \"type\": \"wait\",\n      \"content\": \"20\",\n      \"position\": {\n        \"left\": \"1780px\",\n        \"top\": \"110px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"audio_1728703423782\",\n      \"type\": \"audio\",\n      \"content\": \"https://raw.githubusercontent.com/darkdohot/medias/main/audio/b5ae797a-a5af-46e0-8bfd-957dc9a90034.mp3\",\n      \"position\": {\n        \"left\": \"1720px\",\n        \"top\": \"440px\"\n      },\n      \"delay\": 4,\n      \"caption\": \"\"\n    },\n    {\n      \"id\": \"message_1728703476877\",\n      \"type\": \"message\",\n      \"content\": \"Conteudinho adulto kkk 😳\",\n      \"position\": {\n        \"left\": \"2160px\",\n        \"top\": \"120px\"\n      },\n      \"delay\": 3\n    },\n    {\n      \"id\": \"wait_1728703771677\",\n      \"type\": \"wait\",\n      \"content\": \"6\",\n      \"position\": {\n        \"left\": \"2180px\",\n        \"top\": \"400px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"input_1728703778636\",\n      \"type\": \"input\",\n      \"content\": \"vc teria interesse?\",\n      \"position\": {\n        \"left\": \"2150px\",\n        \"top\": \"670px\"\n      },\n      \"delay\": 2,\n      \"inputKey\": \"12\"\n    },\n    {\n      \"id\": \"aiAgent_1728752951893\",\n      \"type\": \"aiAgent\",\n      \"content\": {\n        \"prompt\": \"\",\n        \"memoryId\": \"\"\n      },\n      \"position\": {\n        \"left\": \"1000px\",\n        \"top\": \"300px\"\n      },\n      \"delay\": 0,\n      \"aiPrompt\": \"Você é a carol, uma menina de 18 anos, expontanea, fofa e divertida.\\n\\nVoce esta em uma conversa com uma pesssoa que acabou de te chamar.\\n\\nContexto: ele acabou de te chamar, voce mandou \\\"Oi\\\" e agora perguntou se ele está bem.\\n\\nA resposta dele é: {{input:bem}}\\nResponda Essa mensagem dele de forma carinhosa, meio sexy!\\n\\nRegras:\\n\\nNAO SEJA MUITO FORMAL!;\\nNAO USE EMOJIS EXAGERADOS, NO MAXIMO 1;\\nUSE ABREVIAÇÕES NAS MENSAGENS (IREI CITAR ABAIXO);\\nNÃO PERGUNTA NADA PARA ELE, APENAS RESPONDA;\\nNÃO USE MUITAS PONTUAÇÕES;\\nUSE ALGUNS ERROS \\\"BASICOS\\\" E DESPERCEBIVEIS DE ORTOGRAFIA.\\n\\nABREVIAÇÕES: Flw = Falou\\nVlw = Valeu\\nPq = Por que / Porque\\nVc = Você\\nTb = Também\\nMto = Muito\\nTd = Tudo\\nHj = Hoje\\nKd = Cadê\\nFds = Fim de semana\\nQnd = Quando\\nCmg = Comigo\\nSdd = Saudade\\nBjs = Beijos\\nAbs = Abraços\\nAki = Aqui\\nAmo = Amanhã\\nAta = Ah, tá\\nAxo = Acho\\nBj = Beijo\\nBlz = Beleza\\nBora = Vamos embora\\nBrinks = Brincadeira\\nCtz = Certeza\\nDlç = Delícia\\nDps = Depois\\nEh = É\\nEh nóis = É nós\\nFdc = Fim de conversa\\nFmz = Firmeza\\nGnt = Gente\\nKkk = Risada\\nMds = Meu Deus\\nMlk = Moleque\\nMsk = Música\\nMsm = Mesmo\\nMto = Muito\\nNada ave = Nada a ver\\nNgm = Ninguém\\nNiver = Aniversário\\nNois = Nós\\nObg = Obrigado(a)\\nPdc = Pode crer\\nPfv = Por favor\\nPqp = Puta que pariu\\nQndo = Quando\\nQro = Quero\\nRsrs = Risos\\nSla = Sei lá\\nSlc = Só Deus sabe\\nSdd = Saudade\\nSdds = Saudades\\nTdb = Tudo bem\\nTlg = Tá ligado\\nTmb = Também\\nTnc = Tomar no cu\\nTô = Estou\\nVdd = Verdade\\nVlr = Valer\\nVmk = Vamos que vamos\\nVsf = Vai se ferrar\\nVtnc = Vai tomar no cu\\nZap = WhatsApp\\nZlr = Zoeira\\n\\nOBS; VOCES NAO SE CONHECEM, ESTAO SE CONHECENDO AGORA, MANDE MENSAGEM NESSE CONTEXTO, NAO DIGA QUE ESTA COM SAUDADE E NEM NADA DO TIPO.\",\n      \"aiMemoryId\": \"chathuman\"\n    },\n    {\n      \"id\": \"message_1728753457188\",\n      \"type\": \"message\",\n      \"content\": \"{{ai:AI_1893}}\",\n      \"position\": {\n        \"left\": \"1000px\",\n        \"top\": \"580px\"\n      },\n      \"delay\": 6\n    },\n    {\n      \"id\": \"message_1728753494253\",\n      \"type\": \"message\",\n      \"content\": \"Me segue la no insta mb? perdi o meu antigo e to voltando com um novo kkk\",\n      \"position\": {\n        \"left\": \"1010px\",\n        \"top\": \"760px\"\n      },\n      \"delay\": 3\n    },\n    {\n      \"id\": \"input_1728753594493\",\n      \"type\": \"input\",\n      \"content\": \"É @carolxasq\",\n      \"position\": {\n        \"left\": \"990px\",\n        \"top\": \"1030px\"\n      },\n      \"delay\": 2,\n      \"inputKey\": \"insta\"\n    },\n    {\n      \"id\": \"wait_1728753613140\",\n      \"type\": \"wait\",\n      \"content\": \"40\",\n      \"position\": {\n        \"left\": \"1300px\",\n        \"top\": \"1040px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"message_1728753660589\",\n      \"type\": \"message\",\n      \"content\": \"🥰🥰\",\n      \"position\": {\n        \"left\": \"1400px\",\n        \"top\": \"760px\"\n      },\n      \"delay\": 2\n    },\n    {\n      \"id\": \"wait_1728755091025\",\n      \"type\": \"wait\",\n      \"content\": \"5\",\n      \"position\": {\n        \"left\": \"2130px\",\n        \"top\": \"890px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"message_1728755261536\",\n      \"type\": \"message\",\n      \"content\": \"Ok bb\",\n      \"position\": {\n        \"left\": \"2400px\",\n        \"top\": \"880px\"\n      },\n      \"delay\": 2\n    },\n    {\n      \"id\": \"input_1728755307695\",\n      \"type\": \"input\",\n      \"content\": \"Quer ver uma amostrinha? 😈\",\n      \"position\": {\n        \"left\": \"2730px\",\n        \"top\": \"890px\"\n      },\n      \"delay\": 3,\n      \"inputKey\": \"amostra\"\n    },\n    {\n      \"id\": \"wait_1728755324341\",\n      \"type\": \"wait\",\n      \"content\": \"12\",\n      \"position\": {\n        \"left\": \"3010px\",\n        \"top\": \"870px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"video_1728755334159\",\n      \"type\": \"video\",\n      \"content\": \"https://raw.githubusercontent.com/darkdohot/medias/main/video/bec406e0-b157-4cdf-9a81-a0452f89bc1b.mp4\",\n      \"position\": {\n        \"left\": \"3230px\",\n        \"top\": \"620px\"\n      },\n      \"delay\": 0,\n      \"caption\": \"🔥🔥\"\n    },\n    {\n      \"id\": \"wait_1728755370904\",\n      \"type\": \"wait\",\n      \"content\": \"5\",\n      \"position\": {\n        \"left\": \"3360px\",\n        \"top\": \"940px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"audio_1728755406016\",\n      \"type\": \"audio\",\n      \"content\": \"https://raw.githubusercontent.com/darkdohot/medias/main/audio/1908a8f1-5db2-4d16-a446-ef7fd5abf2a7.mp3\",\n      \"position\": {\n        \"left\": \"3370px\",\n        \"top\": \"1160px\"\n      },\n      \"delay\": 4,\n      \"caption\": \"\"\n    },\n    {\n      \"id\": \"audio_1728755491312\",\n      \"type\": \"audio\",\n      \"content\": \"https://raw.githubusercontent.com/darkdohot/medias/main/audio/d559aa4e-f90b-41bb-839a-a93acbe7aa41.mp3\",\n      \"position\": {\n        \"left\": \"3440px\",\n        \"top\": \"1750px\"\n      },\n      \"delay\": 5,\n      \"caption\": \"\"\n    },\n    {\n      \"id\": \"audio_1728755509979\",\n      \"type\": \"audio\",\n      \"content\": \"https://raw.githubusercontent.com/darkdohot/medias/main/audio/c06fd981-012d-426a-a7ec-c7669eaaf77b.mp3\",\n      \"position\": {\n        \"left\": \"3480px\",\n        \"top\": \"1950px\"\n      },\n      \"delay\": 6,\n      \"caption\": \"\"\n    },\n    {\n      \"id\": \"wait_1728755533847\",\n      \"type\": \"wait\",\n      \"content\": \"5\",\n      \"position\": {\n        \"left\": \"3530px\",\n        \"top\": \"2190px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"input_1728755544759\",\n      \"type\": \"input\",\n      \"content\": \"Quer ver mais bb?\",\n      \"position\": {\n        \"left\": \"3690px\",\n        \"top\": \"2410px\"\n      },\n      \"delay\": 4,\n      \"inputKey\": \"mais\"\n    },\n    {\n      \"id\": \"wait_1728755560735\",\n      \"type\": \"wait\",\n      \"content\": \"7\",\n      \"position\": {\n        \"left\": \"3740px\",\n        \"top\": \"2660px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"message_1728755567754\",\n      \"type\": \"message\",\n      \"content\": \"Ta bom\",\n      \"position\": {\n        \"left\": \"4100px\",\n        \"top\": \"2610px\"\n      },\n      \"delay\": 3\n    },\n    {\n      \"id\": \"message_1728755586482\",\n      \"type\": \"message\",\n      \"content\": \"https://carol-oliveira.netlify.app/\\n\\nSo acessar esse site ai pra ver meus valores vida\",\n      \"position\": {\n        \"left\": \"4200px\",\n        \"top\": \"2820px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"wait_1728755635130\",\n      \"type\": \"wait\",\n      \"content\": \"30\",\n      \"position\": {\n        \"left\": \"3950px\",\n        \"top\": \"1330px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"input_1728755680224\",\n      \"type\": \"input\",\n      \"content\": \"😏😏\",\n      \"position\": {\n        \"left\": \"3580px\",\n        \"top\": \"1440px\"\n      },\n      \"delay\": 2,\n      \"inputKey\": \"emoji\"\n    },\n    {\n      \"id\": \"message_1728755739543\",\n      \"type\": \"message\",\n      \"content\": \"Uiii\",\n      \"position\": {\n        \"left\": \"3980px\",\n        \"top\": \"1520px\"\n      },\n      \"delay\": 3\n    }\n  ],\n  \"connections\": [\n    {\n      \"sourceId\": \"start_node\",\n      \"targetId\": \"wait_1728703148737\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728703148737\",\n      \"targetId\": \"audio_1728703196951\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"audio_1728703196951\",\n      \"targetId\": \"input_1728703223120\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1728703223120\",\n      \"targetId\": \"wait_1728703263275\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728703293574\",\n      \"targetId\": \"input_1728703357766\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1728703357766\",\n      \"targetId\": \"wait_1728703368958\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728703368958\",\n      \"targetId\": \"audio_1728703423782\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"audio_1728703423782\",\n      \"targetId\": \"message_1728703476877\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728703476877\",\n      \"targetId\": \"wait_1728703771677\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728703771677\",\n      \"targetId\": \"input_1728703778636\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728703263275\",\n      \"targetId\": \"aiAgent_1728752951893\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"aiAgent_1728752951893\",\n      \"targetId\": \"message_1728753457188\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728753457188\",\n      \"targetId\": \"message_1728753494253\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728753494253\",\n      \"targetId\": \"input_1728753594493\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1728753594493\",\n      \"targetId\": \"wait_1728753613140\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728753613140\",\n      \"targetId\": \"message_1728753660589\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728753660589\",\n      \"targetId\": \"message_1728703293574\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1728703778636\",\n      \"targetId\": \"wait_1728755091025\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728755091025\",\n      \"targetId\": \"message_1728755261536\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728755261536\",\n      \"targetId\": \"input_1728755307695\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1728755307695\",\n      \"targetId\": \"wait_1728755324341\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728755324341\",\n      \"targetId\": \"video_1728755334159\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"video_1728755334159\",\n      \"targetId\": \"wait_1728755370904\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728755370904\",\n      \"targetId\": \"audio_1728755406016\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"audio_1728755491312\",\n      \"targetId\": \"audio_1728755509979\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"audio_1728755509979\",\n      \"targetId\": \"wait_1728755533847\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728755533847\",\n      \"targetId\": \"input_1728755544759\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1728755544759\",\n      \"targetId\": \"wait_1728755560735\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728755560735\",\n      \"targetId\": \"message_1728755567754\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728755567754\",\n      \"targetId\": \"message_1728755586482\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"audio_1728755406016\",\n      \"targetId\": \"input_1728755680224\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1728755680224\",\n      \"targetId\": \"wait_1728755635130\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"wait_1728755635130\",\n      \"targetId\": \"message_1728755739543\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1728755739543\",\n      \"targetId\": \"audio_1728755491312\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    }\n  ],\n  \"exportedAt\": \"2024-10-15T16:11:23.137Z\",\n  \"exportVersion\": \"1.0\"\n}\n\n{\n  \"id\": \"3d2e2425-7561-4435-a90d-a2499cf3a3f5\",\n  \"name\": \"teste\",\n  \"nodes\": [\n    {\n      \"id\": \"start_node\",\n      \"type\": \"start\",\n      \"content\": \"\",\n      \"position\": {\n        \"left\": \"50px\",\n        \"top\": \"50px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"message_1729008719391\",\n      \"type\": \"message\",\n      \"content\": \"oiee\",\n      \"position\": {\n        \"left\": \"190px\",\n        \"top\": \"60px\"\n      },\n      \"delay\": 2\n    },\n    {\n      \"id\": \"input_1729008725902\",\n      \"type\": \"input\",\n      \"content\": \"tudo bem?\",\n      \"position\": {\n        \"left\": \"500px\",\n        \"top\": \"50px\"\n      },\n      \"delay\": 3,\n      \"inputKey\": \"bem\",\n      \"saveResponse\": true\n    },\n    {\n      \"id\": \"condition_1729008744086\",\n      \"type\": \"condition\",\n      \"content\": \"Condição\",\n      \"position\": {\n        \"left\": \"800px\",\n        \"top\": \"50px\"\n      },\n      \"delay\": 0,\n      \"variable\": \"input:bem\",\n      \"conditionType\": \"contains\",\n      \"conditionValue\": \"ss\",\n      \"conditionValues\": null\n    },\n    {\n      \"id\": \"condition_1729008755448\",\n      \"type\": \"condition\",\n      \"content\": \"Condição\",\n      \"position\": {\n        \"left\": \"810px\",\n        \"top\": \"310px\"\n      },\n      \"delay\": 0,\n      \"variable\": \"input:bem\",\n      \"conditionType\": \"contains\",\n      \"conditionValue\": \"sim\",\n      \"conditionValues\": null\n    },\n    {\n      \"id\": \"condition_1729008760199\",\n      \"type\": \"condition\",\n      \"content\": \"Condição\",\n      \"position\": {\n        \"left\": \"870px\",\n        \"top\": \"620px\"\n      },\n      \"delay\": 0,\n      \"variable\": \"input:bem\",\n      \"conditionType\": \"contains\",\n      \"conditionValue\": \"tudo\",\n      \"conditionValues\": null\n    },\n    {\n      \"id\": \"message_1729008786014\",\n      \"type\": \"message\",\n      \"content\": \"q bom\",\n      \"position\": {\n        \"left\": \"1340px\",\n        \"top\": \"380px\"\n      },\n      \"delay\": 0\n    },\n    {\n      \"id\": \"message_1729008810519\",\n      \"type\": \"message\",\n      \"content\": \"poxa!\",\n      \"position\": {\n        \"left\": \"950px\",\n        \"top\": \"830px\"\n      },\n      \"delay\": 0\n    }\n  ],\n  \"connections\": [\n    {\n      \"sourceId\": \"start_node\",\n      \"targetId\": \"message_1729008719391\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"message_1729008719391\",\n      \"targetId\": \"input_1729008725902\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"input_1729008725902\",\n      \"targetId\": \"condition_1729008744086\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"condition_1729008744086\",\n      \"targetId\": \"condition_1729008755448\",\n      \"anchors\": [\n        \"Bottom\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"condition_1729008755448\",\n      \"targetId\": \"condition_1729008760199\",\n      \"anchors\": [\n        \"Bottom\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"condition_1729008744086\",\n      \"targetId\": \"message_1729008786014\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"condition_1729008755448\",\n      \"targetId\": \"message_1729008786014\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"condition_1729008760199\",\n      \"targetId\": \"message_1729008786014\",\n      \"anchors\": [\n        \"Right\",\n        \"Left\"\n      ]\n    },\n    {\n      \"sourceId\": \"condition_1729008760199\",\n      \"targetId\": \"message_1729008810519\",\n      \"anchors\": [\n        \"Bottom\",\n        \"Left\"\n      ]\n    }\n  ],\n  \"exportedAt\": \"2024-10-15T16:13:54.004Z\",\n  \"exportVersion\": \"1.0\"\n}\n\n\nVOCE IRA MONTAR FUNIS COMPLETOS E GRANDES E SEGUIR AS REGRAS DOS FUNIS COM BASE NOS EXEMPLOS FORNECIDOS ACIMA!\n\nOBS: TE FORNECI EXEMPLOS DE FUNIS JA CRIADOS, MAS NAO OBRIGATORIAMENTE VOCE TEM QUE USAR ESSES NÓS, SEJA CRIATIVO E COMPLEXO!\n\nE EM NÓS QUE TEM AGENTE DE IA, VOCE DEVE MONTAR O PROMPT DA IA TAMBEM!\n\nPOSICIONE OS NÓS EM CORDENADAS DE UMA FORMA QUE O FUNIL FIQUE ORGANIZADO! (SEMPRE COLOQUE UM NÓ UM POUCO DISTANTE DO OUTRO, A CADA CORDENADA, PRA FICAR ORGANIZADO  E NAO FICAR TUDO JUNTO)\n\nNos contents que tiver quebra de linha, use \n!",
     });
        
        const systemInstruction = `
        Você é um especialista em criar fluxos de atendimento automatizado (funis) para diversos tipos de negócios. 
        Sua tarefa é gerar um funil detalhado com base na descrição fornecida pelo usuário.
        
        Regras para a criação do funil:
        1. Sempre comece com um nó de início (start_node).
        2. Crie uma sequência lógica de nós que representem uma conversa fluida.
        3. Use uma variedade de tipos de nós: message, input, condition, wait, image, audio, video.
        4. Inclua nós de espera (wait) entre as mensagens para simular um tempo de resposta natural.
        5. Use nós de condição (condition) para criar ramificações no fluxo baseadas nas respostas do usuário.
        6. Adicione nós de input para coletar informações do usuário.
        7. Inclua nós de mídia (image, audio, video) quando apropriado para o contexto.
        8. Crie conexões lógicas entre os nós, garantindo que o fluxo seja coerente.
        9. Use variáveis para armazenar e reutilizar informações fornecidas pelo usuário (ex: {{input:nome}}).
        10. Mantenha o tom da conversa adequado ao tipo de negócio.
        11. Posicione os nós em coordenadas de forma que o funil fique organizado, sempre colocando um nó um pouco distante do outro.
        12. Use "\\n" para quebras de linha nos conteúdos dos nós.
        13. No input sempre sera uma pergunta que você ira fazer pro usuario, exemplo: "tudo bem?", "qual voce deseja?", etc... sempre sera uma pergunta!!!
        
        IMPORTANTE: Retorne apenas o JSON do funil, sem nenhum texto adicional antes ou depois.
        `;
        
        async function generateFunnel(prompt, steps) {
          try {
            const result = await model.generateContent([
              { text: systemInstruction },
              { text: `Crie um funil com ${steps} passos seguindo esse prompt: ${prompt}` }
            ]);
            const response = await result.response;
            const text = response.text();
            console.log(text)
            // Tentar extrair o JSON da resposta
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const jsonString = jsonMatch[0];
              const funnel = JSON.parse(jsonString);
              
              // Processar o conteúdo dos nós
              if (funnel.nodes && Array.isArray(funnel.nodes)) {
                funnel.nodes = funnel.nodes.map(node => {
                  if (node.content && typeof node.content === 'string') {
                    node.content = node.content.replace(/\\n/g, '\n');
                  }
                  return node;
                });
              }
              
              return funnel;
            } else {
              throw new Error("Não foi possível extrair JSON da resposta");
            }
          } catch (error) {
            console.error("Erro ao gerar o funil:", error);
            throw error;
          }
        }
        
        let funnelData;
        async function saveFunnelToFile(funnel, filename) {
          await fs.writeFile(filename, JSON.stringify(funnel, null, 2));
              const fileContent = await fs.readFile(filename, 'utf8');
             funnelData = JSON.parse(fileContent);
             funnelData = funnelData
          console.log(`Funil salvo em ${filename}`);
        }
        
    
        
         
          
          try {
            const generatedFunnel = await generateFunnel(prompt, steps);
            console.log("Funil gerado:", JSON.stringify(generatedFunnel, null, 2));
            await saveFunnelToFile(generatedFunnel, 'funil_loja_celulares.json');
const funilnovo = JSON.stringify(generatedFunnel, null, 2)

  const funnelId = uuidv4();

              const newFunnel = {
                ...funnelData.funnel,
                id: funnelId,
                userId: userId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
    
            await redisClient.set(`funnel:${funnelData.id}`, JSON.stringify(funnelData), 'EX', FUNNEL_EXPIRY);
            await redisClient.sadd(`user:${userId}:funnels`, funnelData.id);
    
           // res.status(201).json(newFunnel);
  
          return res.json({ success: true, funnel: funnelData });

          } catch (error) {
            console.error("Erro ao gerar o funil:", error);
                console.error('Error creating AI funnel:', error);
        res.status(500).json({ error: 'Error creating AI funnel' });
          }
    
  
         
    } catch (error) {
        console.error('Error creating AI funnel:', error);
        res.status(500).json({ error: 'Error creating AI funnel' });
    }
};