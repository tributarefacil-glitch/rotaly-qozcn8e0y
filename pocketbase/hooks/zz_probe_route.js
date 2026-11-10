// pocketbase/hooks/zz_probe_route.js
// TESTE TEMPORÁRIO — remover depois. Só confirma que uma rota nova em arquivo novo registra.
routerAdd('GET', '/backend/v1/zz-probe', (c) => {
  return c.json(200, { ok: true, probe: 'vivo' })
})
