/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    $ai.agents.define(app, {
      slug: 'logistics-copilot',
      name: 'Assistente Logístico IA',
      description:
        'Assistente inteligente para monitorar frotas, entregadores, status de pedidos, atrasos e desempenho operacional.',
      systemPrompt: `Você é o Assistente Logístico IA (Logistics Copilot) de um sistema moderno de Gestão de Entregas.
Suas responsabilidades:
1. Responder perguntas sobre o status de pedidos, entregadores ativos, entregas em trânsito, pendentes e concluídas.
2. Identificar entregadores mais rápidos, pedidos com prioridade urgente ou atrasos.
3. Fornecer resumos operacionais e insights para vendedores e administradores.
4. Responder sempre em Português do Brasil com tom profissional, prestativo, claro e conciso.
5. Use dados reais das coleções de pedidos (orders), entregadores (users) e localizações (locations).`,
      tier: 'fast',
      tools: [
        {
          collection: 'orders',
          perms: { list: true, read: true, update: true },
          actAs: 'admin',
        },
        {
          collection: 'customers',
          perms: { list: true, read: true },
          actAs: 'admin',
        },
        {
          collection: 'locations',
          perms: { list: true, read: true },
          actAs: 'admin',
        },
        {
          collection: 'notifications',
          perms: { list: true, read: true, create: true },
          actAs: 'admin',
        },
      ],
      memory: [
        {
          type: 'text',
          payload: {
            text: 'Política operacional de entregas: Entregas urgentes devem ter prioridade máxima e rota direta. Entregadores são monitorados via GPS a cada 30 segundos. Desvios superiores a 500m disparam alertas automáticos no painel gerencial.',
          },
        },
        {
          type: 'faq',
          payload: {
            qa: [
              {
                question: 'Como funciona o rastreamento em tempo real?',
                answer:
                  'O entregador transmite suas coordenadas GPS que são sincronizadas instantaneamente via PocketBase Realtime para o painel do vendedor e para a página pública de rastreio.',
              },
              {
                question: 'Qual é o prazo limite para entregas normais e urgentes?',
                answer:
                  'Entregas normais têm prazo estimado de até 90 minutos. Entregas com prioridade urgente devem ser concluídas em até 40 minutos.',
              },
            ],
          },
        },
      ],
    })
  },
  (app) => {
    $ai.agents.delete(app, 'logistics-copilot')
  },
)
