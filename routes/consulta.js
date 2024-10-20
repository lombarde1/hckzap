const express = require('express');
const router = express.Router();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const { Buffer } = require('buffer');
const planCheck = require('../middleware/planCheck'); // Ajuste o caminho conforme necessário
const apiId = 24489805
const apiHash = 'd43d5d995e4120830ec00058591c1546';
const stringSession = new StringSession('');

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

async function startClient() {
    await client.connect();
    console.log('Cliente Telegram conectado');
}

startClient();

async function waitForBotResponse(timeout = 30000) {
    const startTime = Date.now();
    const bingsixbot = await client.getInputEntity('@BINGSIXBOT');

    while (Date.now() - startTime < timeout) {
        const messages = await client.getMessages(bingsixbot, {
            limit: 1
        });

        if (messages.length > 0 && messages[0].sender.username === 'BINGSIXBOT') {
            if (messages[0].message.includes('Consultando') && messages[0].message.includes('Para consultar')) {
                console.log("inclui")
                waitForBotResponse()
            } else {
                return messages[0];
            }

           
        }

        // Espera um pouco antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Timeout esperando resposta do bot');
}
async function sendCommand(command) {
    const bingsixbot = await client.getInputEntity('@BINGSIXBOT');
    console.log(command)
    await client.sendMessage(bingsixbot, { message: command });
    return waitForBotResponse();
}

async function clickButton(message, buttonText) {
    if (!message.replyMarkup || !message.replyMarkup.rows) {
        throw new Error('A mensagem não contém botões');
    }

    const buttons = message.replyMarkup.rows.flatMap(row => row.buttons);
    const button = buttons.find(btn => btn.text.toLowerCase() === buttonText.toLowerCase());
    
    if (!button) {
        throw new Error(`Botão não encontrado: ${buttonText}`);
    }

    console.log(`Clicando no botão: ${buttonText}`);

    // Enviamos o clique do botão sem esperar pela resposta
     client.invoke(new Api.messages.GetBotCallbackAnswer({
        peer: '@BINGSIXBOT',
        msgId: message.id,
        data: button.data,
    })).catch(error => {
        if (!error.message.includes('BOT_RESPONSE_TIMEOUT')) {
            console.error(`Erro ao clicar no botão: ${error.message}`);
        }
    });

    await new Promise(resolve => setTimeout(resolve, 3000));
    // Imediatamente começamos a esperar pela nova mensagem
    return waitForBotResponse(30000); // Ajuste o timeout conforme necessário
}

router.get('/telefone/:query', planCheck('premium'), async (req, res) => {
    try {
        const response = await sendCommand(`/telefone ${req.params.query}`);
        res.json({ message: response.message });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function downloadMedia(message) {
    if (!message.media) {
        throw new Error('A mensagem não contém mídia');
    }

    const buffer = await client.downloadMedia(message.media, {
        workers: 1
    });

    return buffer;
}

router.get('/cpf/:button/:query', planCheck('premium'), async (req, res) => {
    try {
        const { button, query } = req.params;
        
        const initialResponse = await sendCommand(`/cpf ${query}`);
        
        if (!initialResponse.replyMarkup || !initialResponse.replyMarkup.rows) {
            throw new Error('A resposta do bot não contém botões');
        }

        const finalResponse = await clickButton(initialResponse, button);
        
        if (button.toLowerCase() === 'foto') {
            try {
                const imageBuffer = await downloadMedia(finalResponse);
                res.set('Content-Type', 'image/jpeg');
                res.send(imageBuffer);
            } catch (error) {
                console.error('Erro ao processar a foto:', error);
                res.status(500).json({ error: 'Erro ao processar a foto' });
            }
        } else {
            res.json({ message: finalResponse.message });
        }
    } catch (error) {
        console.error('Erro na rota CPF:', error);
        res.status(500).json({ error: error.message });
    }
});


module.exports = router;