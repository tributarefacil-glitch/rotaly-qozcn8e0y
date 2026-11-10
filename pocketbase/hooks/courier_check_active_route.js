// pocketbase/hooks/courier_check_active_route.js
//
// ARQUIVO SEM ROTAS — mantido apenas para permitir a remoção limpa do hook no pod.
//
// As rotas de verificação de rota ativa (/backend/v1/check-active-route e
// /backend/v1/courier/check-active-route) PASSARAM A VIVER em
// orders_prevent_overlapping_routes.js, com handler inline e autocontido.
//
// Este arquivo não registra nenhum routerAdd nem onRecord*, para não criar
// rota duplicada. Pode ser apagado numa próxima publicação.
