const axios = require('axios');
const cheerio = require('cheerio');
const API_BASE_URL = 'https://api.hocketzap.com';
const redisClient = require('../config/redisConfig');
class GroupScrapper {
  constructor() {
    this.baseUrl = 'https://www.gruposdewhatss.com.br';
    this.processedLinks = new Set();
    this.processedOwners = new Set();
    this.validGroups = [];
 
    // Carrega grupos processados ao inicializar
    this.loadProcessedGroups().catch(console.error);
  }

  getRandomPage() {
    return Math.floor(Math.random() * 70); // 0-10
  }


  async start(instanceKey, maxGroups = 10) {
    try {
      // Limpa o array de grupos válidos no início de cada chamada
      this.validGroups = [];
      
      let attempts = 0;
      const maxAttempts = 200;

      // Recarrega os grupos processados do Redis a cada chamada
      await this.loadProcessedGroups();
  
      // Array de páginas disponíveis
      let availablePages = Array.from({length: 70}, (_, i) => i + 1);  // Aumentei para 70 páginas
      
      while (this.validGroups.length === 0 && attempts < maxAttempts && availablePages.length > 0) {
        const randomIndex = Math.floor(Math.random() * availablePages.length);
        const currentPage = availablePages[randomIndex];
        availablePages.splice(randomIndex, 1);
  
        console.log(`Buscando em nova página: ${currentPage} de ${availablePages.length} restantes...`);
  
        const pageGroups = await this.scrapePage(currentPage);
  
        if (!pageGroups || pageGroups.length === 0) {
          console.log(`Nenhum grupo encontrado na página ${currentPage}`);
          continue;
        }
  
        // Filtra grupos já processados
        const newGroups = pageGroups.filter(group => 
          !this.processedLinks.has(group.detailLink)
        );

        console.log(`Encontrados ${newGroups.length} grupos não processados`);
  
        for (const group of newGroups) {
          attempts++;
          console.log(`Validando grupo: ${group.title} (Tentativa ${attempts})`);
  
          try {
            const isValid = await this.validateGroup(group, instanceKey);
            if (isValid && !this.processedOwners.has(isValid.owner)) {
              console.log(`Novo grupo válido encontrado: ${isValid.subject}`);
              
              // Adiciona aos processados ANTES de retornar
              await redisClient.sadd('processed_owners', isValid.owner);
              await redisClient.sadd('processed_groups', group.detailLink);
              
              this.processedOwners.add(isValid.owner);
              this.processedLinks.add(group.detailLink);

              // Retorna o grupo válido imediatamente
              return [{
                ...group,
                ...isValid
              }];
            }
          } catch (error) {
            console.error(`Erro ao validar grupo: ${error.message}`);
            continue;
          }
        }
      }
  
      console.log('Nenhum grupo válido encontrado após todas as tentativas');
      return [];
      
    } catch (error) {
      console.error('Erro no processo de scraping:', error);
      return [];
    }
  }

  async loadProcessedGroups() {
    const [processedGroups, processedOwners] = await Promise.all([
      redisClient.smembers('processed_groups'),
      redisClient.smembers('processed_owners')
    ]);

    this.processedLinks = new Set(processedGroups);
    this.processedOwners = new Set(processedOwners);

    console.log(`Carregados ${this.processedLinks.size} grupos e ${this.processedOwners.size} owners processados`);
  }

  
  async scrapePage(page) {
    try {
      console.log(`Buscando grupos na página ${page}...`);
      const url = `${this.baseUrl}/grupos-de-whatsapp-amizades${page > 1 ? '/page/' + page : ''}`;
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);
      const groups = [];

      $('.cardGroupInt').each((_, element) => {
        const $element = $(element);
        const groupLink = $element.find('.btnGroup').attr('href');
        
        if (groupLink && !this.processedLinks.has(groupLink)) {
          this.processedLinks.add(groupLink);
          groups.push({
            title: $element.find('.titleGroup').text().trim(),
            category: $element.find('.categoGroup').text().trim(),
            detailLink: `${this.baseUrl}${groupLink}`
          });
        }
      });

      console.log(`Encontrados ${groups.length} grupos na página ${page}`);
      return groups;
    } catch (error) {
      console.error(`Erro ao buscar grupos na página ${page}:`, error);
      return null;
    }
  }


  async extractWhatsAppLink(detailLink) {
    try {
      const response = await axios.get(detailLink);
      const $ = cheerio.load(response.data);
      const whatsappLink = $('a.btn.btn-primary.w-100.mt-4.mb-4.boxnovo').attr('href');
      
      if (!whatsappLink) return null;

      return whatsappLink;
    } catch (error) {
      console.error('Error extracting WhatsApp link:', error);
      return null;
    }
  }

  async validateGroup(group, instanceKey) {
    try {
      const whatsappLink = await this.extractWhatsAppLink(group.detailLink);
      if (!whatsappLink) {
        console.log('Link do WhatsApp não encontrado, pulando grupo...');
        return null;
      }

      const inviteCode = whatsappLink.split('/').pop();
      
      try {
        const response = await axios.get(
          `${API_BASE_URL}/group/inviteInfo/${instanceKey}?inviteCode=${inviteCode}`,
          { headers: { apikey: 'darkadm' } }
        );

        if (!response.data || !response.data.subject || !response.data.owner) {
          console.log('Grupo sem informações completas, pulando...');
          return null;
        }

        console.log(`Grupo válido encontrado: ${response.data.subject}`);
        return {
          inviteCode,
          subject: response.data.subject,
          owner: response.data.owner,
          size: response.data.size,
          desc: response.data.desc
        };

      } catch (error) {
        if (error.response?.status === 404 || 
            (error.response?.data?.status === 404) || 
            error.message.includes('404')) {
          console.log(`Grupo com código ${inviteCode} não existe mais, pulando...`);
          return null;
        }
        
        // Se for outro tipo de erro, loga para debug
        console.error('Erro na validação do grupo:', error.response?.data || error.message);
        return null;
      }

    } catch (error) {
      console.error('Erro ao validar grupo:', error);
      return null;
    }
  }
}

module.exports = new GroupScrapper();