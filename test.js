const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const apiId = '24489805';
const apiHash = 'd43d5d995e4120830ec00058591c1546';
const stringSession = new StringSession(''); // deixe vazio para primeira execução

async function main() {
    console.log('Iniciando...');

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text('Número de telefone: '),
        password: async () => await input.text('Senha da conta (se houver): '),
        phoneCode: async () => await input.text('Código recebido por SMS: '),
        onError: (err) => console.log(err),
    });

    console.log('Conectado com sucesso!');
    console.log(client.session.save()); // Salve esta string para usar nas próximas execuções

    // Função para enviar comando e receber resposta
    async function sendCommand(command) {
        const bingsixbot = await client.getInputEntity('@BINGSIXBOT');
        await client.sendMessage(bingsixbot, { message: command });

        const response = await new Promise((resolve) => {
            client.addEventHandler((event) => {
                if (event.message && event.message.peerId.username === 'BINGSIXBOT') {
                    resolve(event.message);
                }
            });
        });

        console.log('Resposta do bot:', response.message);
        return response;
    }

    // Função para clicar em botão
    async function clickButton(message, buttonText) {
        const buttons = message.replyMarkup.rows.flatMap(row => row.buttons);
        const button = buttons.find(btn => btn.text === buttonText);
        
        if (button) {
            await client.invoke({
                _: 'messages.getBotCallbackAnswer',
                peer: '@BINGSIXBOT',
                msgId: message.id,
                data: button.data,
            });
            console.log(`Clicou no botão: ${buttonText}`);
        } else {
            console.log(`Botão não encontrado: ${buttonText}`);
        }
    }

    // Exemplo de uso
    const response = await sendCommand('/start');
    await clickButton(response, 'Algum Botão'); // Substitua 'Algum Botão' pelo texto real do botão

    // Mantenha o processo rodando
    await new Promise(() => {});
}

main();