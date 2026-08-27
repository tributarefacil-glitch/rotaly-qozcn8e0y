// AI Logistics Assistant chat endpoint
routerAdd(
  'POST',
  '/backend/v1/agent-chat',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const userId = e.auth?.id
      if (!userId) return e.unauthorizedError('Autenticação necessária.')
      if (!body.message?.trim()) return e.badRequestError('Mensagem é obrigatória.')

      const result = $ai.agent('logistics-copilot').chat({
        user_id: userId,
        conversation_id: body.conversation_id || null,
        message: body.message,
      })

      return e.json(200, {
        conversation_id: result.conversation_id,
        content: result.content,
        citations: result.citations,
        message_id: result.message_id,
      })
    } catch (err) {
      console.log('Agent chat error:', err)
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'IA temporariamente indisponível.' })
      }
      if (err instanceof SkipAiAgentsError) {
        const status = err.status || 500
        return e.json(status, {
          error: status >= 500 ? 'Falha na consulta ao assistente.' : err.message,
        })
      }
      if (err instanceof SkipAiError) {
        const status = err.status || 502
        return e.json(status, {
          error: status >= 500 ? 'IA temporariamente indisponível.' : err.message,
        })
      }
      return e.json(500, {
        error:
          'Erro ao processar mensagem com o assistente logístico: ' + (err.message || String(err)),
      })
    }
  },
  $apis.requireAuth(),
)

// Agent Stream endpoint
routerAdd(
  'POST',
  '/backend/v1/agent-chat-stream',
  (e) => {
    try {
      const body = e.requestInfo().body || {}
      const userId = e.auth?.id
      if (!userId) return e.unauthorizedError('Autenticação necessária.')
      if (!body.message?.trim()) return e.badRequestError('Mensagem é obrigatória.')

      const conv = $ai.agent('logistics-copilot').getOrCreateConversation({
        user_id: userId,
        id: body.conversation_id || null,
      })

      const iter = $ai.agent('logistics-copilot').chat({
        user_id: userId,
        conversation_id: conv.id,
        message: body.message,
        stream: true,
      })

      e.response.header().set('Content-Type', 'text/event-stream')
      e.response.header().set('Cache-Control', 'no-cache')
      e.response.header().set('X-Conversation-Id', conv.id)
      $response.stream(e, iter)
    } catch (err) {
      console.log('Agent stream error:', err)
      if (err instanceof SkipAiConfigError) {
        return e.json(503, { error: 'IA temporariamente indisponível.' })
      }
      return e.json(500, { error: 'Erro no stream do assistente.' })
    }
  },
  $apis.requireAuth(),
)
