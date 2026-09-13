migrate(
  (app) => {
    // Criar coleção `site_content` para gerenciar conteúdo institucional público
    let siteContentCol
    try {
      siteContentCol = app.findCollectionByNameOrId('site_content')
    } catch (_) {
      siteContentCol = new Collection({
        name: 'site_content',
        type: 'base',
        listRule: '', // Leitura pública permitida para alimentar a landing page
        viewRule: '', // Leitura pública permitida
        createRule: "@request.auth.role = 'admin'",
        updateRule: "@request.auth.role = 'admin'",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          { name: 'key', type: 'text', required: true },
          { name: 'about_title', type: 'text' },
          { name: 'about_subtitle', type: 'text' },
          { name: 'about_paragraph_1', type: 'text' },
          { name: 'about_paragraph_2', type: 'text' },
          { name: 'about_paragraph_3', type: 'text' },
          { name: 'phone', type: 'text' },
          { name: 'whatsapp', type: 'text' },
          { name: 'email', type: 'text' },
          { name: 'address', type: 'text' },
          { name: 'opening_hours', type: 'text' },
          { name: 'facebook_url', type: 'text' },
          { name: 'instagram_url', type: 'text' },
          { name: 'linkedin_url', type: 'text' },
          { name: 'extra', type: 'json' },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_site_content_key ON site_content (key)'],
      })
      app.save(siteContentCol)
    }

    // Seed do registro padrão "main" caso ainda não exista
    try {
      app.findFirstRecordByData('site_content', 'key', 'main')
    } catch (_) {
      const record = new Record(siteContentCol)
      record.set('key', 'main')
      record.set('about_title', 'Tecnologia que move cada entrega')
      record.set(
        'about_subtitle',
        'A Rotaly nasceu com um objetivo claro: simplificar a logística urbana de ponta a ponta.',
      )
      record.set(
        'about_paragraph_1',
        'Unimos inteligência de rotas viárias, telemetria em tempo real e comprovantes digitais em uma plataforma unificada. Do momento em que o pedido sai do balcão até a assinatura do cliente final, garantimos transparência total, redução de até 40% nos gastos com combustível e previsibilidade para operadores e lojistas.',
      )
      record.set(
        'about_paragraph_2',
        'Nossa tecnologia foi desenhada para o dinamismo do dia a dia de farmácias, comércios locais e distribuidoras. Sem atritos, sem planilhas soltas e sem retrabalho, conectamos administradores, gestores de despacho e entregadores de forma intuitiva e eficiente.',
      )
      record.set(
        'about_paragraph_3',
        'Com sede no Rio de Janeiro e atendimento em expansão por todo o Brasil, colocamos controle operacional, auditoria de quilometragem e tranquilidade ao alcance de frotas de todos os tamanhes.',
      )
      record.set('phone', '(21) 4000-1234')
      record.set('whatsapp', '21999999999')
      record.set('email', 'contato@rotaly.com.br')
      record.set('address', 'Rio de Janeiro - RJ, Brasil')
      record.set('opening_hours', 'Segunda a Sábado, das 08:00 às 20:00')
      record.set('facebook_url', 'https://facebook.com')
      record.set('instagram_url', 'https://instagram.com')
      record.set('linkedin_url', 'https://linkedin.com')
      app.save(record)
    }
  },
  (app) => {
    try {
      const siteContentCol = app.findCollectionByNameOrId('site_content')
      app.delete(siteContentCol)
    } catch (_) {}
  },
)
