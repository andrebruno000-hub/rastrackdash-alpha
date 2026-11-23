import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Painel Executivo & Comparativo · RastrackDash",
  description: "Módulo exclusivo Alpha de análise executiva: Meta Ads vs Google Ads e Performance dos Atendentes.",
};

export default async function ExecutiveInsightsPage() {
  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Painel Executivo & Insights
        </h1>
        <p className="text-sm text-slate-500">
          Análise consolidada e simplificada de performance por canal de tráfego e atendimento (Josi vs. Sérgio).
        </p>
      </div>

      {/* Bloco 1: Comparativo de Canais (Meta Ads vs Google Ads) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="surface-panel p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Meta Ads (Anúncios & Criativos)</h2>
            <span className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">Tráfego Principal</span>
          </div>
          <div className="space-y-3 text-sm text-slate-600 divide-y divide-slate-100">
            <div className="flex justify-between pt-2">
              <span>Melhor Anúncio (Mais Vendas):</span>
              <span className="font-medium text-slate-900 text-right">Campanha Principal · Vídeo Oferta A</span>
            </div>
            <div className="flex justify-between pt-3">
              <span>Melhor Conjunto de Anúncios:</span>
              <span className="font-medium text-slate-900 text-right">Lookalike 1% Compradores</span>
            </div>
            <div className="flex justify-between pt-3">
              <span>ROAS Médio no Canal:</span>
              <span className="font-semibold text-emerald-600">12,61x</span>
            </div>
          </div>
        </div>

        <div className="surface-panel p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Google Ads vs. Meta Ads</h2>
            <span className="px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 rounded-full">Comparativo de Retorno</span>
          </div>
          <div className="space-y-3 text-sm text-slate-600 divide-y divide-slate-100">
            <div className="flex justify-between pt-2">
              <span>Canal com Maior Retorno (ROAS):</span>
              <span className="font-semibold text-blue-600 text-right">Meta Ads (12.6x vs 4.2x)</span>
            </div>
            <div className="flex justify-between pt-3">
              <span>Volume de Conversões (Meta):</span>
              <span className="font-medium text-slate-900">82 conversões</span>
            </div>
            <div className="flex justify-between pt-3">
              <span>Volume de Conversões (Google):</span>
              <span className="font-medium text-slate-900">24 conversões</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bloco 2: Performance dos Atendentes */}
      <div className="surface-panel p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">Performance dos Atendentes</h2>
          <span className="text-xs text-slate-400">Josi vs. Sérgio</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="p-5 rounded-lg bg-slate-50 border border-slate-200/60 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-base">Josi</h3>
              <span className="text-xs font-medium bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">WhatsApp Ativo</span>
            </div>
            <div className="space-y-2 text-sm text-slate-600 divide-y divide-slate-200/50">
              <div className="flex justify-between pt-1"><span>Leads Atendidos:</span> <strong className="text-slate-900">142</strong></div>
              <div className="flex justify-between pt-2"><span>Orçamentos Enviados:</span> <strong className="text-slate-900">68</strong></div>
              <div className="flex justify-between pt-2"><span>Vendas Fechadas:</span> <strong className="text-emerald-600">38</strong></div>
              <div className="flex justify-between pt-2"><span>Receita Gerada:</span> <strong className="text-slate-900">R$ 18.450,00</strong></div>
            </div>
          </div>

          <div className="p-5 rounded-lg bg-slate-50 border border-slate-200/60 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900 text-base">Sérgio</h3>
              <span className="text-xs font-medium bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">WhatsApp Ativo</span>
            </div>
            <div className="space-y-2 text-sm text-slate-600 divide-y divide-slate-200/50">
              <div className="flex justify-between pt-1"><span>Leads Atendidos:</span> <strong className="text-slate-900">118</strong></div>
              <div className="flex justify-between pt-2"><span>Orçamentos Enviados:</span> <strong className="text-slate-900">54</strong></div>
              <div className="flex justify-between pt-2"><span>Vendas Fechadas:</span> <strong className="text-emerald-600">29</strong></div>
              <div className="flex justify-between pt-2"><span>Receita Gerada:</span> <strong className="text-slate-900">R$ 14.120,00</strong></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
