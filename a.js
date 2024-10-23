const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const cliProgress = require('cli-progress');

async function createFolder(folderName) {
    try {
        await fs.mkdir(folderName, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            console.error(`Erro ao criar pasta ${folderName}:`, error);
            throw error;
        }
    }
}

async function getVideoUrl(tiktokUrl) {
    try {
        const response = await axios.post('https://ssstik.io/abc?url=dl', 
            `id=${encodeURIComponent(tiktokUrl)}&locale=en&tt=RFREU2Nm`,
            {
                headers: {
                    'accept': '*/*',
                    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
                    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'hx-current-url': 'https://ssstik.io/en-1',
                    'hx-request': 'true', 
                    'hx-target': 'target',
                    'hx-trigger': '_gcaptcha_pt',
                    'priority': 'u=1, i',
                    'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'Referer': 'https://ssstik.io/en-1'
                }
            }
        );

        // Usar Cheerio para fazer parse do HTML
        const $ = cheerio.load(response.data);
        
        // Pegar exatamente o link com a classe correta
        const downloadLink = $('a.pure-button.pure-button-primary.is-center.u-bl.dl-button.download_link.without_watermark.vignette_active').attr('href');
        console.log(response)
        if (!downloadLink) {
            console.error('HTML retornado:', response.data);
            throw new Error('URL do vídeo não encontrada na resposta');
        }

        return downloadLink;

    } catch (error) {
        console.error('Erro completo:', error);
        throw new Error(`Erro ao obter URL do vídeo: ${error.message}`);
    }
}

async function downloadVideo(url, folderName, filename) {
    try {
        // Obtém a URL real do vídeo
        const videoUrl = await getVideoUrl(url);
        console.log(`URL do vídeo encontrada: ${videoUrl}`);
        
        // Download do vídeo
        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'arraybuffer',
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://ssstik.io/'
            }
        });

        const filePath = path.join(folderName, `${filename}.mp4`);
        await fs.writeFile(filePath, response.data);
        
        console.log(`\nVídeo baixado com sucesso: ${filename}`);
        return true;
    } catch (error) {
        console.error(`\nErro ao baixar ${url}:`, error.message);
        await fs.appendFile('errors.txt', `${url}\n`);
        return false;
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function processLinks(linksFile) {
    try {
        const content = await fs.readFile(linksFile, 'utf-8');
        const links = content.split('\n').filter(link => link.trim());

        const progressBar = new cliProgress.SingleBar({
            format: 'Progresso |{bar}| {percentage}% || {value}/{total} Videos',
            barCompleteChar: '█',
            barIncompleteChar: '░',
            hideCursor: true
        });

        progressBar.start(links.length, 0);
        let completed = 0;

        for (let i = 0; i < links.length; i++) {
            try {
                const link = links[i];
                const username = link.split('/')[3] || 'unknown_user';
                const videoId = link.split('/').pop() || Date.now();
                
                await createFolder(username);
                await downloadVideo(link, username, videoId);
                
                // Delay entre downloads
                await sleep(3000);
                
                completed++;
                progressBar.update(completed);
            } catch (error) {
                console.error(`\nErro ao processar link ${i + 1}:`, error.message);
            }
        }

        progressBar.stop();
        console.log('\nDownload completo!');

    } catch (error) {
        console.error('Erro ao processar arquivo de links:', error);
    }
}

// Execução principal
(async () => {
    // Instalar dependências
    const { execSync } = require('child_process');
    try {
        console.log('Instalando dependências necessárias...');
        execSync('npm install axios cli-progress cheerio', { stdio: 'inherit' });
    } catch (error) {
        console.error('Erro ao instalar dependências:', error);
        process.exit(1);
    }

    const args = process.argv.slice(2);
    const linksFile = args[0] || 'links.txt';

    console.log(`Iniciando downloads de ${linksFile}...`);
    await processLinks(linksFile);
})();