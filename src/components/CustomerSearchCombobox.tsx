import React, { useState, useMemo, useRef, useEffect } from 'react'
import type { CustomerRecord } from '@/types/delivery'
import {
  Search,
  Check,
  ChevronsUpDown,
  X,
  UserPlus,
  Phone,
  MapPin,
  FileText,
  User,
} from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface CustomerSearchComboboxProps {
  customers: CustomerRecord[]
  selectedCustomerId?: string
  onSelectCustomer: (customer: CustomerRecord) => void
  onOpenCreateNewCustomer?: () => void
  disabled?: boolean
  className?: string
  placeholder?: string
}

// Utilitário para destacar substrings encontradas no texto (case-insensitive)
function HighlightText({
  text,
  query,
  className,
}: {
  text: string
  query: string
  className?: string
}) {
  if (!text) return null
  const cleanQ = query.trim()
  if (!cleanQ) return <span className={className}>{text}</span>

  // Divide o texto com base no termo
  const regex = new RegExp(`(${cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === cleanQ.toLowerCase() ? (
          <mark
            key={i}
            className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded-sm dark:bg-amber-500/30 dark:text-amber-200"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

// Highlight específico para campos numéricos/mascarados (como CPF, CNPJ e Telefones)
function HighlightDigits({
  text,
  digitsQuery,
  rawQuery,
  className,
}: {
  text: string
  digitsQuery: string
  rawQuery: string
  className?: string
}) {
  if (!text) return null
  // Se bater no texto original exato
  if (rawQuery.trim() && text.toLowerCase().includes(rawQuery.toLowerCase().trim())) {
    return <HighlightText text={text} query={rawQuery} className={className} />
  }

  // Se bater apenas nos dígitos numéricos
  const textDigits = text.replace(/\D/g, '')
  if (digitsQuery && textDigits.includes(digitsQuery)) {
    return (
      <span className={cn('relative', className)}>
        <mark className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded-sm dark:bg-amber-500/30 dark:text-amber-200">
          {text}
        </mark>
      </span>
    )
  }

  return <span className={className}>{text}</span>
}

export const CustomerSearchCombobox: React.FC<CustomerSearchComboboxProps> = ({
  customers,
  selectedCustomerId,
  onSelectCustomer,
  onOpenCreateNewCustomer,
  disabled = false,
  className,
  placeholder = 'Pesquisar cliente por nome, CPF, CNPJ ou telefone...',
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId),
    [customers, selectedCustomerId],
  )

  // Normalização e ranqueamento de relevância
  const filteredAndRankedCustomers = useMemo(() => {
    const raw = search.trim().toLowerCase()
    const digits = search.replace(/\D/g, '')

    if (!raw && !digits) {
      return customers
    }

    interface ScoredCustomer {
      customer: CustomerRecord
      score: number
      matchedField: 'name' | 'phone' | 'document' | 'address' | 'notes'
    }

    const scored: ScoredCustomer[] = []

    for (const c of customers) {
      const name = (c.name || '').toLowerCase()
      const doc = (c.document || '').toLowerCase()
      const docDigits = (c.document || '').replace(/\D/g, '')

      const phone1 = (c.phone || '').toLowerCase()
      const phone1Digits = (c.phone || '').replace(/\D/g, '')
      const phone2 = (c.phone2 || '').toLowerCase()
      const phone2Digits = (c.phone2 || '').replace(/\D/g, '')
      const phone3 = (c.phone3 || '').toLowerCase()
      const phone3Digits = (c.phone3 || '').replace(/\D/g, '')

      const address = (c.address || '').toLowerCase()
      const street = (c.street || '').toLowerCase()
      const postalCode = (c.postal_code || '').toLowerCase()
      const postalCodeDigits = (c.postal_code || '').replace(/\D/g, '')
      const notes = (c.notes || '').toLowerCase()

      let highestScore = 0
      let bestField: 'name' | 'phone' | 'document' | 'address' | 'notes' = 'name'

      // 1. NOME
      if (raw && name) {
        if (name === raw) {
          highestScore = Math.max(highestScore, 1000)
          bestField = 'name'
        } else if (name.startsWith(raw)) {
          highestScore = Math.max(highestScore, 800)
          bestField = 'name'
        } else if (name.includes(` ${raw}`)) {
          // Começa com a palavra no meio do nome
          highestScore = Math.max(highestScore, 650)
          bestField = 'name'
        } else if (name.includes(raw)) {
          highestScore = Math.max(highestScore, 500)
          bestField = 'name'
        }
      }

      // 2. DOCUMENTO (CPF / CNPJ)
      if (c.document) {
        if (raw && (doc === raw || doc.startsWith(raw))) {
          if (900 > highestScore) {
            highestScore = 900
            bestField = 'document'
          }
        } else if (digits && (docDigits === digits || docDigits.startsWith(digits))) {
          if (850 > highestScore) {
            highestScore = 850
            bestField = 'document'
          }
        } else if (raw && doc.includes(raw)) {
          if (600 > highestScore) {
            highestScore = 600
            bestField = 'document'
          }
        } else if (digits && docDigits.includes(digits)) {
          if (550 > highestScore) {
            highestScore = 550
            bestField = 'document'
          }
        }
      }

      // 3. TELEFONES (phone, phone2, phone3)
      const phones = [
        { text: phone1, dig: phone1Digits },
        { text: phone2, dig: phone2Digits },
        { text: phone3, dig: phone3Digits },
      ]

      for (const p of phones) {
        if (!p.dig && !p.text) continue
        if (digits && (p.dig === digits || p.dig.endsWith(digits))) {
          if (800 > highestScore) {
            highestScore = 800
            bestField = 'phone'
          }
        } else if (digits && (p.dig.startsWith(digits) || p.dig.includes(digits))) {
          if (650 > highestScore) {
            highestScore = 650
            bestField = 'phone'
          }
        } else if (raw && p.text.includes(raw)) {
          if (600 > highestScore) {
            highestScore = 600
            bestField = 'phone'
          }
        }
      }

      // 4. CEP e ENDEREÇO
      if (
        digits &&
        postalCodeDigits &&
        (postalCodeDigits === digits || postalCodeDigits.includes(digits))
      ) {
        if (500 > highestScore) {
          highestScore = 500
          bestField = 'address'
        }
      } else if (
        raw &&
        (address.includes(raw) || street.includes(raw) || postalCode.includes(raw))
      ) {
        if (400 > highestScore) {
          highestScore = 400
          bestField = 'address'
        }
      }

      // 5. OBSERVAÇÕES
      if (raw && notes && notes.includes(raw)) {
        if (300 > highestScore) {
          highestScore = 300
          bestField = 'notes'
        }
      }

      if (highestScore > 0) {
        scored.push({
          customer: c,
          score: highestScore,
          matchedField: bestField,
        })
      }
    }

    // Ordena do maior score para o menor; empates ordenados alfabeticamente por nome
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      return (a.customer.name || '').localeCompare(b.customer.name || '')
    })

    return scored.map((s) => s.customer)
  }, [customers, search])

  // Foco no input ao abrir
  useEffect(() => {
    if (open) {
      setHighlightedIndex(0)
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    } else {
      setSearch('')
    }
  }, [open])

  // Garantir que o item destacado esteja visível na rolagem
  useEffect(() => {
    if (open && listRef.current) {
      const activeEl = listRef.current.querySelector(
        `[data-index="${highlightedIndex}"]`,
      ) as HTMLElement | null
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex, open])

  const handleSelect = (customer: CustomerRecord) => {
    onSelectCustomer(customer)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev < filteredAndRankedCustomers.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : Math.max(0, filteredAndRankedCustomers.length - 1),
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (
        filteredAndRankedCustomers.length > 0 &&
        highlightedIndex >= 0 &&
        highlightedIndex < filteredAndRankedCustomers.length
      ) {
        handleSelect(filteredAndRankedCustomers[highlightedIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  const searchDigits = search.replace(/\D/g, '')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between bg-white text-left font-normal border-slate-300 dark:bg-slate-800 dark:border-slate-700 min-h-[44px] px-3 hover:bg-slate-50 dark:hover:bg-slate-700/60 shadow-sm transition-all',
            !selectedCustomer && 'text-slate-500 dark:text-slate-400',
            className,
          )}
        >
          {selectedCustomer ? (
            <div className="flex flex-col min-w-0 pr-2 text-left">
              <span className="font-semibold text-slate-900 dark:text-slate-100 text-xs sm:text-sm truncate">
                {selectedCustomer.name}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                📞 {selectedCustomer.phone}{' '}
                {selectedCustomer.document ? `• Doc: ${selectedCustomer.document}` : ''} • 📍{' '}
                {selectedCustomer.address}
              </span>
            </div>
          ) : (
            <span className="text-xs sm:text-sm flex items-center gap-2 truncate">
              <Search className="h-4 w-4 text-slate-400 shrink-0" />
              <span>{placeholder}</span>
            </span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[calc(100vw-2rem)] sm:w-[540px] md:w-[620px] p-0 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-xl rounded-xl overflow-hidden z-50"
      >
        {/* Barra de Pesquisa */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 p-3 bg-slate-50/70 dark:bg-slate-900/80">
          <Search className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <Input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setHighlightedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar por Nome, CPF, CNPJ ou Telefone..."
            className="h-8 border-0 bg-transparent text-xs sm:text-sm focus-visible:ring-0 focus-visible:ring-offset-0 px-1 placeholder:text-slate-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                inputRef.current?.focus()
              }}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-800"
              title="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Header de Status / Instruções Rápidas */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100/60 dark:bg-slate-800/40 border-b border-slate-200/80 dark:border-slate-800/80 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="truncate">
            {search.trim() ? (
              <>
                Filtrando por: &quot;
                <strong className="text-slate-700 dark:text-slate-200">{search}</strong>&quot;
              </>
            ) : (
              'Todos os clientes cadastrados'
            )}
          </span>
          <span className="font-semibold shrink-0 ml-2">
            {filteredAndRankedCustomers.length}{' '}
            {filteredAndRankedCustomers.length === 1 ? 'cliente' : 'clientes'}
          </span>
        </div>

        {/* Lista de Resultados com Scroll */}
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className="max-h-[320px] overflow-y-auto p-1.5 space-y-1 divide-y divide-slate-100 dark:divide-slate-800/60 focus:outline-none"
        >
          {filteredAndRankedCustomers.length === 0 ? (
            <div className="py-8 px-4 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-2">
                <User className="h-5 w-5" />
              </div>
              <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200">
                Nenhum cliente encontrado para &quot;{search}&quot;
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto">
                Verifique se o nome, CPF/CNPJ ou telefone foram digitados corretamente ou cadastre
                um novo cliente agora.
              </p>
              {onOpenCreateNewCustomer && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    onOpenCreateNewCustomer()
                  }}
                  className="mt-3.5 h-8 text-xs font-semibold bg-[#FF6B35] hover:bg-[#E5531E] text-white gap-1.5 shadow-sm"
                >
                  <UserPlus className="h-3.5 w-3.5" />+ Cadastrar Novo Cliente
                </Button>
              )}
            </div>
          ) : (
            filteredAndRankedCustomers.map((cust, idx) => {
              const isSelected = cust.id === selectedCustomerId
              const isHighlighted = idx === highlightedIndex

              return (
                <div
                  key={cust.id}
                  data-index={idx}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(cust)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={cn(
                    'group relative p-2.5 rounded-lg cursor-pointer transition-colors text-left flex items-start gap-2.5 pt-2',
                    isSelected &&
                      'bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900',
                    isHighlighted && !isSelected && 'bg-slate-100 dark:bg-slate-800/80',
                    !isHighlighted && !isSelected && 'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                  )}
                >
                  {/* Ícone de Seleção ou Check */}
                  <div className="mt-0.5 shrink-0">
                    <div
                      className={cn(
                        'w-4 h-4 rounded-full border flex items-center justify-center transition-colors',
                        isSelected
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-300 dark:border-slate-600 group-hover:border-blue-400',
                      )}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    </div>
                  </div>

                  {/* Informações do Cliente */}
                  <div className="min-w-0 flex-1 space-y-1">
                    {/* Linha 1: Nome Principal + Sub-rótulo Discreto de CPF/CNPJ */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        <HighlightText text={cust.name} query={search} />
                      </span>

                      {/* Sub-rótulo discreto de CPF / CNPJ quando existir */}
                      {cust.document && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] h-5 px-1.5 font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-normal flex items-center gap-1"
                        >
                          <FileText className="h-2.5 w-2.5 text-blue-500" />
                          <span>
                            Doc:{' '}
                            <HighlightDigits
                              text={cust.document}
                              digitsQuery={searchDigits}
                              rawQuery={search}
                            />
                          </span>
                        </Badge>
                      )}

                      {cust.lat && cust.lng && (
                        <span
                          title="Localização GPS gravada"
                          className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5"
                        >
                          ✓ GPS
                        </span>
                      )}
                    </div>

                    {/* Linha 2: Telefones formatados com destaque */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                      <span className="flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                        <Phone className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <HighlightDigits
                          text={cust.phone || 'Sem telefone'}
                          digitsQuery={searchDigits}
                          rawQuery={search}
                        />
                      </span>

                      {cust.phone2 && (
                        <span className="text-slate-500 dark:text-slate-400">
                          • Tel 2:{' '}
                          <HighlightDigits
                            text={cust.phone2}
                            digitsQuery={searchDigits}
                            rawQuery={search}
                          />
                        </span>
                      )}

                      {cust.phone3 && (
                        <span className="text-slate-500 dark:text-slate-400">
                          • Tel 3:{' '}
                          <HighlightDigits
                            text={cust.phone3}
                            digitsQuery={searchDigits}
                            rawQuery={search}
                          />
                        </span>
                      )}
                    </div>

                    {/* Linha 3: Endereço completo com CEP */}
                    <div className="flex items-start gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <MapPin className="h-3 w-3 text-[#FF6B35] shrink-0 mt-0.5" />
                      <span className="line-clamp-2">
                        <HighlightText
                          text={
                            cust.address ||
                            [cust.street, cust.neighborhood, cust.city, cust.state]
                              .filter(Boolean)
                              .join(', ') ||
                            'Sem endereço cadastrado'
                          }
                          query={search}
                        />
                        {cust.postal_code && (
                          <span className="font-mono ml-1 text-slate-600 dark:text-slate-300">
                            (CEP:{' '}
                            <HighlightDigits
                              text={cust.postal_code}
                              digitsQuery={searchDigits}
                              rawQuery={search}
                            />
                            )
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Rodapé do Dropdown com Atalho para Cadastrar Novo */}
        {onOpenCreateNewCustomer && (
          <div className="p-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90 flex items-center justify-between text-xs">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Não achou o cliente na lista?
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false)
                onOpenCreateNewCustomer()
              }}
              className="h-7 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-slate-800 gap-1 px-2"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>+ Cadastrar Novo</span>
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
