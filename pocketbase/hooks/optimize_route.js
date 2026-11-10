// pocketbase/hooks/optimize_route.js
//
// DESATIVADO EM 10/11/2026 — decisão do Diogo após auditoria.
//
// POR QUE FOI DESATIVADO:
// Esta rota calculava distância por LINHA RETA (haversine puro), não por malha viária.
// No lote real do Edson (10 paradas, Duque de Caxias) o teste mediu:
//   - linha reta aqui: 11,65 km
//   - distância viária real: 17,20 km
//   - erro: 32% de subestimação
//
// Consequências se alguém voltasse a usá-la:
//   1. Pagaria ao entregador 32% menos combustível do que ele realmente gastou.
//   2. Geraria sequência que não corresponde ao trajeto possível na rua.
//   3. Não considera retorno à base — a rota terminaria na última entrega.
//
// O otimizador correto é o do frontend: src/services/intelligentRoadRouter.ts
// (Google Directions com optimizeWaypoints + fallback KNN/2-Opt com matriz OSRM,
// considerando ida e volta à base). Basta usá-lo.
//
// Este arquivo permanece apenas como stub vazio para o deploy remover a rota do pod
// sem erro de "file not found". Pode ser apagado numa próxima publicação.
