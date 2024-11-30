const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");
const fs = require('fs').promises;

// Configurar a API do Gemini
const genAI = new GoogleGenerativeAI("AIzaSyAX1BoKV9FFiQN6lWJuyCEZ80-nzaqJo74");

// Definir o schema simplificado
const schema = {
  resultado: SchemaType.JSON,
};

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
13. Limite o conteúdo de cada nó a no máximo 280 caracteres.
14. O campo "variable" deve ser usado apenas para nós de input e condition. Para outros tipos de nós, deixe-o vazio.
15. Para nós de input, use "variable" no formato "input:chave_unica" (ex: "input:nome").
16. Para nós de condition, use "variable" para referenciar o input que está sendo verificado (ex: "input:nome").

IMPORTANTE: O JSON gerado deve seguir esta estrutura:
{
  "id": "UUID gerado aleatoriamente",
  "name": "Nome do Funil",
  "nodes": [
    {
      "id": "ID único do nó",
      "type": "Tipo do nó",
      "content": "Conteúdo do nó",
      "position": {"left": "Xpx", "top": "Ypx"},
      "delay": 0,
      "inputKey": "",
      "variable": "",
      "conditionType": "",
      "conditionValue": "",
      "conditionValues": [],
      "caption": ""
    }
  ],
  "connections": [
    {
      "sourceId": "ID do nó de origem",
      "targetId": "ID do nó de destino",
      "anchors": ["Âncora de origem", "Âncora de destino"]
    }
  ],
  "exportedAt": "Data e hora da exportação",
  "exportVersion": "1.0"
}

Certifique-se de que o JSON gerado seja válido e inclua todos os nós e conexões necessárias.
`;

const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 0.7,
    topK: 1,
    topP: 1,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
    responseSchema: schema
  },
});

async function generateFunnel(prompt) {
  try {
    const result = await model.generateContent([
      { text: systemInstruction },
      { text: prompt }
    ]);
    const response = await result.response;
    const text = response.text();
    return JSON.parse(text);
  } catch (error) {
    console.error("Erro ao gerar ou analisar o funil:", error);
    throw error;
  }
}

async function saveFunnelToFile(funnel, filename) {
  await fs.writeFile(filename, JSON.stringify(funnel, null, 2));
  console.log(`Funil salvo em ${filename}`);
}

async function main() {
  const userPrompt = "Crie um funil de atendimento para uma loja de celulares com 18 passos. O funil deve incluir saudação, apresentação dos produtos, coleta de informações do cliente, opções de pagamento e confirmação do pedido.";
  
  try {
    const generatedFunnel = await generateFunnel(userPrompt);
    console.log(JSON.stringify(generatedFunnel, null, 2));
    await saveFunnelToFile(generatedFunnel, 'funnel_loja_celulares.json');
  } catch (error) {
    console.error("Erro ao gerar o funil:", error);
  }
}

main();