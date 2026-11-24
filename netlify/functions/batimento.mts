// Netlify Scheduled Function: batimento no Supabase a cada 4 horas, contra a pausa do plano Free.
// O agendamento do GitHub Actions é "melhor esforço": depois de mudar para a cada 4 horas, ele rodou uma vez só nas
// primeiras 13 horas (24/11/2026). O agendamento do Netlify é confiável e fica como fonte principal; o workflow
// manter-supabase.yml continua como reserva. Usa as mesmas variáveis do build (VITE_SUPABASE_URL e
// VITE_SUPABASE_PUBLISHABLE_KEY, que no Netlify valem também para funções). A chave publicável é pública por desenho.
// Só roda em deploys de produção publicados.
export default async () => {
  const bruta = process.env.VITE_SUPABASE_URL ?? '';
  const chave = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!bruta || !chave) {
    console.error('batimento: faltam VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY nas variáveis do Netlify (escopo Functions).');
    return new Response('sem configuração', { status: 500 });
  }
  const url = bruta.replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/batimento`, {
        method: 'POST',
        headers: { apikey: chave, 'content-type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(20_000),
      });
      const corpo = await r.text();
      if (r.ok) {
        console.log(`batimento: ok ${corpo}`);
        return new Response(corpo);
      }
      console.error(`batimento: HTTP ${r.status} ${corpo.slice(0, 200)} (tentativa ${tentativa})`);
    } catch (e) {
      console.error(`batimento: ${String(e)} (tentativa ${tentativa}; host sem resposta pode ser projeto pausado)`);
    }
    if (tentativa < 3) await new Promise((ok) => setTimeout(ok, 5_000));
  }
  return new Response('falhou', { status: 502 });
};

export const config = { schedule: '17 */4 * * *' };
