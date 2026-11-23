import { GUIDE_COLORS } from './guideLabels'

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="guide-mockup relative w-[240px] max-w-full rounded-[28px] border-[6px] border-slate-800 bg-[#0A1128] overflow-hidden shadow-xl mx-auto"
      aria-hidden="true"
    >
      {/* Barra de status */}
      <div className="flex items-center justify-between px-3 py-1 bg-black/40 text-[9px] text-slate-300">
        <span>14:32</span>
        <span className="flex items-center gap-1">GPS Rotaly</span>
      </div>
      {children}
    </div>
  )
}

function AppHeader() {
  return (
    <div className="flex items-center gap-2 px-3 py-2" style={{ background: GUIDE_COLORS.header }}>
      <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-black text-white">
        R
      </div>
      <span className="text-white text-[11px] font-bold">Rotaly</span>
      <span className="ml-auto text-[9px] text-emerald-300 font-semibold">GPS ativo</span>
    </div>
  )
}

export function MockupLogin() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-4 space-y-3">
        <p className="text-white text-xs font-bold text-center">Login Lojista &amp; Embarcador</p>
        <div className="rounded-lg border border-[#1E2B58] bg-[#0E1738] px-3 py-2 text-[10px] text-slate-400">
          E-mail ou usuário
        </div>
        <div className="rounded-lg border border-[#1E2B58] bg-[#0E1738] px-3 py-2 text-[10px] text-slate-400">
          Senha
        </div>
        <div className="rounded-lg bg-blue-600 py-2 text-center text-[11px] font-bold text-white">
          Entrar
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupPermissao() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
          <p className="text-rose-300 text-[10px] font-black uppercase">
            Permissão de segundo plano obrigatória
          </p>
          <p className="text-[9px] text-slate-300 mt-1">
            Para que seus quilômetros e entregas sejam computados com a tela apagada.
          </p>
          <div className="mt-2 space-y-1 text-[9px] text-slate-200">
            <p>1. Abrir Configurações do App</p>
            <p>2. Permissões &gt; Localização</p>
            <p className="text-emerald-400 font-bold">3. Permitir o tempo todo</p>
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
          <p className="text-amber-300 text-[9px] font-bold">
            Bateria: desative a otimização (Samsung, Xiaomi, Motorola)
          </p>
        </div>
        <div className="rounded-lg bg-rose-600 py-1.5 text-center text-[10px] font-bold text-white">
          Entendi, permitir o tempo todo
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupAceitarRota() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-2.5">
          <p className="text-[9px] text-slate-400">Rota atribuída pela base</p>
          <p className="text-white text-[11px] font-bold">4 entregas · 12,4 km previstos</p>
        </div>
        <div className="rounded-lg bg-emerald-600 py-2 text-center text-[11px] font-black text-white">
          Aceitar
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2">
          <p className="text-[9px] text-emerald-300">
            Ao aceitar, o GPS inicia automaticamente (telemetria oficial de km).
          </p>
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupClienteAtual() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        {/* Card do cliente atual */}
        <div className="rounded-2xl border-2 border-emerald-500 bg-[#0E1738] p-2.5 space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-emerald-500 text-slate-950 text-[9px] font-black flex items-center justify-center">
              1
            </span>
            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[8px] font-black uppercase text-slate-950">
              Entrega Atual
            </span>
            <span className="ml-auto text-[9px] font-black text-emerald-400">R$ 89,90</span>
          </div>
          <p className="text-white text-[11px] font-bold">DrogariaMais — Maria Souza</p>
          <p className="text-[9px] text-slate-300 leading-snug">
            Rua das Palmeiras, 120 - Centro, Pilar
          </p>
          <div className="rounded-lg bg-amber-500/20 border-2 border-amber-500/60 p-1.5">
            <p className="text-[8px] font-bold text-amber-300">
              Ponto de Referência (Atenção ao Chegar):
            </p>
            <p className="text-[8px] text-white">Portão verde depois da padaria</p>
          </div>
          {/* Telefone + WhatsApp */}
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-lg border border-[#1E2B58] bg-[#0A1128] px-2 py-1 text-[9px] text-slate-200">
              (22) 99999-8888
            </span>
            <span className="flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-600/20 px-2 py-1 text-[9px] font-bold text-emerald-300">
              WhatsApp
            </span>
          </div>
          {/* Botões de ação */}
          <div
            className="rounded-xl py-2 text-center text-[10px] font-bold text-white border border-blue-400/30"
            style={{ background: GUIDE_COLORS.azulIniciarGrad }}
          >
            Iniciar Entrega (GPS)
          </div>
          <div
            className="rounded-xl py-2 text-center text-[10px] font-black text-slate-950 border border-emerald-400/40"
            style={{ background: GUIDE_COLORS.verdeConcluir }}
          >
            Concluir Entrega
          </div>
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupGoogleMaps() {
  return (
    <PhoneFrame>
      <div className="relative h-[190px] bg-[#E8EAED]">
        {/* Falsas ruas */}
        <div className="absolute left-0 right-0 top-16 h-6 bg-white border-y border-slate-300" />
        <div className="absolute top-0 bottom-0 left-20 w-6 bg-white border-x border-slate-300" />
        {/* Rota azul */}
        <svg viewBox="0 0 220 180" className="absolute inset-0 h-full w-full">
          <path
            d="M30 150 Q 70 120 90 90 T 170 40"
            fill="none"
            stroke={GUIDE_COLORS.azulIniciar}
            strokeWidth="7"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute bottom-2 left-2 rounded-full bg-blue-600 px-2 py-1 text-[8px] font-bold text-white">
          2,1 km · 6 min
        </div>
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-white px-2 py-1 text-[8px] font-bold text-slate-700 shadow">
          Google Maps
        </div>
      </div>
      <AppHeader />
    </PhoneFrame>
  )
}

export function MockupForaDeOrdem() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border-2 border-amber-500 bg-amber-500/15 p-2.5">
          <p className="text-[10px] font-black text-amber-300">Entrega fora de ordem</p>
          <p className="mt-1 text-[9px] text-slate-200 leading-snug">
            Conclua primeiro a <strong>Entrega Atual (1)</strong>. Esta parada segue travada até a
            sequência chegar até ela.
          </p>
        </div>
        <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-2.5 opacity-70">
          <p className="text-[10px] font-bold text-slate-300">3. João Pereira</p>
          <p className="text-[9px] text-slate-500">Rua Aurora, 55</p>
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupComprovante() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border-2 border-[#00AA44] bg-white p-2.5 space-y-1.5">
          <p className="text-[11px] font-bold" style={{ color: GUIDE_COLORS.verdeModal }}>
            Confirmar Entrega de Pedido
          </p>
          <p className="text-[8px] text-slate-500">
            Código:{' '}
            <span className="font-bold" style={{ color: GUIDE_COLORS.azulIniciar }}>
              RTL-4F7K2
            </span>
          </p>
          <div className="rounded-md bg-slate-100 p-1.5 text-[8px] text-slate-600">
            Cliente: Maria Souza — Valor Total: R$ 89,90
          </div>
          <div className="grid grid-cols-2 gap-1">
            <div className="rounded-md border border-slate-300 py-1 text-center text-[8px] font-bold text-slate-600">
              Tirar Foto
            </div>
            <div className="rounded-md border border-slate-300 py-1 text-center text-[8px] font-bold text-slate-600">
              Assinatura
            </div>
          </div>
          <div className="rounded-md border-2 border-dashed border-slate-300 h-10 bg-white flex items-center justify-center text-[8px] text-slate-400">
            Desenhe ou assine com o dedo aqui
          </div>
        </div>
        <div
          className="rounded-lg py-1.5 text-center text-[10px] font-bold text-white"
          style={{ background: GUIDE_COLORS.verdeModal }}
        >
          Entrega confirmada!
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupPontoANaoAtendido() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 py-2 text-center text-[9px] font-bold text-amber-200">
          Cliente em outro endereço (Gravar Ponto A)
        </div>
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 py-2 text-center text-[9px] font-bold text-rose-300">
          Não Atendido (Ausente / Recusa / Endereço)
        </div>
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-2">
          <p className="text-[9px] text-slate-300">
            Voltar para base: <strong className="text-amber-400">bloqueado</strong>
          </p>
          <p className="text-[8px] text-amber-400">Finalize todas as entregas</p>
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupVoltarBase() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5">
          <p className="text-[10px] font-black text-emerald-300">Todas as entregas concluídas</p>
          <p className="mt-0.5 text-[9px] text-slate-200">
            Toque em <strong>Voltar para base (Google Maps)</strong> para o trajeto de retorno.
          </p>
        </div>
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
          <p className="text-[9px] font-bold text-amber-300">
            A base detecta por cerca virtual de 150 m
          </p>
          <p className="mt-0.5 text-[8px] text-slate-200">
            Dentro dela, o botão <strong>Finalizar Manualmente</strong> fica liberado.
          </p>
        </div>
        <div
          className="rounded-lg py-1.5 text-center text-[9px] font-bold text-white"
          style={{ background: GUIDE_COLORS.azulIniciar }}
        >
          Voltar para base (Google Maps)
        </div>
        <div className="rounded-lg bg-amber-500 py-1.5 text-center text-[9px] font-black text-slate-950">
          Finalizar Manualmente
        </div>
      </div>
    </PhoneFrame>
  )
}

export function MockupOfflineChat() {
  return (
    <PhoneFrame>
      <AppHeader />
      <div className="p-3 space-y-2">
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
          <p className="text-[10px] font-black text-amber-300">Sem internet na rua?</p>
          <p className="mt-0.5 text-[9px] text-slate-200 leading-snug">
            Tudo continua gravado no aparelho. Feche e abra o app: ele sincroniza sozinho quando o
            sinal voltar.
          </p>
        </div>
        <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-2.5">
          <p className="text-[9px] font-bold text-white">Chat rápido com a base</p>
          <div className="mt-1 rounded-md bg-[#0A1128] px-2 py-1 text-[8px] text-slate-300">
            Base: pode entregar na portaria
          </div>
          <div className="mt-1 rounded-md bg-emerald-600/30 px-2 py-1 text-[8px] text-emerald-200">
            Você: ok, chegando em 5 min
          </div>
        </div>
        <div className="flex justify-end">
          <span className="flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-[9px] font-bold text-white">
            Chat
          </span>
        </div>
      </div>
    </PhoneFrame>
  )
}
