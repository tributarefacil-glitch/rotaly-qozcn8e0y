import fs from 'node:fs'

function replaceExact(filePath, searchStr, replaceStr) {
  const content = fs.readFileSync(filePath, 'utf8')
  const count = content.split(searchStr).length - 1
  if (count === 0) {
    throw new Error(
      `[${filePath}] Target string not found (0 matches)! Search prefix: ${searchStr.slice(0, 80)}...`,
    )
  }
  if (count > 1) {
    throw new Error(
      `[${filePath}] Target string found multiple times (${count} matches)! Must match exactly 1 time.`,
    )
  }
  const newContent = content.replace(searchStr, replaceStr)
  fs.writeFileSync(filePath, newContent, 'utf8')
  console.log(`[${filePath}] Successfully applied 1 exact replacement.`)
}

console.log('apply-tower-perf: Starting...')

// ==========================================
// MUDANÇA A, B e C em ControlTower.tsx
// ==========================================
const ctPath = 'src/components/ControlTower.tsx'

// 1. Adicionar o estado isPrimaryLoading e prop isPrimaryLoading/parentReady se aplicável
// Vamos verificar o bloco de estados em ControlTowerInner:
const ctStateSearch = `  const [orders, setOrders] = useState<OrderRecord[]>(initialOrders || [])
  const [couriers, setCouriers] = useState<UserRecord[]>(initialCouriers || [])
  const [locations, setLocations] = useState<LocationRecord[]>(propLocations || [])
  const [appSettings, setAppSettings] = useState<AppSettingsRecord | null>(propSettings || null)
  const [isLoading, setIsLoading] = useState(false)`

const ctStateReplace = `  const [orders, setOrders] = useState<OrderRecord[]>(initialOrders || [])
  const [couriers, setCouriers] = useState<UserRecord[]>(initialCouriers || [])
  const [locations, setLocations] = useState<LocationRecord[]>(propLocations || [])
  const [appSettings, setAppSettings] = useState<AppSettingsRecord | null>(propSettings || null)
  const [isLoading, setIsLoading] = useState(false)
  // Estado para indicar carregamento da Etapa 1 (pedidos + entregadores + telemetria)
  const [isPrimaryLoading, setIsPrimaryLoading] = useState<boolean>(() => {
    // Se o componente pai forneceu props com dados já presentes, inicia false
    if ((initialOrders && initialOrders.length > 0) || (initialCouriers && initialCouriers.length > 0)) {
      return false
    }
    // Se props foram explicitamente passadas (mesmo que vazias por ainda estarem carregando), inicia true
    return initialOrders !== undefined || initialCouriers !== undefined
  })`

replaceExact(ctPath, ctStateSearch, ctStateReplace)

// 2. MUDANÇA A: Fim do duplo carregamento e guarda corrigida em ControlTower.tsx
// Guarda: se o pai está montado (initialOrders ou initialCouriers !== undefined),
// a Torre NÃO busca sozinha imediatamente.
// Adiciona timeout curto (3.5s) de contingência: se após o timeout os dados ainda não chegaram
// ou se o componente foi aberto isolado (initialOrders === undefined), a Torre busca sozinha.
const ctGuardSearch = `  // Determina se o componente pai (SellerDashboard / AdminDashboard) já está fornecendo os dados via props
  // Contingência: se initialOrders ou initialCouriers vierem vazios (length === 0), a Torre busca os dados de forma autônoma
  const hasParentOrders = Array.isArray(initialOrders)
    ? initialOrders.length > 0
    : Boolean(initialOrders)
  const hasParentCouriers = Array.isArray(initialCouriers)
    ? initialCouriers.length > 0
    : Boolean(initialCouriers)`

const ctGuardReplace = `  // Determina se o componente pai (SellerDashboard / AdminDashboard) está conectado via props.
  // MUDANÇA A (Fim do duplo carregamento): Se o pai está montado (props passadas, mesmo com [] inicial),
  // a Torre NÃO dispara requisições concorrentes com o loadData() do pai.
  const isParentConnected = initialOrders !== undefined || initialCouriers !== undefined
  const hasParentOrdersData = Array.isArray(initialOrders) && initialOrders.length > 0
  const hasParentCouriersData = Array.isArray(initialCouriers) && initialCouriers.length > 0
  const [parentLoadTimedOut, setParentLoadTimedOut] = useState(false)

  // Timeout de contingência (3.5s): se o pai estiver conectado mas não entregar nada por timeout/falha,
  // ou se a Torre foi montada isolada sem pai conectado, libera a busca autônoma de contingência.
  useEffect(() => {
    if (!isParentConnected) {
      setParentLoadTimedOut(true)
      return
    }
    const timer = setTimeout(() => {
      setParentLoadTimedOut(true)
    }, 3500)
    return () => clearTimeout(timer)
  }, [isParentConnected])

  const hasParentOrders = isParentConnected && !parentLoadTimedOut
    ? true
    : hasParentOrdersData
  const hasParentCouriers = isParentConnected && !parentLoadTimedOut
    ? true
    : hasParentCouriersData`

replaceExact(ctPath, ctGuardSearch, ctGuardReplace)

// 3. MUDANÇA B: Carregamento em 2 etapas no fetchData autônomo da Torre
// ETAPA 1 (getOrders + getCouriers + getLatestLocations)
// ETAPA 2 (getSettings, getOffRouteEvents)
const ctFetchSearch = `      const [
        fetchedOrders,
        fetchedGlobalTransitOrders,
        fetchedCouriers,
        fetchedLocations,
        fetchedDeviations,
        fetchedSettings,
      ] = await Promise.all([
        !hasParentOrders
          ? deliveryService.getOrders(
              fallbackOrdersFilter,
              '-created',
              'customer_id,courier_id,seller_id',
            )
          : Promise.resolve(orders),
        deliveryService.getOrders(
          globalTransitFilter,
          '-created',
          'customer_id,courier_id,seller_id',
        ),
        !hasParentCouriers ? deliveryService.getCouriers() : Promise.resolve(couriers),
        deliveryService.getLatestLocations(),
        deliveryService.getOffRouteEvents('', '-created', 'courier_id,order_id').catch(() => []),
        deliveryService.getSettings().catch(() => null),
      ])

      if (!hasParentOrders) {
        setOrders(fetchedOrders)
      }
      // Filtrar estritamente pedidos do dia para globalInTransitOrders
      const onlyTodayGlobal = (fetchedGlobalTransitOrders || []).filter((o) =>
        isTodayOrder(o, operationalWindow),
      )
      setGlobalInTransitOrders(onlyTodayGlobal)
      if (!hasParentCouriers) {
        setCouriers(fetchedCouriers)
      }
      setLocations(fetchedLocations)
      setRecentDeviations(fetchedDeviations || [])
      if (fetchedSettings) {
        setAppSettings(fetchedSettings)
      }
      setLastUpdated(new Date())`

const ctFetchReplace = `      // ETAPA 1 (imediata, libera a tela): getOrders + getCouriers + getLatestLocations + ordens globais em trânsito
      const [
        fetchedOrders,
        fetchedGlobalTransitOrders,
        fetchedCouriers,
        fetchedLocations,
      ] = await Promise.all([
        !hasParentOrdersData
          ? deliveryService.getOrders(
              fallbackOrdersFilter,
              '-created',
              'customer_id,courier_id,seller_id',
            )
          : Promise.resolve(orders),
        deliveryService.getOrders(
          globalTransitFilter,
          '-created',
          'customer_id,courier_id,seller_id',
        ),
        !hasParentCouriersData ? deliveryService.getCouriers() : Promise.resolve(couriers),
        deliveryService.getLatestLocations(),
      ])

      if (!hasParentOrdersData) {
        setOrders(fetchedOrders)
      }
      // Filtrar estritamente pedidos do dia para globalInTransitOrders
      const onlyTodayGlobal = (fetchedGlobalTransitOrders || []).filter((o) =>
        isTodayOrder(o, operationalWindow),
      )
      setGlobalInTransitOrders(onlyTodayGlobal)
      if (!hasParentCouriersData) {
        setCouriers(fetchedCouriers)
      }
      setLocations(fetchedLocations)
      setIsPrimaryLoading(false)
      setLastUpdated(new Date())

      // ETAPA 2 (segundo plano, assíncrona, não bloqueia UI): getOffRouteEvents + getSettings
      Promise.all([
        deliveryService.getOffRouteEvents('', '-created', 'courier_id,order_id').catch(() => []),
        deliveryService.getSettings().catch(() => null),
      ])
        .then(([fetchedDeviations, fetchedSettings]) => {
          if (fetchedDeviations) {
            setRecentDeviations(fetchedDeviations)
          }
          if (fetchedSettings) {
            setAppSettings(fetchedSettings)
          }
        })
        .catch((secErr) => {
          console.warn('Erro ao carregar dados secundários da Torre de Controle:', secErr)
        })`

replaceExact(ctPath, ctFetchSearch, ctFetchReplace)

// 4. Efeito para sincronizar isPrimaryLoading quando o pai enviar dados
const ctSyncSearch = `  // Sync with incoming props com comparação estável por conteúdo (IDs + timestamps)
  const prevOrdersHashRef = useRef<string>('')
  useEffect(() => {
    if (!initialOrders) return
    const newHash = initialOrders
      .map((o) => \`\${o.id}-\${o.status}-\${o.updated || o.created}-\${o.route_started}-\${o.sequence}\`)
      .join('|')
    if (newHash !== prevOrdersHashRef.current) {
      prevOrdersHashRef.current = newHash
      setOrders(initialOrders)
    }
  }, [initialOrders])`

const ctSyncReplace = `  // Sync with incoming props com comparação estável por conteúdo (IDs + timestamps)
  const prevOrdersHashRef = useRef<string>('')
  useEffect(() => {
    if (!initialOrders) return
    const newHash = initialOrders
      .map((o) => \`\${o.id}-\${o.status}-\${o.updated || o.created}-\${o.route_started}-\${o.sequence}\`)
      .join('|')
    if (newHash !== prevOrdersHashRef.current) {
      prevOrdersHashRef.current = newHash
      setOrders(initialOrders)
    }
    // Quando initialOrders chega (mesmo que array vazio após carregamento concluído), encerra isPrimaryLoading
    setIsPrimaryLoading(false)
  }, [initialOrders])`

replaceExact(ctPath, ctSyncSearch, ctSyncReplace)

// 5. MUDANÇA C: Skeletons pulsantes nas 4 colunas do Kanban e na barra de frotas
// A) Barra de frotas / métricas do topo (Banner pills):
const ctMetricsBarSearch = `        {/* Banner "Acompanhe em tempo real" pills */}
        <div className="mt-5 pt-4 border-t border-[#1E2B58]/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-[#070D1E]/60 border border-slate-700/50 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Aguardando Início:</span>
            <span className="font-bold font-mono text-slate-200 text-sm">{metrics.pending}</span>
          </div>
          <div className="bg-[#070D1E]/60 border border-blue-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-blue-300 font-medium">Em Trânsito:</span>
            <span className="font-bold font-mono text-blue-400 text-sm">{metrics.inTransit}</span>
          </div>
          <div className="bg-[#070D1E]/60 border border-emerald-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-emerald-300 font-medium">Entregues hoje:</span>
            <span className="font-bold font-mono text-emerald-400 text-sm">
              {metrics.delivered}
            </span>
          </div>
          <div className="bg-[#070D1E]/60 border border-rose-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-rose-300 font-medium">Exceções / Falhas:</span>
            <span className="font-bold font-mono text-rose-400 text-sm">{metrics.issues}</span>
          </div>
        </div>`

const ctMetricsBarReplace = `        {/* Banner "Acompanhe em tempo real" pills com Skeletons pulsantes durante Etapa 1 */}
        {isPrimaryLoading ? (
          <div className="mt-5 pt-4 border-t border-[#1E2B58]/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={\`metrics-skel-\${i}\`}
                className="bg-[#070D1E]/60 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between animate-pulse"
              >
                <div className="h-3.5 w-24 bg-slate-700/60 rounded" />
                <div className="h-4 w-6 bg-slate-600/70 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 pt-4 border-t border-[#1E2B58]/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-[#070D1E]/60 border border-slate-700/50 rounded-xl p-2.5 flex items-center justify-between">
              <span className="text-slate-400 font-medium">Aguardando Início:</span>
              <span className="font-bold font-mono text-slate-200 text-sm">{metrics.pending}</span>
            </div>
            <div className="bg-[#070D1E]/60 border border-blue-500/30 rounded-xl p-2.5 flex items-center justify-between">
              <span className="text-blue-300 font-medium">Em Trânsito:</span>
              <span className="font-bold font-mono text-blue-400 text-sm">{metrics.inTransit}</span>
            </div>
            <div className="bg-[#070D1E]/60 border border-emerald-500/30 rounded-xl p-2.5 flex items-center justify-between">
              <span className="text-emerald-300 font-medium">Entregues hoje:</span>
              <span className="font-bold font-mono text-emerald-400 text-sm">
                {metrics.delivered}
              </span>
            </div>
            <div className="bg-[#070D1E]/60 border border-rose-500/30 rounded-xl p-2.5 flex items-center justify-between">
              <span className="text-rose-300 font-medium">Exceções / Falhas:</span>
              <span className="font-bold font-mono text-rose-400 text-sm">{metrics.issues}</span>
            </div>
          </div>
        )}`

replaceExact(ctPath, ctMetricsBarSearch, ctMetricsBarReplace)

// B) Skeletons pulsantes nas 4 colunas do Kanban:
const ctKanbanColSearch = `                  {/* Lista de Cards da Coluna */}
                  <div className="p-3 space-y-3 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-slate-800">
                    {columnOrders.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-[#070D1E]/40">
                        Nenhuma entrega nesta etapa
                      </div>
                    ) : (`

const ctKanbanColReplace = `                  {/* Lista de Cards da Coluna com Skeleton pulsante durante a Etapa 1 */}
                  <div className="p-3 space-y-3 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-slate-800">
                    {isPrimaryLoading ? (
                      <div className="space-y-3 animate-pulse">
                        {[1, 2, 3].map((skelId) => (
                          <div
                            key={\`col-skel-\${col.key}-\${skelId}\`}
                            className="rounded-xl p-3.5 border border-slate-700/40 bg-[#0e1738]/50 space-y-2.5"
                          >
                            <div className="flex items-center justify-between">
                              <div className="h-3.5 w-20 bg-slate-700/60 rounded" />
                              <div className="h-3 w-12 bg-slate-800 rounded" />
                            </div>
                            <div className="h-4 w-36 bg-slate-600/60 rounded" />
                            <div className="h-3 w-48 bg-slate-800/80 rounded" />
                            <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
                              <div className="h-3 w-24 bg-slate-700/40 rounded" />
                              <div className="h-3 w-8 bg-slate-700/40 rounded" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : columnOrders.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-[#070D1E]/40">
                        Nenhuma entrega nesta etapa
                      </div>
                    ) : (`

replaceExact(ctPath, ctKanbanColSearch, ctKanbanColReplace)

// ==========================================
// MUDANÇA B & C em SellerDashboard.tsx
// ==========================================
const sdPath = 'src/pages/SellerDashboard.tsx'

// 1. Adicionar o estado isPrimaryLoading no SellerDashboard
const sdStateSearch = `  const [isLoading, setIsLoading] = useState(true)`
const sdStateReplace = `  const [isLoading, setIsLoading] = useState(true)
  const [isPrimaryLoading, setIsPrimaryLoading] = useState(true)`
replaceExact(sdPath, sdStateSearch, sdStateReplace)

// 2. Refatorar loadData do SellerDashboard para 2 etapas claras:
// ETAPA 1 (primeiro, libera a tela): getOrders + getCouriers + getLatestLocations
// setIsPrimaryLoading(false)
// ETAPA 2 (segundo plano, assíncrona, sem bloquear estados visuais): getCustomers, getBaseAddresses, getSettings, getOffRouteEvents, getFuelAdvances
const sdLoadSearch = `      // ETAPA 1 (prioritária, imediata): getOrders + getCouriers + getLatestLocations
      // Popula os estados críticos e libera imediatamente a renderização dos cards do Kanban, entregadores e mapa
      const [ordersData, couriersData, locsData] = await Promise.all([
        deliveryService.getOrders(ordersFilter, '-created', 'customer_id,courier_id,seller_id'),
        deliveryService.getCouriers(),
        deliveryService.getLatestLocations(),
      ])
      setOrders(ordersData)
      setCouriers(couriersData)
      setLocations(locsData)
      setIsLoading(false)

      // ETAPA 2 (em segundo plano, sem bloquear UI): getCustomers, getBaseAddresses, getSettings, getOffRouteEvents, getFuelAdvances
      Promise.all([
        deliveryService.getCustomers(),
        deliveryService.getBaseAddresses(),
        deliveryService.getSettings(),
        deliveryService.getOffRouteEvents(),
        deliveryService.getFuelAdvances(),
      ])
        .then(([custData, basesData, settingsData, eventsData, fuelData]) => {
          setCustomers(custData)
          setFuelAdvances(fuelData)
          setBaseAddresses(basesData)
          setSettings(settingsData)
          setOffRouteEvents(eventsData)

          // Seleção robusta de base padrão
          const defaultBase = basesData.find((b) => b.is_default) || basesData[0]
          const defaultEnd = basesData.find((b) => b.is_end_default) || defaultBase

          if (defaultBase) {
            setSelectedBaseId(defaultBase.id)
          }
          if (defaultEnd) {
            setSelectedEndAddressId(defaultEnd.id)
          }
        })
        .catch((secErr) => {
          console.warn('Erro ao carregar dados secundários do SellerDashboard:', secErr)
        })`

const sdLoadReplace = `      setIsPrimaryLoading(true)
      // ETAPA 1 (primeiro, libera a tela): getOrders + getCouriers + getLatestLocations
      // Popula os estados críticos e libera imediatamente a renderização dos cards do Kanban, entregadores e mapa
      const [ordersData, couriersData, locsData] = await Promise.all([
        deliveryService.getOrders(ordersFilter, '-created', 'customer_id,courier_id,seller_id'),
        deliveryService.getCouriers(),
        deliveryService.getLatestLocations(),
      ])
      setOrders(ordersData)
      setCouriers(couriersData)
      setLocations(locsData)
      setIsPrimaryLoading(false)
      setIsLoading(false)

      // ETAPA 2 (segundo plano, assíncrona, sem bloquear estados visuais): getCustomers, getBaseAddresses, getSettings, getOffRouteEvents, getFuelAdvances
      Promise.all([
        deliveryService.getCustomers(),
        deliveryService.getBaseAddresses(),
        deliveryService.getSettings(),
        deliveryService.getOffRouteEvents(),
        deliveryService.getFuelAdvances(),
      ])
        .then(([custData, basesData, settingsData, eventsData, fuelData]) => {
          setCustomers(custData)
          setFuelAdvances(fuelData)
          setBaseAddresses(basesData)
          setSettings(settingsData)
          setOffRouteEvents(eventsData)

          // Seleção robusta de base padrão
          const defaultBase = basesData.find((b) => b.is_default) || basesData[0]
          const defaultEnd = basesData.find((b) => b.is_end_default) || defaultBase

          if (defaultBase) {
            setSelectedBaseId(defaultBase.id)
          }
          if (defaultEnd) {
            setSelectedEndAddressId(defaultEnd.id)
          }
        })
        .catch((secErr) => {
          console.warn('Erro ao carregar dados secundários do SellerDashboard:', secErr)
        })`

replaceExact(sdPath, sdLoadSearch, sdLoadReplace)

console.log('apply-tower-perf: All string replacements completed successfully!')
