import React, { useState, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deliveryService } from '@/services/deliveryService'
import {
  BRAZILIAN_STATES,
  normalizeBrazilianUF,
  lookupViaCep,
  fallbackGeocodeAddress,
  fallbackReverseGeocode,
} from '@/lib/googleMaps'
import {
  BaseAddressAutocomplete,
  type BaseAddressResult,
} from '@/components/BaseAddressAutocomplete'
import type { CustomerRecord } from '@/types/delivery'
import {
  UserPlus,
  Phone,
  Search,
  Loader2,
  Sparkles,
  CheckCircle2,
  Link2,
  Crosshair,
} from 'lucide-react'
import { toast } from 'sonner'

import { useEffect } from 'react'

interface CreateCustomerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCustomerCreated: (customer: CustomerRecord) => void
  customerToEdit?: CustomerRecord | null
  onOpenSearch?: () => void
}

export function CreateCustomerModal({
  open,
  onOpenChange,
  onCustomerCreated,
  customerToEdit = null,
  onOpenSearch,
}: CreateCustomerModalProps) {
  const [name, setName] = useState('')
  const [document, setDocument] = useState('')
  const [phone, setPhone] = useState('')
  const [phone2, setPhone2] = useState('')
  const [phone3, setPhone3] = useState('')
  const [showExtraPhones, setShowExtraPhones] = useState(false)
  const [streetAndNumber, setStreetAndNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity] = useState('')
  const [ufState, setUfState] = useState('SP')
  const [postalCode, setPostalCode] = useState('')
  const [lat, setLat] = useState<number | undefined>(undefined)
  const [lng, setLng] = useState<number | undefined>(undefined)

  const [addressSearchQuery, setAddressSearchQuery] = useState('')
  const [isLoadingViaCep, setIsLoadingViaCep] = useState(false)
  const [isSearchingPhone, setIsSearchingPhone] = useState(false)
  const [matchedExistingCustomer, setMatchedExistingCustomer] = useState<CustomerRecord | null>(
    null,
  )
  const [locationLinkInput, setLocationLinkInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEditMode = Boolean(customerToEdit)

  // Preenche o formulário quando o modal abre em modo de edição
  useEffect(() => {
    if (open && customerToEdit) {
      setName(customerToEdit.name || '')
      setDocument(customerToEdit.document || '')
      setPhone(customerToEdit.phone || '')
      setPhone2(customerToEdit.phone2 || '')
      setPhone3(customerToEdit.phone3 || '')
      if (customerToEdit.phone2 || customerToEdit.phone3) {
        setShowExtraPhones(true)
      } else {
        setShowExtraPhones(false)
      }
      setStreetAndNumber(customerToEdit.street || customerToEdit.address?.split(',')[0] || '')
      setComplement(customerToEdit.complement || '')
      setNeighborhood(customerToEdit.neighborhood || '')
      setCity(customerToEdit.city || '')
      if (customerToEdit.state) {
        const uf = normalizeBrazilianUF(customerToEdit.state)
        if (uf && BRAZILIAN_STATES.includes(uf)) setUfState(uf)
      }
      setPostalCode(customerToEdit.postal_code || '')
      setLat(customerToEdit.lat)
      setLng(customerToEdit.lng)
      setAddressSearchQuery(customerToEdit.address || '')
      setMatchedExistingCustomer(customerToEdit)
      setLocationLinkInput('')
    } else if (open && !customerToEdit) {
      resetForm()
    }
  }, [open, customerToEdit])

  const resetForm = () => {
    setName('')
    setDocument('')
    setPhone('')
    setPhone2('')
    setPhone3('')
    setShowExtraPhones(false)
    setStreetAndNumber('')
    setComplement('')
    setNeighborhood('')
    setCity('')
    setUfState('RJ')
    setPostalCode('')
    setLat(undefined)
    setLng(undefined)
    setAddressSearchQuery('')
    setMatchedExistingCustomer(null)
    setLocationLinkInput('')
  }

  // Auto-lookup existing customer by typed phone
  const checkCustomerByPhone = useCallback(async (phoneInput: string) => {
    const cleanDigits = phoneInput.replace(/\D/g, '')
    if (cleanDigits.length < 8) return

    setIsSearchingPhone(true)
    try {
      const found = await deliveryService.findCustomerByPhone(phoneInput)
      if (found) {
        setMatchedExistingCustomer(found)
        setName(found.name || '')
        setDocument(found.document || '')
        setPhone(found.phone || '')
        setPhone2(found.phone2 || '')
        setPhone3(found.phone3 || '')
        if (found.phone2 || found.phone3) setShowExtraPhones(true)
        setStreetAndNumber(found.street || found.address?.split(',')[0] || '')
        setNeighborhood(found.neighborhood || '')
        setCity(found.city || '')
        if (found.state) {
          const uf = normalizeBrazilianUF(found.state)
          if (uf && BRAZILIAN_STATES.includes(uf)) setUfState(uf)
        }
        setPostalCode(found.postal_code || '')
        setComplement(found.complement || '')
        if (found.lat && found.lng) {
          setLat(found.lat)
          setLng(found.lng)
        }
        toast.info(
          `Cliente "${found.name}" localizado pelo telefone. O cadastro será atualizado sem duplicidade!`,
        )
      } else {
        setMatchedExistingCustomer(null)
      }
    } catch (e) {
      console.warn('Erro ao verificar cliente por telefone:', e)
    } finally {
      setIsSearchingPhone(false)
    }
  }, [])

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setPhone(val)
    if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current)
    const digits = val.replace(/\D/g, '')
    if (digits.length >= 8) {
      phoneDebounceRef.current = setTimeout(() => {
        checkCustomerByPhone(val)
      }, 500)
    }
  }

  // Callback disparado ao selecionar ou buscar um endereço pelo BaseAddressAutocomplete
  const handleAddressSelect = useCallback((result: BaseAddressResult) => {
    if (result.parsed) {
      if (result.parsed.streetAndNumber) {
        setStreetAndNumber(result.parsed.streetAndNumber)
      } else if (result.parsed.street) {
        const fullStreet = result.parsed.number
          ? `${result.parsed.street}, ${result.parsed.number}`
          : result.parsed.street
        setStreetAndNumber(fullStreet)
      } else if (result.address) {
        setStreetAndNumber(result.address.split(',')[0] || result.address)
      }

      if (result.parsed.neighborhood) {
        setNeighborhood(result.parsed.neighborhood)
      }
      if (result.parsed.city) {
        setCity(result.parsed.city)
      }
      if (result.parsed.state) {
        const uf = normalizeBrazilianUF(result.parsed.state)
        if (uf && BRAZILIAN_STATES.includes(uf)) {
          setUfState(uf)
        }
      }
      if (result.parsed.postalCode) {
        setPostalCode(result.parsed.postalCode)
      }
    } else if (result.address) {
      setStreetAndNumber(result.address.split(',')[0] || result.address)
    }

    setAddressSearchQuery(result.address || result.name || '')

    if (typeof result.lat === 'number' && typeof result.lng === 'number') {
      setLat(result.lat)
      setLng(result.lng)
    }

    toast.success('Endereço localizado e campos preenchidos com sucesso!')
  }, [])

  // Lookup CEP via ViaCEP
  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/\D/g, '')
    if (raw.length > 5) {
      raw = raw.replace(/^(\d{5})(\d)/, '$1-$2')
    }
    setPostalCode(raw)

    const clean = raw.replace(/\D/g, '')
    if (clean.length === 8) {
      setIsLoadingViaCep(true)
      try {
        const res = await lookupViaCep(clean)
        if (res) {
          if (res.street) setStreetAndNumber(res.street)
          if (res.neighborhood) setNeighborhood(res.neighborhood)
          if (res.city) setCity(res.city)
          if (res.state) {
            const uf = normalizeBrazilianUF(res.state)
            if (uf && BRAZILIAN_STATES.includes(uf)) setUfState(uf)
          }
          toast.success('Endereço preenchido automaticamente pelo CEP!')

          // Tentar geocodificar para obter coordenadas (polo operacional RJ como bias)
          const full = `${res.street || ''}, ${res.neighborhood || ''}, ${res.city || ''} - ${res.state || ''}, Brasil`
          fallbackGeocodeAddress(full, { lat: -22.906847, lng: -43.172896 }).then((geo) => {
            if (geo) {
              setLat(geo.lat)
              setLng(geo.lng)
            }
          })
        } else {
          toast.warning('CEP não encontrado. Preencha o endereço manualmente.')
        }
      } catch {
        toast.error('Erro ao consultar CEP.')
      } finally {
        setIsLoadingViaCep(false)
      }
    }
  }

  // Parse link de GPS / WhatsApp
  const handleParseLink = () => {
    const raw = locationLinkInput.trim()
    if (!raw) return

    // Coordenadas @lat,lng ou q=lat,lng ou -22.90,-43.17
    const match =
      raw.match(/@\s*([+-]?\d+\.\d+)\s*,\s*([+-]?\d+\.\d+)/) ||
      raw.match(/(?:q|ll|loc|destination)=([+-]?\d+\.\d+)[,\s%20]+([+-]?\d+\.\d+)/i) ||
      raw.match(/([+-]?\d{1,2}\.\d+)[,\s]+([+-]?\d{1,3}\.\d+)/)

    if (match) {
      const parsedLat = parseFloat(match[1])
      const parsedLng = parseFloat(match[2])
      if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
        setLat(parsedLat)
        setLng(parsedLng)
        toast.success(`Coordenadas fixadas: ${parsedLat.toFixed(4)}, ${parsedLng.toFixed(4)}`)
        fallbackReverseGeocode(parsedLat, parsedLng).then((res) => {
          if (res) {
            if (res.streetAndNumber) setStreetAndNumber(res.streetAndNumber)
            if (res.neighborhood) setNeighborhood(res.neighborhood)
            if (res.city) setCity(res.city)
            if (res.state) {
              const uf = normalizeBrazilianUF(res.state)
              if (uf && BRAZILIAN_STATES.includes(uf)) setUfState(uf)
            }
            if (res.postalCode) setPostalCode(res.postalCode)
          }
        })
        return
      }
    }
    toast.error('Não foi possível identificar coordenadas no link colado.')
  }

  const getFullFormattedAddress = () => {
    const parts: string[] = []
    if (streetAndNumber.trim()) parts.push(streetAndNumber.trim())
    if (complement.trim()) parts.push(complement.trim())
    if (neighborhood.trim()) parts.push(neighborhood.trim())
    if (city.trim()) {
      parts.push(ufState ? `${city.trim()} - ${ufState}` : city.trim())
    }
    if (postalCode.trim()) parts.push(`CEP: ${postalCode.trim()}`)
    return parts.join(', ')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    const mainPhone = phone.trim()

    if (!trimmedName) {
      toast.error('Preencha o nome do cliente.')
      return
    }

    if (!mainPhone) {
      toast.error('Preencha ao menos um telefone de contato (WhatsApp).')
      return
    }

    const fullAddress = getFullFormattedAddress() || streetAndNumber.trim()
    if (!streetAndNumber.trim() && !fullAddress.trim()) {
      toast.error('Preencha a Rua e Número ou busque pelo endereço/CEP.')
      return
    }

    const phonesToValidate = [mainPhone, phone2.trim() || undefined, phone3.trim() || undefined]

    const payload: Partial<CustomerRecord> = {
      name: trimmedName,
      document: document.trim() || undefined,
      phone: mainPhone,
      phone2: phone2.trim() || undefined,
      phone3: phone3.trim() || undefined,
      address: fullAddress,
      street: streetAndNumber.trim(),
      neighborhood: neighborhood.trim(),
      city: city.trim(),
      state: ufState.trim(),
      postal_code: postalCode.trim(),
      complement: complement.trim(),
      lat: lat || -22.906847,
      lng: lng || -43.172896,
    }

    setIsSubmitting(true)
    try {
      const targetCustomer = customerToEdit || matchedExistingCustomer

      if (targetCustomer) {
        // Checar conflito com OUTRO cliente
        const conflict = await deliveryService.checkPhoneConflict(
          phonesToValidate,
          targetCustomer.id,
        )
        if (conflict.conflict && conflict.customer) {
          toast.error(
            `O telefone ${conflict.duplicatePhone} já pertence ao cliente "${conflict.customer.name}". Evite duplicações!`,
          )
          return
        }

        const updated = await deliveryService.updateCustomer(targetCustomer.id, payload)
        toast.success(`Cadastro do cliente "${trimmedName}" atualizado com sucesso!`)
        resetForm()
        onCustomerCreated(updated)
        onOpenChange(false)
      } else {
        // Checar se já existe pelo telefone
        const conflict = await deliveryService.checkPhoneConflict(phonesToValidate)
        if (conflict.conflict && conflict.customer) {
          // Atualiza o existente em vez de duplicar
          const updated = await deliveryService.updateCustomer(conflict.customer.id, payload)
          toast.info(
            `Telefone vinculado ao cliente "${conflict.customer.name}". Cadastro atualizado sem duplicidade!`,
          )
          resetForm()
          onCustomerCreated(updated)
          onOpenChange(false)
        } else {
          const created = await deliveryService.createCustomer(payload)
          toast.success(`Cliente "${created.name}" cadastrado com sucesso!`)
          resetForm()
          onCustomerCreated(created)
          onOpenChange(false)
        }
      }
    } catch (err) {
      console.error('Erro ao salvar cliente:', err)
      toast.error('Erro ao salvar cliente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-[#0E1738] text-white border-[#1E2B58] p-5 sm:p-6 shadow-brand-dark">
        <DialogHeader className="pb-2 border-b border-[#1E2B58]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div
                className={`p-2 rounded-xl border ${
                  isEditMode
                    ? 'bg-[#0052CC]/20 border-[#0052CC]/40 text-[#60A5FA]'
                    : 'bg-[#22C55E]/20 border-[#22C55E]/40 text-[#22C55E]'
                }`}
              >
                <UserPlus className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-black text-white font-heading">
                  {isEditMode ? 'Editar Cliente' : 'Cadastrar Novo Cliente'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  {isEditMode
                    ? 'Atualize os dados, telefones ou endereço do cliente selecionado.'
                    : 'Cadastre clientes com até 3 telefones, busca automática por CEP e deduplicação inteligente.'}
                </DialogDescription>
              </div>
            </div>

            {onOpenSearch && !isEditMode && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenSearch}
                className="shrink-0 h-8 text-xs gap-1.5 border-[#1E2B58] bg-[#0A1128] hover:bg-[#1E2B58] text-[#60A5FA] hover:text-white"
              >
                <Search className="h-3.5 w-3.5 text-[#60A5FA]" />
                <span className="hidden sm:inline">Buscar Cadastrado</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Identificação de duplicidade / cliente existente */}
          {matchedExistingCustomer && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#0052CC]/20 border border-[#0052CC]/50 text-xs text-[#60A5FA]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#22C55E]" />
                <span>
                  Cliente já cadastrado encontrado! Os dados foram preenchidos para você atualizar.
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMatchedExistingCustomer(null)
                  setName('')
                  setPhone('')
                  setPhone2('')
                  setPhone3('')
                  setStreetAndNumber('')
                  setComplement('')
                  setNeighborhood('')
                  setCity('')
                  setPostalCode('')
                }}
                className="h-6 text-[11px] text-slate-400 hover:text-white"
              >
                Limpar
              </Button>
            </div>
          )}

          {/* Nome, Documento (CPF/CNPJ) e Telefone Principal */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <Label className="text-xs font-semibold text-slate-300">
                Nome / Empresa <span className="text-[#FF6B35]">*</span>
              </Label>
              <Input
                placeholder="Ex: Ana Maria Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                required
              />
            </div>

            <div className="sm:col-span-1">
              <Label className="text-xs font-semibold text-slate-300">CPF / CNPJ</Label>
              <Input
                placeholder="000.000.000-00 ou CNPJ"
                value={document}
                onChange={(e) => setDocument(e.target.value)}
                className="mt-1 h-9 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
              />
            </div>

            <div className="sm:col-span-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                  <Phone className="h-3 w-3 text-[#22C55E]" />
                  Telefone (WhatsApp) <span className="text-[#FF6B35]">*</span>
                </Label>
                {isSearchingPhone && (
                  <span className="text-[10px] text-[#60A5FA] flex items-center gap-1">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" /> buscando...
                  </span>
                )}
              </div>
              <Input
                placeholder="(11) 98765-4321"
                value={phone}
                onChange={handlePhoneChange}
                className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                required
              />
            </div>
          </div>

          {/* Telefones adicionais (até 3 telefones com deduplicação) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowExtraPhones(!showExtraPhones)}
                className="h-6 px-1.5 text-xs text-[#60A5FA] hover:text-white hover:bg-[#1E2B58]/40"
              >
                {showExtraPhones
                  ? '− Ocultar telefones adicionais'
                  : '+ Adicionar telefones 2 e 3 (até 3 números de contato)'}
              </Button>
            </div>

            {showExtraPhones && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
                <div>
                  <Label className="text-xs font-semibold text-slate-300">
                    Telefone 2 (Fixo / Comercial)
                  </Label>
                  <Input
                    placeholder="Ex: (11) 3456-7890"
                    value={phone2}
                    onChange={(e) => setPhone2(e.target.value)}
                    className="mt-1 h-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-300">
                    Telefone 3 (Recado / Outro)
                  </Label>
                  <Input
                    placeholder="Ex: (11) 91234-5678"
                    value={phone3}
                    onChange={(e) => setPhone3(e.target.value)}
                    className="mt-1 h-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Busca Rápida por Endereço ou CEP com Google Maps Autocomplete */}
          <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-[#60A5FA] uppercase tracking-wider flex items-center gap-1.5 font-heading">
                <Search className="h-3.5 w-3.5 text-[#60A5FA]" />
                Buscar Endereço Inteligente (Google Maps / CEP)
              </Label>
              <span className="text-[10px] text-slate-400">Autocompleta enquanto você digita</span>
            </div>

            <BaseAddressAutocomplete
              value={addressSearchQuery}
              onChange={(val) => setAddressSearchQuery(val)}
              onAddressSelect={handleAddressSelect}
              placeholder="Comece a digitar o endereço ou CEP, ex: Av. Brasil, 1000..."
              className="w-full"
              inputClassName="h-9 bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus-visible:border-[#60A5FA] focus-visible:ring-[#60A5FA]/30"
              buttonClassName="h-9 bg-[#1E2B58] hover:bg-[#2A3B7A] text-slate-100 border-[#1E2B58]"
              dropdownClassName="border-[#1E2B58] bg-[#0E1738] divide-[#1E2B58]/60 text-white"
              biasCoordinates={lat && lng ? { lat, lng } : { lat: -22.906847, lng: -43.172896 }}
              showSearchButton={true}
            />

            {/* Link de WhatsApp / Maps */}
            <div className="flex gap-2 pt-1 border-t border-[#1E2B58]/60">
              <div className="relative flex-1">
                <Input
                  placeholder="Ou cole o link do Google Maps / WhatsApp recebido..."
                  value={locationLinkInput}
                  onChange={(e) => setLocationLinkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleParseLink()
                    }
                  }}
                  className="h-8 text-xs pl-8 bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                />
                <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleParseLink}
                disabled={!locationLinkInput.trim()}
                className="h-8 text-xs bg-[#1E2B58] text-[#60A5FA] hover:bg-[#2A3B7A] hover:text-white font-medium"
              >
                <Crosshair className="h-3 w-3 mr-1" /> Carregar Pin
              </Button>
            </div>
          </div>

          {/* Campos de Endereço Detalhados */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-8">
              <Label className="text-xs font-semibold text-slate-300">
                Rua e Número <span className="text-[#FF6B35]">*</span>
              </Label>
              <Input
                placeholder="Ex: Av. Paulista, 1000"
                value={streetAndNumber}
                onChange={(e) => setStreetAndNumber(e.target.value)}
                className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                required
              />
            </div>

            <div className="sm:col-span-4">
              <Label className="text-xs font-semibold text-slate-300">Complemento / Apto</Label>
              <Input
                placeholder="Ex: Sala 42, Bloco B"
                value={complement}
                onChange={(e) => setComplement(e.target.value)}
                className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
              />
            </div>

            <div className="sm:col-span-4">
              <Label className="text-xs font-semibold text-slate-300">Bairro</Label>
              <Input
                placeholder="Ex: Bela Vista"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
              />
            </div>

            <div className="sm:col-span-4">
              <Label className="text-xs font-semibold text-slate-300">Cidade</Label>
              <Input
                placeholder="Ex: Rio de Janeiro"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
              />
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs font-semibold text-slate-300">UF</Label>
              <Select value={ufState} onValueChange={setUfState}>
                <SelectTrigger className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white max-h-52">
                  {BRAZILIAN_STATES.map((uf) => (
                    <SelectItem key={uf} value={uf} className="focus:bg-[#0052CC] focus:text-white">
                      {uf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-300">CEP</Label>
                {isLoadingViaCep && <Loader2 className="h-3 w-3 animate-spin text-[#60A5FA]" />}
              </div>
              <Input
                placeholder="00000-000"
                value={postalCode}
                onChange={handleCepChange}
                maxLength={9}
                className="mt-1 h-9 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
              />
            </div>
          </div>

          {/* Endereço formatado preview */}
          {streetAndNumber && (
            <div className="flex items-center gap-1.5 p-2 rounded-lg bg-[#070D1E] border border-[#1E2B58] text-slate-300 text-[11px]">
              <Sparkles className="h-3.5 w-3.5 text-[#60A5FA] shrink-0" />
              <span className="truncate">
                Endereço formatado: <strong>{getFullFormattedAddress()}</strong>
              </span>
            </div>
          )}

          <DialogFooter className="pt-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm()
                onOpenChange(false)
              }}
              className="border-[#1E2B58] text-slate-300 hover:bg-[#1E2B58] hover:text-white text-xs h-9"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className={`${
                isEditMode ? 'bg-[#0052CC] hover:bg-[#003E99]' : 'bg-[#22C55E] hover:bg-[#1CA24D]'
              } text-white font-bold text-xs h-9 min-w-[140px] shadow-md`}
            >
              {isSubmitting
                ? 'Salvando...'
                : isEditMode
                  ? 'Salvar Alterações'
                  : 'Cadastrar Cliente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
