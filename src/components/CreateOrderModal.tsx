import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2, ShoppingBag, Truck } from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type { CustomerRecord, UserRecord, OrderPriority, OrderItem } from '@/types/delivery'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'

interface CreateOrderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerRecord[]
  couriers: UserRecord[]
  onOrderCreated: () => void
}

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  open,
  onOpenChange,
  customers,
  couriers,
  onOrderCreated,
}) => {
  const { user } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [customerId, setCustomerId] = useState<string>('')
  const [courierId, setCourierId] = useState<string>('unassigned')
  const [priority, setPriority] = useState<OrderPriority>('normal')
  const [notes, setNotes] = useState<string>('')
  const [items, setItems] = useState<OrderItem[]>([{ name: '', qty: 1, price: 0 }])

  // New Customer inline state if needed
  const [isAddingCustomer, setIsAddingCustomer] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')
  const [newCustAddress, setNewCustAddress] = useState('')

  const handleAddItem = () => {
    setItems([...items, { name: '', qty: 1, price: 0 }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length === 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof OrderItem, val: string | number) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: val }
    setItems(updated)
  }

  const totalPrice = items.reduce(
    (acc, item) => acc + (Number(item.price) || 0) * (Number(item.qty) || 1),
    0,
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    let finalCustomerId = customerId

    // If creating a new inline customer
    if (isAddingCustomer) {
      if (!newCustName.trim() || !newCustAddress.trim()) {
        toast.error('Preencha o nome e endereço do cliente.')
        return
      }
      try {
        const createdCustomer = await deliveryService.createCustomer({
          name: newCustName.trim(),
          phone: newCustPhone.trim() || '(11) 90000-0000',
          address: newCustAddress.trim(),
          lat: -23.55 + (Math.random() - 0.5) * 0.05,
          lng: -46.64 + (Math.random() - 0.5) * 0.05,
        })
        finalCustomerId = createdCustomer.id
      } catch (err) {
        console.error('Error creating customer:', err)
        toast.error('Erro ao cadastrar novo cliente.')
        return
      }
    }

    if (!finalCustomerId) {
      toast.error('Selecione ou cadastre um cliente.')
      return
    }

    const validItems = items.filter((i) => i.name.trim().length > 0)
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um item ao pedido.')
      return
    }

    setIsSubmitting(true)
    try {
      const randomSuffix = Math.floor(100 + Math.random() * 900)
      const trackingCode = `TRK-${new Date().getFullYear()}-${randomSuffix}`

      const now = new Date()
      const assignedCourier = courierId !== 'unassigned' ? courierId : undefined

      await deliveryService.createOrder({
        tracking_code: trackingCode,
        seller_id: user?.id,
        customer_id: finalCustomerId,
        courier_id: assignedCourier,
        status: assignedCourier ? 'in_transit' : 'pending',
        priority,
        items: validItems,
        total_price: totalPrice,
        notes,
        estimated_arrival: assignedCourier
          ? new Date(now.getTime() + 45 * 60 * 1000).toISOString()
          : undefined,
      })

      // Trigger automatic in-app notification
      await deliveryService.createNotification({
        title: 'Novo Pedido Registrado',
        message: `Pedido ${trackingCode} criado com sucesso. Valor: R$ ${totalPrice.toFixed(2)}`,
        type: 'order',
        read: false,
        user_id: user?.id,
      })

      toast.success(`Pedido ${trackingCode} registrado com sucesso!`)
      onOrderCreated()
      onOpenChange(false)

      // Reset form
      setCustomerId('')
      setCourierId('unassigned')
      setPriority('normal')
      setNotes('')
      setItems([{ name: '', qty: 1, price: 0 }])
      setIsAddingCustomer(false)
    } catch (err: unknown) {
      console.error('Error creating order:', err)
      const message = err instanceof Error ? err.message : 'Falha ao registrar venda'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <ShoppingBag className="h-5 w-5 text-blue-600" />
            Registrar Nova Venda & Entrega
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Customer Selection or Creation */}
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Dados do Cliente / Destino
              </Label>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setIsAddingCustomer(!isAddingCustomer)}
                className="h-auto p-0 text-xs text-blue-600"
              >
                {isAddingCustomer ? 'Selecionar Existente' : '+ Cadastrar Novo Cliente'}
              </Button>
            </div>

            {!isAddingCustomer ? (
              <div>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger className="w-full bg-white dark:bg-slate-800">
                    <SelectValue placeholder="Selecione um cliente cadastrado..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {c.address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Nome / Razão Social</Label>
                  <Input
                    placeholder="Ex: Mercado Central"
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    className="bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <Label className="text-xs">Telefone de Contato</Label>
                  <Input
                    placeholder="(11) 98888-7777"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="bg-white dark:bg-slate-800"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Endereço Completo com Número e Bairro</Label>
                  <Input
                    placeholder="Ex: Av. Brigadeiro Faria Lima, 1200 - Itaim Bibi, São Paulo - SP"
                    value={newCustAddress}
                    onChange={(e) => setNewCustAddress(e.target.value)}
                    className="bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Logistics: Courier Assignment & Priority */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold">Atribuir Entregador</Label>
              <Select value={courierId} onValueChange={setCourierId}>
                <SelectTrigger className="mt-1 bg-white dark:bg-slate-800">
                  <SelectValue placeholder="Selecione um entregador" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Sem entregador (Pendente)</SelectItem>
                  {couriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      🛵 {c.name} ({c.status === 'busy' ? 'Ocupado' : 'Disponível'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-semibold">Prioridade de Entrega</Label>
              <Select value={priority} onValueChange={(val) => setPriority(val as OrderPriority)}>
                <SelectTrigger className="mt-1 bg-white dark:bg-slate-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">🟢 Normal (Até 90 min)</SelectItem>
                  <SelectItem value="high">🟡 Alta (Até 60 min)</SelectItem>
                  <SelectItem value="urgent">🔴 Urgente (Até 30 min)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Items Table */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Itens do Pedido
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItem}
                className="h-7 text-xs flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar Item
              </Button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    placeholder="Descrição do produto / mercadoria"
                    value={item.name}
                    onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                    className="flex-1 text-xs"
                  />
                  <Input
                    type="number"
                    min="1"
                    placeholder="Qtd"
                    value={item.qty || ''}
                    onChange={(e) =>
                      handleItemChange(idx, 'qty', parseInt(e.target.value, 10) || 1)
                    }
                    className="w-16 text-xs text-center"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="R$ Unit"
                    value={item.price || ''}
                    onChange={(e) =>
                      handleItemChange(idx, 'price', parseFloat(e.target.value) || 0)
                    }
                    className="w-24 text-xs text-right"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveItem(idx)}
                    disabled={items.length === 1}
                    className="h-8 w-8 text-slate-400 hover:text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t text-sm font-bold text-slate-900 dark:text-white">
              Total Calculado: R$ {totalPrice.toFixed(2)}
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs font-semibold">Observações / Instruções de Entrega</Label>
            <Textarea
              placeholder="Ex: Entregar na recepção, solicitar comprovante assinado..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 text-xs resize-none"
              rows={2}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
            >
              {isSubmitting ? 'Registrando...' : 'Emitir Pedido & Iniciar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
