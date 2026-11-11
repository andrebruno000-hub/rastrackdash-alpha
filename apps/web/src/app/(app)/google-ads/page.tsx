"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Send,
  CheckCircle2,
  Clock,
  RefreshCw,
  Users,
  UserPlus,
  Phone,
  Power,
  Trash2,
  Search,
  KeyRound,
  TrendingUp,
  DollarSign,
  ArrowRight,
  ArrowLeft,
  MessageSquare,
  ShieldCheck,
  Award,
  CheckCheck,
  ExternalLink,
} from "lucide-react";

interface Attendant {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  leadsCount: number;
}

interface GoogleLeadEvent {
  id: string;
  leadName?: string;
  leadPhone: string;
  attendantName: string;
  keyword: string;
  campaign: string;
  adGroup: string;
  gclid: string;
  conversionType?: "conversa_iniciada" | "orcamento_enviado" | "compra_realizada";
  stage?: "conversa_iniciada" | "em_atendimento" | "orcamento_enviado" | "compra_realizada";
  status: "queued" | "sent" | "failed";
  occurredAt: string;
  firstMessageAt?: string;
  quotedAt?: string;
  purchasedAt?: string;
  value?: number;
  triggerPhrase?: string;
}

export default function GoogleAdsPage() {
  const [currentTab, setCurrentTab] = useState<"leads" | "funil" | "roleta" | "conversoes">("leads");

  // Roleta de Atendentes
  const [attendants, setAttendants] = useState<Attendant[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("alpha_google_attendants");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    return [
      { id: "1", name: "Josi", phone: "5521980659269", active: true, leadsCount: 0 },
      { id: "2", name: "Sérgio", phone: "5521994060206", active: true, leadsCount: 0 },
    ];
  });

  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // Base Real de Leads
  const [leadEvents, setLeadEvents] = useState<GoogleLeadEvent[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterAttendant, setFilterAttendant] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  const fetchLeads = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/google-ads/leads");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setLeadEvents(data);
        }
      }
    } catch (e) {
      console.error("Erro ao carregar leads:", e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha_google_attendants", JSON.stringify(attendants));
    }
  }, [attendants]);

  const updateLeadStage = async (id: string, newStage: GoogleLeadEvent["stage"], value?: number) => {
    setLeadEvents((prev) =>
      prev.map((l) => (l.id === id ? { ...l, stage: newStage, value: value !== undefined ? value : l.value } : l))
    );

    try {
      await fetch("/api/google-ads/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, stage: newStage, value }),
      });
    } catch (err) {
      console.error("Falha ao atualizar etapa do lead:", err);
    }
  };

  const totalLeads = leadEvents.length;
  const conversasIniciadas = leadEvents.filter((l) => (l.stage || "conversa_iniciada") === "conversa_iniciada").length;
  const emAtendimento = leadEvents.filter((l) => l.stage === "em_atendimento").length;
  const orcamentosEnviados = leadEvents.filter((l) => l.stage === "orcamento_enviado").length;
  const comprasRealizadas = leadEvents.filter((l) => l.stage === "compra_realizada").length;
  const faturamentoTotal = leadEvents
    .filter((l) => l.stage === "compra_realizada" && l.value)
    .reduce((acc, curr) => acc + (curr.value || 0), 0);

  const filteredEvents = useMemo(() => {
    return leadEvents.filter((event) => {
      const term = filterKeyword.toLowerCase().trim();
      const matchesSearch =
        !term ||
        (event.leadName && event.leadName.toLowerCase().includes(term)) ||
        event.leadPhone.includes(term) ||
        event.keyword.toLowerCase().includes(term) ||
        event.campaign.toLowerCase().includes(term) ||
        event.adGroup.toLowerCase().includes(term);

      const matchesAttendant = filterAttendant === "all" || event.attendantName === filterAttendant;
      const currentLeadStage = event.stage || "conversa_iniciada";
      const matchesStage = filterStage === "all" || currentLeadStage === filterStage;

      return matchesSearch && matchesAttendant && matchesStage;
    });
  }, [leadEvents, filterKeyword, filterAttendant, filterStage]);

  const josiStats = useMemo(() => {
    const list = leadEvents.filter((l) => l.attendantName.toLowerCase().includes("josi"));
    const quotes = list.filter((l) => l.stage === "orcamento_enviado" || l.stage === "compra_realizada").length;
    const sales = list.filter((l) => l.stage === "compra_realizada").length;
    return {
      total: list.length,
      percentage: totalLeads > 0 ? Math.round((list.length / totalLeads) * 100) : 50,
      quotes,
      sales,
    };
  }, [leadEvents, totalLeads]);

  const sergioStats = useMemo(() => {
    const list = leadEvents.filter((l) => l.attendantName.toLowerCase().includes("sergio") || l.attendantName.toLowerCase().includes("sérgio"));
    const quotes = list.filter((l) => l.stage === "orcamento_enviado" || l.stage === "compra_realizada").length;
    const sales = list.filter((l) => l.stage === "compra_realizada").length;
    return {
      total: list.length,
      percentage: totalLeads > 0 ? Math.round((list.length / totalLeads) * 100) : 50,
      quotes,
      sales,
    };
  }, [leadEvents, totalLeads]);

  const handleAddAttendant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;
    const clean = newPhone.replace(/\D/g, "");
    setAttendants([...attendants, { id: String(Date.now()), name: newName.trim(), phone: clean, active: true, leadsCount: 0 }]);
    setNewName("");
    setNewPhone("");
  };

  const toggleAttendant = (id: string) => {
    setAttendants(attendants.map((a) => (a.id === id ? { ...a, active: !a.active } : a)));
  };

  const removeAttendant = (id: string) => {
    if (confirm("Deseja desativar este atendente da roleta de WhatsApp?")) {
      setAttendants(attendants.filter((a) => a.id !== id));
    }
  };

  return (
    <div className="gads-wrapper">
      <style>{`
        .gads-wrapper {
          padding: 16px;
          color: #e2e8f0;
          max-width: 1440px;
          margin: 0 auto;
          box-sizing: border-box;
          font-family: inherit;
        }
        .gads-header-block {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 20px;
        }
        .gads-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .gads-title {
          font-size: 20px;
          font-weight: 700;
          color: #ffffff;
          margin: 0;
          line-height: 1.25;
        }
        .gads-subtitle {
          color: #94a3b8;
          font-size: 13px;
          margin-top: 4px;
        }
        .gads-badge-iso {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .gads-tabs-bar {
          background: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 10px;
          padding: 4px;
          display: flex;
          gap: 4px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .gads-tabs-bar::-webkit-scrollbar {
          display: none;
        }
        .gads-tab-btn {
          border: none;
          padding: 9px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          flex-shrink: 0;
          transition: all 0.15s ease-in-out;
        }
        .gads-metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }
        .gads-metric-card {
          background: #0b1329;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }
        .gads-metric-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .gads-metric-val {
          font-size: 24px;
          font-weight: 800;
          margin: 6px 0 2px;
          line-height: 1.1;
        }
        .gads-metric-sub {
          font-size: 11px;
          color: #64748b;
        }
        .gads-panel {
          background: #0b1329;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 16px;
        }
        .gads-filter-block {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 18px;
        }
        .gads-search-box {
          position: relative;
          width: 100%;
        }
        .gads-input-field {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 9px 12px 9px 36px;
          color: #fff;
          font-size: 13px;
          width: 100%;
          box-sizing: border-box;
        }
        .gads-select-field {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 9px 12px;
          color: #fff;
          font-size: 13px;
          width: 100%;
          box-sizing: border-box;
        }
        .gads-table-scroll {
          width: 100%;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .gads-table {
          width: 100%;
          min-width: 750px;
          border-collapse: collapse;
          font-size: 13px;
        }
        .kanban-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        .kanban-col {
          background: #090f20;
          border: 1px solid #1e293b;
          border-radius: 10px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          min-height: 400px;
        }
        .kanban-col-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 10px;
          border-bottom: 1px solid #1e293b;
          margin-bottom: 12px;
        }
        .kanban-col-title {
          font-size: 13px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .kanban-col-count {
          background: #1e293b;
          color: #fff;
          padding: 2px 7px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
        }
        .kanban-cards-wrap {
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 1;
        }
        .kanban-card {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 12px;
          transition: transform 0.15s, border-color 0.15s;
        }
        .kanban-card:hover {
          border-color: #3b82f6;
          transform: translateY(-2px);
        }

        @media (min-width: 768px) {
          .gads-wrapper {
            padding: 24px 32px;
          }
          .gads-header-block {
            flex-direction: row;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 24px;
          }
          .gads-title {
            font-size: 22px;
          }
          .gads-metrics-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 24px;
          }
          .gads-panel {
            padding: 24px;
          }
          .gads-filter-block {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .gads-search-box {
            width: 260px;
          }
          .gads-select-field {
            width: auto;
          }
          .kanban-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }
      `}</style>

      {/* CABEÇALHO */}
      <div className="gads-header-block">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div className="gads-title-wrap">
              <span style={{ background: "#2563eb", borderRadius: "8px", padding: "6px", display: "inline-flex" }}>
                <Send size={20} color="#fff" />
              </span>
              <h1 className="gads-title">Google Ads — Inteligência & Funil</h1>
            </div>
            <span className="gads-badge-iso">
              <ShieldCheck size={13} /> 100% Isolado da Meta Ads
            </span>
          </div>
          <p className="gads-subtitle">
            Atribuição precisa de palavras-chave, funil CRM por etapas, roleta justa de WhatsApp e auditoria de conversões.
          </p>
        </div>

        {/* NAVEGAÇÃO ENTRE AS 4 ABAS */}
        <div className="gads-tabs-bar">
          <button
            onClick={() => setCurrentTab("leads")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "leads" ? "#2563eb" : "transparent",
              color: currentTab === "leads" ? "#fff" : "#94a3b8",
            }}
          >
            <Users size={15} /> 1. Leads & Palavras-Chave
          </button>
          <button
            onClick={() => setCurrentTab("funil")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "funil" ? "#2563eb" : "transparent",
              color: currentTab === "funil" ? "#fff" : "#94a3b8",
            }}
          >
            <TrendingUp size={15} /> 2. Funil CRM (Kanban)
          </button>
          <button
            onClick={() => setCurrentTab("roleta")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "roleta" ? "#2563eb" : "transparent",
              color: currentTab === "roleta" ? "#fff" : "#94a3b8",
            }}
          >
            <RefreshCw size={15} /> 3. Roleta de Atendentes
          </button>
          <button
            onClick={() => setCurrentTab("conversoes")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "conversoes" ? "#2563eb" : "transparent",
              color: currentTab === "conversoes" ? "#fff" : "#94a3b8",
            }}
          >
            <CheckCheck size={15} /> 4. Regras & Auditoria de Frases
          </button>
        </div>
      </div>

      {/* CARDS DE MÉTRICAS GLOBAIS */}
      <div className="gads-metrics-grid">
        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#94a3b8" }}>
            Total de Leads <Users size={14} />
          </span>
          <div className="gads-metric-val" style={{ color: "#ffffff" }}>
            {totalLeads}
          </div>
          <span className="gads-metric-sub">Cliques reais Google Search</span>
        </div>

        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#38bdf8" }}>
            Conversas Iniciadas <MessageSquare size={14} color="#38bdf8" />
          </span>
          <div className="gads-metric-val" style={{ color: "#38bdf8" }}>
            {conversasIniciadas + emAtendimento}
          </div>
          <span className="gads-metric-sub">Mensagem enviada no WhatsApp</span>
        </div>

        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#a855f7" }}>
            Orçamentos Enviados <Award size={14} color="#a855f7" />
          </span>
          <div className="gads-metric-val" style={{ color: "#a855f7" }}>
            {orcamentosEnviados}
          </div>
          <span className="gads-metric-sub">Propostas comerciais ativas</span>
        </div>

        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#10b981" }}>
            Vendas / Faturamento <DollarSign size={14} color="#10b981" />
          </span>
          <div className="gads-metric-val" style={{ color: "#10b981" }}>
            {faturamentoTotal > 0
              ? `R$ ${faturamentoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
              : `${comprasRealizadas} Vendas`}
          </div>
          <span className="gads-metric-sub">Convertidos via Google Ads</span>
        </div>
      </div>

      {/* ABA 1: LEADS & PALAVRAS-CHAVE */}
      {currentTab === "leads" && (
        <div className="gads-panel">
          <div className="gads-filter-block">
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                Relatório de Leads & Atribuição Google Ads
              </h2>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                Identificação do contato do WhatsApp, termo de busca no Google, conjunto e atendente responsável.
              </p>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <div className="gads-search-box">
                <Search size={15} color="#64748b" style={{ position: "absolute", left: "12px", top: "11px" }} />
                <input
                  type="text"
                  placeholder="Buscar nome, telefone ou kw..."
                  value={filterKeyword}
                  onChange={(e) => setFilterKeyword(e.target.value)}
                  className="gads-input-field"
                />
              </div>

              <select
                value={filterAttendant}
                onChange={(e) => setFilterAttendant(e.target.value)}
                className="gads-select-field"
              >
                <option value="all">Todos Atendentes</option>
                <option value="Josi">Atendente: Josi</option>
                <option value="Sérgio">Atendente: Sérgio</option>
              </select>

              <select
                value={filterStage}
                onChange={(e) => setFilterStage(e.target.value)}
                className="gads-select-field"
              >
                <option value="all">Todas as Etapas</option>
                <option value="conversa_iniciada">Conversa Iniciada</option>
                <option value="em_atendimento">Em Atendimento</option>
                <option value="orcamento_enviado">Orçamento Enviado</option>
                <option value="compra_realizada">Compra Realizada</option>
              </select>

              <button
                onClick={fetchLeads}
                disabled={isRefreshing}
                style={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  color: "#fff",
                  borderRadius: "8px",
                  padding: "9px 12px",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <RefreshCw size={13} style={{ transform: isRefreshing ? "rotate(180deg)" : "none", transition: "transform 0.4s" }} />
              </button>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 16px", color: "#64748b" }}>
              <Users size={40} color="#334155" style={{ margin: "0 auto 10px", display: "block" }} />
              <strong style={{ display: "block", color: "#94a3b8", fontSize: "14px" }}>
                Nenhum lead encontrado com os filtros atuais
              </strong>
              <p style={{ maxWidth: "460px", margin: "6px auto 0", fontSize: "13px", lineHeight: "1.5" }}>
                Os cliques da Landing Page com anúncios do Google Ads entrarão aqui automaticamente com o nome e número do WhatsApp.
              </p>
            </div>
          ) : (
            <div className="gads-table-scroll">
              <table className="gads-table">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px" }}>Contato WhatsApp</th>
                    <th style={{ padding: "10px 12px" }}>Palavra-Chave (Google)</th>
                    <th style={{ padding: "10px 12px" }}>Campanha & Conjunto</th>
                    <th style={{ padding: "10px 12px" }}>Atendente</th>
                    <th style={{ padding: "10px 12px" }}>Etapa do Funil</th>
                    <th style={{ padding: "10px 12px" }}>GCLID / OCI</th>
                    <th style={{ padding: "10px 12px" }}>Data / Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => {
                    const stage = event.stage || "conversa_iniciada";
                    return (
                      <tr key={event.id} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: "6px" }}>
                            {event.leadName || "Lead em Identificação"}
                            {event.leadPhone && (
                              <a
                                href={`https://wa.me/${event.leadPhone}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: "#22c55e", display: "inline-flex" }}
                                title="Abrir conversa no WhatsApp"
                              >
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                          <small style={{ color: "#94a3b8" }}>{event.leadPhone || "Aguardando envio..."}</small>
                        </td>

                        <td style={{ padding: "10px 12px", color: "#38bdf8" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
                            <KeyRound size={13} /> {event.keyword || "Pesquisa Direta"}
                          </span>
                        </td>

                        <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>
                          <div><strong>{event.campaign || "Campanha Pesquisa"}</strong></div>
                          <small style={{ color: "#64748b" }}>{event.adGroup || "Geral"}</small>
                        </td>

                        <td style={{ padding: "10px 12px" }}>
                          <span
                            style={{
                              background: event.attendantName.includes("Josi") ? "rgba(236, 72, 153, 0.15)" : "rgba(59, 130, 246, 0.15)",
                              color: event.attendantName.includes("Josi") ? "#f472b6" : "#60a5fa",
                              border: "1px solid",
                              borderColor: event.attendantName.includes("Josi") ? "rgba(236, 72, 153, 0.3)" : "rgba(59, 130, 246, 0.3)",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: 600,
                            }}
                          >
                            {event.attendantName}
                          </span>
                        </td>

                        <td style={{ padding: "10px 12px" }}>
                          {stage === "conversa_iniciada" && (
                            <span style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              Conversa Iniciada
                            </span>
                          )}
                          {stage === "em_atendimento" && (
                            <span style={{ background: "rgba(234, 179, 8, 0.15)", color: "#facc15", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              Em Atendimento
                            </span>
                          )}
                          {stage === "orcamento_enviado" && (
                            <span style={{ background: "rgba(168, 85, 247, 0.15)", color: "#c084fc", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              Orçamento Enviado
                            </span>
                          )}
                          {stage === "compra_realizada" && (
                            <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              Compra: {event.value ? `R$ ${event.value.toLocaleString("pt-BR")}` : "Fechada"}
                            </span>
                          )}
                        </td>

                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px" }}>
                            <Clock size={12} /> Fila Maturação
                          </span>
                        </td>

                        <td style={{ padding: "10px 12px", color: "#64748b", whiteSpace: "nowrap" }}>
                          {event.occurredAt}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ABA 2: FUNIL CRM COMPLETO (KANBAN) */}
      {currentTab === "funil" && (
        <div>
          <div style={{ marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
              Funil de Clientes & Conversões Google Ads
            </h2>
            <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
              Acompanhe a jornada do cliente desde o clique na pesquisa até o fechamento da compra no WhatsApp.
            </p>
          </div>

          <div className="kanban-grid">
            {/* COLUNA 1 */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#38bdf8" }}>
                  <MessageSquare size={15} /> 1. Conversa Iniciada
                </span>
                <span className="kanban-col-count">{conversasIniciadas}</span>
              </div>
              <div className="kanban-cards-wrap">
                {leadEvents
                  .filter((l) => (l.stage || "conversa_iniciada") === "conversa_iniciada")
                  .map((lead) => (
                    <div key={lead.id} className="kanban-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <strong style={{ color: "#fff", fontSize: "13px" }}>
                          {lead.leadName || "Lead em Identificação"}
                        </strong>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{lead.attendantName}</span>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "4px" }}>
                        <Phone size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {lead.leadPhone || "Sem telefone"}
                      </div>
                      <div style={{ background: "#090f20", padding: "6px 8px", borderRadius: "6px", marginTop: "8px", fontSize: "11px", color: "#38bdf8" }}>
                        <KeyRound size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {lead.keyword || "Pesquisa Google"}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                        <button
                          onClick={() => updateLeadStage(lead.id, "em_atendimento")}
                          style={{
                            background: "#1e293b",
                            border: "1px solid #334155",
                            color: "#facc15",
                            borderRadius: "6px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          Atender <ArrowRight size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* COLUNA 2 */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#facc15" }}>
                  <Users size={15} /> 2. Em Atendimento
                </span>
                <span className="kanban-col-count">{emAtendimento}</span>
              </div>
              <div className="kanban-cards-wrap">
                {leadEvents
                  .filter((l) => l.stage === "em_atendimento")
                  .map((lead) => (
                    <div key={lead.id} className="kanban-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <strong style={{ color: "#fff", fontSize: "13px" }}>
                          {lead.leadName || "Lead"}
                        </strong>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{lead.attendantName}</span>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "4px" }}>
                        <Phone size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {lead.leadPhone}
                      </div>
                      <div style={{ background: "#090f20", padding: "6px 8px", borderRadius: "6px", marginTop: "8px", fontSize: "11px", color: "#38bdf8" }}>
                        {lead.keyword || "Pesquisa Google"}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
                        <button
                          onClick={() => updateLeadStage(lead.id, "conversa_iniciada")}
                          style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "11px", cursor: "pointer" }}
                        >
                          <ArrowLeft size={11} /> Voltar
                        </button>
                        <button
                          onClick={() => updateLeadStage(lead.id, "orcamento_enviado")}
                          style={{
                            background: "#1e293b",
                            border: "1px solid #334155",
                            color: "#c084fc",
                            borderRadius: "6px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          Orçar <ArrowRight size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* COLUNA 3 */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#c084fc" }}>
                  <Award size={15} /> 3. Orçamento Enviado
                </span>
                <span className="kanban-col-count">{orcamentosEnviados}</span>
              </div>
              <div className="kanban-cards-wrap">
                {leadEvents
                  .filter((l) => l.stage === "orcamento_enviado")
                  .map((lead) => (
                    <div key={lead.id} className="kanban-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <strong style={{ color: "#fff", fontSize: "13px" }}>
                          {lead.leadName || "Lead"}
                        </strong>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{lead.attendantName}</span>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "4px" }}>
                        <Phone size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {lead.leadPhone}
                      </div>
                      <div style={{ background: "#090f20", padding: "6px 8px", borderRadius: "6px", marginTop: "8px", fontSize: "11px", color: "#c084fc" }}>
                        Proposta enviada
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
                        <button
                          onClick={() => updateLeadStage(lead.id, "em_atendimento")}
                          style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "11px", cursor: "pointer" }}
                        >
                          <ArrowLeft size={11} />
                        </button>
                        <button
                          onClick={() => {
                            const valStr = prompt("Valor da Venda em R$:", "1200");
                            if (valStr !== null) {
                              const val = parseFloat(valStr.replace(",", "."));
                              updateLeadStage(lead.id, "compra_realizada", isNaN(val) ? 0 : val);
                            }
                          }}
                          style={{
                            background: "rgba(16, 185, 129, 0.2)",
                            border: "1px solid rgba(16, 185, 129, 0.4)",
                            color: "#34d399",
                            borderRadius: "6px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <DollarSign size={11} /> Fechar Venda
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* COLUNA 4 */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#34d399" }}>
                  <CheckCircle2 size={15} /> 4. Compra Realizada
                </span>
                <span className="kanban-col-count">{comprasRealizadas}</span>
              </div>
              <div className="kanban-cards-wrap">
                {leadEvents
                  .filter((l) => l.stage === "compra_realizada")
                  .map((lead) => (
                    <div key={lead.id} className="kanban-card" style={{ borderColor: "rgba(16, 185, 129, 0.4)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <strong style={{ color: "#fff", fontSize: "13px" }}>
                          {lead.leadName || "Cliente"}
                        </strong>
                        <span style={{ fontSize: "11px", color: "#34d399", fontWeight: 700 }}>
                          {lead.value ? `R$ ${lead.value.toLocaleString("pt-BR")}` : "Vendido"}
                        </span>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "4px" }}>
                        <Phone size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {lead.leadPhone}
                      </div>
                      <div style={{ background: "rgba(16, 185, 129, 0.1)", padding: "6px 8px", borderRadius: "6px", marginTop: "8px", fontSize: "11px", color: "#34d399" }}>
                        Conversão de Compra Registrada no Google Ads OCI
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: ROLETA DE ATENDENTES */}
      {currentTab === "roleta" && (
        <div className="gads-panel">
          <div style={{ marginBottom: "20px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
              Equilíbrio da Roleta & Desempenho dos Atendentes
            </h2>
            <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
              Divisão 50% / 50% entre Josi e Sérgio com métricas individuais de orçamentos e vendas geradas.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "24px" }}>
            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#fff", margin: 0 }}>Josi</h3>
                  <span style={{ color: "#64748b", fontSize: "12px" }}>5521980659269</span>
                </div>
                <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399", padding: "3px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 700 }}>
                  Ativa na Roleta
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginTop: "16px", textAlign: "center" }}>
                <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>Leads</span>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#fff" }}>{josiStats.total}</div>
                  <small style={{ color: "#38bdf8", fontSize: "11px" }}>{josiStats.percentage}%</small>
                </div>
                <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>Orçamentos</span>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#c084fc" }}>{josiStats.quotes}</div>
                </div>
                <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>Vendas</span>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399" }}>{josiStats.sales}</div>
                </div>
              </div>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#fff", margin: 0 }}>Sérgio</h3>
                  <span style={{ color: "#64748b", fontSize: "12px" }}>5521994060206</span>
                </div>
                <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399", padding: "3px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 700 }}>
                  Ativo na Roleta
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginTop: "16px", textAlign: "center" }}>
                <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>Leads</span>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#fff" }}>{sergioStats.total}</div>
                  <small style={{ color: "#38bdf8", fontSize: "11px" }}>{sergioStats.percentage}%</small>
                </div>
                <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>Orçamentos</span>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#c084fc" }}>{sergioStats.quotes}</div>
                </div>
                <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>Vendas</span>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399" }}>{sergioStats.sales}</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>
              <span>Josi ({josiStats.percentage}%)</span>
              <span>Distribuição Atual de Leads</span>
              <span>Sérgio ({sergioStats.percentage}%)</span>
            </div>
            <div style={{ width: "100%", height: "10px", background: "#1e293b", borderRadius: "5px", overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${josiStats.percentage}%`, background: "#ec4899", transition: "width 0.3s" }} />
              <div style={{ width: `${sergioStats.percentage}%`, background: "#3b82f6", transition: "width 0.3s" }} />
            </div>
          </div>

          <form onSubmit={handleAddAttendant} style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px", background: "#0f172a", padding: "14px", borderRadius: "10px", border: "1px solid #1e293b" }}>
            <input
              type="text"
              placeholder="Nome do atendente"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="gads-input-field"
              style={{ flex: 1, minWidth: "160px" }}
            />
            <input
              type="text"
              placeholder="WhatsApp com DDD (ex: 5521999998888)"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="gads-input-field"
              style={{ flex: 1, minWidth: "180px" }}
            />
            <button
              type="submit"
              style={{
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                padding: "10px 16px",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <UserPlus size={15} /> Adicionar
            </button>
          </form>

          <div className="gads-table-scroll">
            <table className="gads-table">
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "10px 12px" }}>Atendente</th>
                  <th style={{ padding: "10px 12px" }}>WhatsApp</th>
                  <th style={{ padding: "10px 12px" }}>Status</th>
                  <th style={{ padding: "10px 12px" }}>Leads Recebidos</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {attendants.map((attendant) => (
                  <tr key={attendant.id} style={{ borderBottom: "1px solid #0f172a" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#fff" }}>{attendant.name}</td>
                    <td style={{ padding: "10px 12px", color: "#94a3b8" }}>{attendant.phone}</td>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        onClick={() => toggleAttendant(attendant.id)}
                        style={{
                          background: attendant.active ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                          color: attendant.active ? "#10b981" : "#f87171",
                          border: "1px solid",
                          borderColor: attendant.active ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)",
                          padding: "4px 10px",
                          borderRadius: "20px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                      >
                        <Power size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {attendant.active ? "Ativo na Roleta" : "Pausado"}
                      </button>
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: "#fff" }}>
                      {leadEvents.filter((l) => l.attendantName.toLowerCase().includes(attendant.name.toLowerCase())).length} leads
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <button
                        onClick={() => removeAttendant(attendant.id)}
                        style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer" }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA 4: REGRAS DE CONVERSÃO & AUDITORIA DE FRASES */}
      {currentTab === "conversoes" && (
        <div className="gads-panel">
          <div style={{ marginBottom: "20px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
              Regras de Conversão & Auditoria de Frases do WhatsApp
            </h2>
            <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
              Verifique com 100% de certeza se o atendente utilizou as palavras-chave de conversão dentro da conversa.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px", marginBottom: "28px" }}>
            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#38bdf8", fontWeight: 700, fontSize: "13px" }}>
                <MessageSquare size={15} /> Regra 1: Conversa Iniciada
              </div>
              <p style={{ color: "#94a3b8", fontSize: "12px", margin: "8px 0" }}>
                Acionada quando o cliente clica no anúncio e envia a primeira mensagem com a tag invisível Unicode.
              </p>
              <div style={{ background: "#0f172a", padding: "6px 8px", borderRadius: "6px", fontSize: "11px", color: "#64748b" }}>
                Evento Google OCI: <strong style={{ color: "#e2e8f0" }}>WhatsApp - Conversa Iniciada</strong>
              </div>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#c084fc", fontWeight: 700, fontSize: "13px" }}>
                <Award size={15} /> Regra 2: Orçamento Enviado
              </div>
              <p style={{ color: "#94a3b8", fontSize: "12px", margin: "8px 0" }}>
                Acionada quando o atendente digita na conversa: <code style={{ color: "#e2e8f0" }}>"orçamento enviado"</code> ou <code style={{ color: "#e2e8f0" }}>"segue o orçamento"</code>.
              </p>
              <div style={{ background: "#0f172a", padding: "6px 8px", borderRadius: "6px", fontSize: "11px", color: "#64748b" }}>
                Evento Google OCI: <strong style={{ color: "#e2e8f0" }}>WhatsApp - Orçamento Enviado</strong>
              </div>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#34d399", fontWeight: 700, fontSize: "13px" }}>
                <CheckCircle2 size={15} /> Regra 3: Compra Realizada
              </div>
              <p style={{ color: "#94a3b8", fontSize: "12px", margin: "8px 0" }}>
                Acionada quando o atendente digita: <code style={{ color: "#e2e8f0" }}>"pedido fechado R$ 1500"</code> ou <code style={{ color: "#e2e8f0" }}>"compra realizada"</code>.
              </p>
              <div style={{ background: "#0f172a", padding: "6px 8px", borderRadius: "6px", fontSize: "11px", color: "#64748b" }}>
                Evento Google OCI: <strong style={{ color: "#e2e8f0" }}>WhatsApp - Compra Realizada</strong> (com valor monetário)
              </div>
            </div>
          </div>

          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "10px" }}>
            Auditoria de Disparos de Conversão Pelos Atendentes
          </h3>

          {leadEvents.filter((l) => l.stage === "orcamento_enviado" || l.stage === "compra_realizada").length === 0 ? (
            <div style={{ textAlign: "center", padding: "36px 16px", color: "#64748b", background: "#090f20", borderRadius: "10px" }}>
              <Clock size={32} color="#334155" style={{ margin: "0 auto 8px", display: "block" }} />
              <strong style={{ display: "block", color: "#94a3b8", fontSize: "13px" }}>
                Nenhuma frase gatilho acionada ainda
              </strong>
              <p style={{ fontSize: "12px", margin: "6px auto 0", maxWidth: "420px" }}>
                Quando a Josi ou o Sérgio responderem um cliente digitando as palavras-chave de conversão no WhatsApp, o registro auditado aparecerá aqui.
              </p>
            </div>
          ) : (
            <div className="gads-table-scroll">
              <table className="gads-table">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px" }}>Atendente</th>
                    <th style={{ padding: "10px 12px" }}>Cliente / Telefone</th>
                    <th style={{ padding: "10px 12px" }}>Conversão Acionada</th>
                    <th style={{ padding: "10px 12px" }}>Valor Registrado</th>
                    <th style={{ padding: "10px 12px" }}>Status Google OCI</th>
                    <th style={{ padding: "10px 12px" }}>Data / Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {leadEvents
                    .filter((l) => l.stage === "orcamento_enviado" || l.stage === "compra_realizada")
                    .map((item) => (
                      <tr key={item.id} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: "#fff" }}>
                          {item.attendantName}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                          {item.leadName || item.leadPhone}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {item.stage === "orcamento_enviado" ? (
                            <span style={{ color: "#c084fc", fontWeight: 600 }}>Orçamento Enviado</span>
                          ) : (
                            <span style={{ color: "#34d399", fontWeight: 600 }}>Compra Realizada</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#fff" }}>
                          {item.value ? `R$ ${item.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px" }}>
                            <CheckCircle2 size={12} /> Fila OCI Ativa
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#64748b" }}>
                          {item.purchasedAt || item.quotedAt || item.occurredAt}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
