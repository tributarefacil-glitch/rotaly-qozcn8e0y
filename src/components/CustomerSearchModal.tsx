import React, { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CustomerRecord } from '@/types/delivery'
import { Search, User, Phone, FileText, MapPin, Edit, UserPlus, X, Building } from 'lucide-react'

interface CustomerSearchModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerRecord[]
  onSelectCustomerToEdit: (customer: CustomerRecord) => void
  onOpenCreateNew: () => void
}

export function CustomerSearchModal({
  open,
  onOpenChange,
  customers,
  onSelectCustomerToEdit,
  onOpenCreateNew,
}: CustomerSearchModalProps) {
  const [searchTerm, setSearchTerm] = useState('')

  // Filtro inteligente por Nome, CPF, CNPJ e Telefones (phone, phone2, phone3)
  // Ignora pontuação de máscara (normaliza apenas dígitos numéricos)
  const filteredCustomers = useMemo(() => {
    const raw = searchTerm.trim().toLowerCase()
    if (!raw) return customers

    const digits = searchTerm.replace(/\D/g, '')

    return customers.filter((c) => {
      // 1. Nome
      if (c.name && c.name.toLowerCase().includes(raw)) return true

      // 2. Documento (CPF / CNPJ) formatado ou números limpos
      if (c.document) {
        if (c.document.toLowerCase().includes(raw)) return true
        if (digits && c.document.replace(/\D/g, '').includes(digits)) return true
      }

      // 3. Telefones (phone, phone2, phone3) formatados ou apenas dígitos
      const phones = [c.phone, c.phone2, c.phone3].filter(Boolean) as string[]
      for (const p of phones) {
        if (p.toLowerCase().includes(raw)) return true
        if (digits && p.replace(/\D/g, '').includes(digits)) return true
      }

      // 4. Endereço / Bairro / Cidade
      if (c.address && c.address.toLowerCase().includes(raw)) return true
      if (c.street && c.street.toLowerCase().includes(raw)) return true
      if (c.neighborhood && c.neighborhood.toLowerCase().includes(raw)) return true
      if (c.city && c.city.toLowerCase().includes(raw)) return true

      return false
    })
  }, [customers, searchTerm])

  const handleEditClick = (customer: CustomerRecord) => {
    onSelectCustomerToEdit(customer)
    onOpenChange(false)
  }

  const handleCreateClick = () => {
    onOpenChange(false)
    onOpenCreateNew()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col bg-[#0E1738] text-white border-[#1E2B58] p-5 sm:p-6 shadow-brand-dark">
        <DialogHeader className="pb-3 border-b border-[#1E2B58]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-[#0052CC]/20 border border-[#0052CC]/40 text-[#60A5FA]">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black text-white font-heading">
                  Buscar e Editar Clientes
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Pesquise por <strong>Nome, CPF, CNPJ ou Telefone</strong> (com ou sem pontuação).
                </DialogDescription>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleCreateClick}
              className="h-8 px-3 text-xs font-bold bg-[#22C55E] hover:bg-[#1CA24D] text-white shadow-sm flex items-center gap-1.5 self-start sm:self-auto"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>+ Novo Cliente</span>
            </Button>
          </div>
        </DialogHeader>

        {/* Input de Busca com indicador e limpeza */}
        <div className="relative my-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            autoFocus
            type="text"
            placeholder="Digite o Nome, CPF, CNPJ ou Telefone do cliente..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-9 h-10 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus-visible:border-[#60A5FA] focus-visible:ring-[#60A5FA]/20"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Contador de resultados */}
        <div className="flex items-center justify-between text-[11px] text-slate-400 pb-2 px-1">
          <span>
            {searchTerm ? (
              <>
                Resultados para &quot;<strong className="text-white">{searchTerm}</strong>&quot;:
              </>
            ) : (
              'Todos os clientes cadastrados:'
            )}
          </span>
          <span className="font-semibold text-slate-300">
            {filteredCustomers.length}{' '}
            {filteredCustomers.length === 1 ? 'cliente encontrado' : 'clientes encontrados'}
          </span>
        </div>

        {/* Lista de clientes com scroll */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-10 px-4 rounded-xl bg-[#0A1128] border border-[#1E2B58] text-slate-400">
              <User className="h-10 w-10 mx-auto text-slate-600 mb-2" />
              <p className="text-xs font-semibold text-slate-300">Nenhum cliente encontrado</p>
              <p className="text-[11px] text-slate-500 mt-1">
                Tente buscar com outros dígitos ou cadastre um novo cliente.
              </p>
              <Button
                type="button"
                onClick={handleCreateClick}
                className="mt-3.5 h-8 text-xs bg-[#22C55E] hover:bg-[#1CA24D] text-white font-bold"
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Cadastrar este Cliente
              </Button>
            </div>
          ) : (
            filteredCustomers.map((c) => {
              const allPhones = [c.phone, c.phone2, c.phone3].filter(Boolean)

              return (
                <div
                  key={c.id}
                  className="group p-3 sm:p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] hover:border-[#60A5FA]/60 hover:bg-[#0E1738] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {/* Linha 1: Nome e Documento */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-white font-heading group-hover:text-[#60A5FA] transition-colors">
                        {c.name}
                      </span>
                      {c.document && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#1E2B58] text-slate-300 border border-[#2A3B7A] flex items-center gap-1">
                          <FileText className="h-2.5 w-2.5 text-[#60A5FA]" />
                          {c.document}
                        </span>
                      )}
                    </div>

                    {/* Linha 2: Telefones cadastrados */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                      <div className="flex items-center gap-1 text-[#22C55E] font-medium">
                        <Phone className="h-3 w-3" />
                        <span>{c.phone || 'Sem telefone principal'}</span>
                      </div>
                      {c.phone2 && (
                        <span className="text-[11px] text-slate-400">• Tel 2: {c.phone2}</span>
                      )}
                      {c.phone3 && (
                        <span className="text-[11px] text-slate-400">• Tel 3: {c.phone3}</span>
                      )}
                    </div>

                    {/* Linha 3: Endereço completo */}
                    <div className="flex items-start gap-1.5 text-[11px] text-slate-400">
                      <MapPin className="h-3 w-3 text-[#FF6B35] shrink-0 mt-0.5" />
                      <span className="truncate">
                        {c.address ||
                          [c.street, c.neighborhood, c.city, c.state].filter(Boolean).join(', ') ||
                          'Sem endereço informado'}
                      </span>
                    </div>
                  </div>

                  {/* Ação de Editar */}
                  <div className="shrink-0 flex items-center gap-2 pt-1 sm:pt-0 border-t sm:border-t-0 border-[#1E2B58]">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleEditClick(c)}
                      className="w-full sm:w-auto h-8 px-3 text-xs font-bold bg-[#0052CC] hover:bg-[#003E99] text-white flex items-center gap-1.5 shadow-sm"
                    >
                      <Edit className="h-3.5 w-3.5" />
                      <span>Editar Cliente</span>
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
