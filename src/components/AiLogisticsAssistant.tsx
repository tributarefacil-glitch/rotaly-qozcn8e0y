import React, { useState, useRef, useEffect } from 'react'
import {
  Sparkles,
  Send,
  Bot,
  User,
  X,
  Minimize2,
  Maximize2,
  HelpCircle,
  Clock,
  Truck,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/contexts/AuthContext'
import pb from '@/lib/pocketbase/client'
import { streamAgentChat } from '@/lib/skipAi'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created?: string
}

export const AiLogisticsAssistant: React.FC = () => {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Olá! Sou o Assistente Logístico IA. Como posso te ajudar hoje? Você pode perguntar sobre pedidos atrasados, status dos entregadores ou relatórios de performance em tempo real.',
      created: new Date().toISOString(),
    },
  ])

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isOpen])

  const quickPrompts = [
    'Qual entregador está mais rápido hoje?',
    'Mostre todos os pedidos atrasados ou urgentes',
    'Quantas entregas foram concluídas hoje?',
    'Qual é o status da frota em tempo real?',
  ]

  const handleSendMessage = async (userText?: string) => {
    const text = userText || input
    if (!text.trim() || isLoading) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      created: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    const tempAssistantId = `assistant-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: tempAssistantId,
        role: 'assistant',
        content: '',
        created: new Date().toISOString(),
      },
    ])

    try {
      const abortController = new AbortController()

      // Call our PocketBase backend agent stream route
      const res = await fetch(
        `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/agent-chat-stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: pb.authStore.token,
          },
          body: JSON.stringify({
            message: text.trim(),
            conversation_id: conversationId,
          }),
          signal: abortController.signal,
        },
      )

      if (res.ok && res.headers.get('Content-Type')?.includes('text/event-stream')) {
        const result = await streamAgentChat(res, {
          onChunk: (_chunk, accumulated) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === tempAssistantId ? { ...msg, content: accumulated } : msg,
              ),
            )
          },
          signal: abortController.signal,
        })

        if (result.conversation_id) {
          setConversationId(result.conversation_id)
        }
      } else {
        // Fallback to sync JSON agent chat if stream unavailable
        const syncRes = await fetch(
          `${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/agent-chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: pb.authStore.token,
            },
            body: JSON.stringify({
              message: text.trim(),
              conversation_id: conversationId,
            }),
          },
        )

        const data = await syncRes.json()
        if (data.content) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === tempAssistantId ? { ...msg, content: data.content } : msg,
            ),
          )
          if (data.conversation_id) setConversationId(data.conversation_id)
        } else {
          throw new Error(data.error || 'Não foi possível obter resposta da IA.')
        }
      }
    } catch (err: unknown) {
      console.error('Agent chat error:', err)
      const errorMsg = err instanceof Error ? err.message : 'Erro ao consultar IA'
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempAssistantId
            ? {
                ...msg,
                content: `⚠️ ${errorMsg}. (Exemplo de consulta: Lucas Motoboy e Marcos Rápido têm 3 entregas ativas no momento, com média de 24 min por rota).`,
              }
            : msg,
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#0052CC] hover:bg-[#003E99] text-white shadow-brand-hover hover:scale-105 transition-all duration-100 border border-blue-400/40"
        >
          <Sparkles className="h-6 w-6 text-[#FF6B35] animate-pulse" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF6B35] opacity-75"></span>
            <span className="relative inline-flex h-4 w-4 rounded-full bg-[#FF6B35] text-[9px] font-bold text-white items-center justify-center">
              AI
            </span>
          </span>
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] shadow-2xl transition-all">
      <Card className="border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark rounded-2xl overflow-hidden flex flex-col h-[520px]">
        {/* Header */}
        <CardHeader className="flex flex-row items-center justify-between border-b border-[#1E2B58] p-3.5 bg-[#0A1128]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0052CC] text-white shadow-brand">
              <Sparkles className="h-4 w-4 text-[#FF6B35]" />
            </div>
            <div>
              <CardTitle className="font-heading text-sm font-bold text-white flex items-center gap-2">
                LOGHYPE Copilot IA
                <Badge
                  variant="outline"
                  className="text-[10px] bg-[#0052CC]/30 text-[#60A5FA] border-[#60A5FA]/30 font-bold"
                >
                  Online
                </Badge>
              </CardTitle>
              <p className="font-sans text-[10px] text-slate-400">
                Assistente de Operações e Frotas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="h-7 w-7 text-slate-400 hover:text-white hover:bg-[#121E46] rounded-lg"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        {/* Messages Body */}
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 font-sans" ref={scrollRef}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0052CC] text-white text-xs shadow-xs">
                  <Bot className="h-3.5 w-3.5 text-[#FF6B35]" />
                </div>
              )}
              <div
                className={`rounded-xl px-3.5 py-2.5 text-xs max-w-[82%] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#0052CC] text-white font-medium shadow-xs'
                    : 'bg-[#0A1128] text-slate-200 border border-[#1E2B58]'
                }`}
              >
                {m.content ? (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <div className="flex items-center gap-1.5 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0052CC] animate-bounce"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FF6B35] animate-bounce [animation-delay:0.2s]"></span>
                    <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                )}
              </div>
              {m.role === 'user' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FF6B35] text-white text-xs shadow-xs">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          ))}

          {/* Quick Prompts Suggestions */}
          {messages.length <= 2 && (
            <div className="pt-2 space-y-1.5">
              <p className="font-heading text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Sugestões Rápidas:
              </p>
              <div className="flex flex-col gap-1.5">
                {quickPrompts.map((q, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(q)}
                    className="text-left text-[11px] p-2 rounded-lg bg-[#0A1128] hover:bg-[#121E46] border border-[#1E2B58] text-slate-300 hover:text-white transition font-sans"
                  >
                    ⚡ {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        {/* Input Footer */}
        <div className="p-3 border-t border-[#1E2B58] bg-[#0A1128]">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSendMessage()
            }}
            className="flex items-center gap-2"
          >
            <Input
              type="text"
              placeholder="Pergunte ao Copilot..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              className="h-9 bg-[#0E1738] border-[#1E2B58] text-xs text-white placeholder:text-slate-400 focus:border-[#60A5FA] rounded-lg"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isLoading || !input.trim()}
              className="h-9 w-9 shrink-0 bg-[#0052CC] hover:bg-[#003E99] text-white rounded-lg shadow-brand"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  )
}
