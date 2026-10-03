# Relatório de Verificação Pós-Produção — Rotaly (v0.0.299)

Data da Auditoria: 03/10/2026  
Ambiente: Produção (https://www.rotaly.com.br)  
Versão Avaliada: v0.0.299 (evolução da v0.0.218)

---

## 1. Rastreio Público Ponta a Ponta

- **Status:** ✅ PASSOU
- **Pedidos Testados:**
  - `TRK-2026-69217208` (Cliente: AMANDA FERREIRA, Entregador: Marcos Barbosa)
  - `TRK-2026-77823457` (Cliente: Grazy Santos, Entregador: Marcos Barbosa)
- **Evidências:**
  - Requisições HTTP em `https://www.rotaly.com.br/track/TRK-2026-69217208` e `https://www.rotaly.com.br/track/TRK-2026-77823457` responderam com HTTP 200, renderizando o stepper de entrega e resumo de entrega concluída.
  - Endpoint de backend `/backend/v1/public-track/{tracking_code}/route` respondeu HTTP 200 em 0.95ms e 0.84ms.
  - Links gerados no hook `on_order_next_customer_alert.js` utilizam `APP_PUBLIC_URL` / `SITE_URL` apontando para `https://www.rotaly.com.br/track/...`.
  - API rule de `orders` (migração 0100) bloqueia consultas em lote sem autenticação: exige `tracking_code = @request.query.tracking_code`.

---

## 2. E-mails e Deduplicação

- **Status:** ✅ PASSOU
- **Evidências:**
  - Alerta de Combustível enviado em `2026-10-03 03:27:01Z`: `⛽ Alerta de Saldo de Combustível: GUILHERME DE PAIVA (R$ 24,93)` com status `sent`.
  - Destinatário confirmado na coleção `fuel_balance_alerts`: `admpimentaverde@gmail.com` (o `notifications_email` configurado na empresa Matriz).
  - Deduplicação em `on_order_next_customer_alert.js`:
    - Validação de transição de status (`isCompletedStatus && !wasAlreadyCompleted`).
    - Supressão de disparo para seller/admin quando cliente não possui e-mail cadastrado (evita reenvio em massa ocorrido no incidente do dia 02/10).
    - Tabela e índice único `idx_notification_dedup_key` em vigor.
  - Taxa de falha: ZERO e-mails falhos nos logs de produção.

---

## 3. Isolamento Multiempresa (RLS)

- **Status:** ✅ PASSOU
- **Evidências:**
  - Migração `0100_strict_multi_tenant_api_rules.js` aplicada em produção.
  - Coleções `orders`, `customers`, `rotas`, `entregas`, `base_addresses`, `colaboradores` e `membros` com cláusula de validação `@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true`.
  - Logs de requisições pós-publicação sem erros 403 (Forbidden). Consultas legítimas do frontend responderam HTTP 200.

---

## 4. Saúde Geral do Ambiente de Produção

- **Status:** ✅ PASSOU
- **Evidências:**
  - Erros 5xx: 0 ocorrências registradas pós-publicação.
  - Erros 400/404: Sem erros anômalos ou quebras de tela.
  - Realtime: Conexões `POST /api/realtime` responderam HTTP 204 com sucesso continuado.
  - Job Diário de Combustível: `daily_fuel_balance_check` ativo (`RUNNING`, cron `0 8 * * * UTC`).
