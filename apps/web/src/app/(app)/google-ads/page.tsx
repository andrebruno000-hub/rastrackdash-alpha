"use client";

import React, { useState, useEffect } from "react";
import {
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  Users,
  UserPlus,
  Phone,
  Power,
  Trash2,
  Search,
  KeyRound,
  TrendingUp,
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
  leadPhone: string;
  attendantName: string;
  keyword: string;
  campaign: string;
  adGroup: string;
  gclid: string;
  conversionType: "conversa_iniciada" | "orcamento_enviado" | "compra_realizada";
  status: "queued" | "sent" | "failed";
  occurredAt: string;
  sentAt?: string;
  value?: number;
}

export default function GoogleAdsPage() {
  const [currentTab, setCurrentTab] = useState<"leads" | "auditoria" | "roleta">("leads");

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
      { id: "2", name: "Sergio", phone: "5521994060206", active: true, leadsCount: 0 },
    ];
  });

  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // Leads e Eventos Reais em Tempo Real
  const [leadEvents, setLeadEvents] = useState<GoogleLeadEvent[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 4000);
    return () => clearInterval(interval);
  }, []);

  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterAttendant, setFilterAttendant] = useState("all");

  // Persistência local no navegador para atendentes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha_google_attendants", JSON.stringify(attendants));
    }
  }, [attendants]);

  const handleAddAttendant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPhone.trim()) return;
    const cleanPhone = newPhone.replace(/\D/g, "");
    setAttendants([
      ...attendants,
      {
        id: String(Date.now()),
        name: newName.trim(),
        phone: cleanPhone,
        active: true,
        leadsCount: 0,
      },
    ]);
    setNewName("");
    setNewPhone("");
  };

  const toggleAttendant = (id: string) => {
    setAttendants(
      attendants.map((a) => (a.id === id ? { ...a, active: !a.active } : a))
    );
  };

  const removeAttendant = (id: string) => {
    if (confirm("Deseja remover este atendente da roleta?")) {
      setAttendants(attendants.filter((a) => a.id !== id));
    }
  };

  // Contadores reais
  const totalSent = leadEvents.filter((e) => e.status === "sent").length;
  const totalQueued = leadEvents.filter((e) => e.status === "queued").length;
  const totalFailed = leadEvents.filter((e) => e.status === "failed").length;

  const filteredEvents = leadEvents.filter((event) => {
    const matchesKeyword =
      !filterKeyword ||
      event.keyword.toLowerCase().includes(filterKeyword.toLowerCase()) ||
      event.campaign.toLowerCase().includes(filterKeyword.toLowerCase()) ||
      event.leadPhone.includes(filterKeyword);
    const matchesAttendant =
      filterAttendant === "all" || event.attendantName === filterAttendant;
    return matchesKeyword && matchesAttendant;
  });

  return (
    <div className="gads-wrapper">
      <style>{`
        .gads-wrapper {
          padding: 16px;
          color: #e2e8f0;
          max-width: 1400px;
          margin: 0 auto;
          box-sizing: border-box;
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
          font-size: 19px;
          font-weight: 700;
          color: #ffffff;
          margin: 0;
          line-height: 1.3;
        }
        .gads-subtitle {
          color: #94a3b8;
          font-size: 13px;
          margin-top: 6px;
          line-height: 1.4;
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
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          flex-shrink: 0;
          transition: background 0.15s;
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
          letter-spacing: 0.5px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          line-height: 1.2;
        }
        .gads-metric-val {
          font-size: 24px;
          font-weight: 800;
          margin: 8px 0 2px 0;
        }
        .gads-metric-sub {
          color: #64748b;
          font-size: 11px;
          line-height: 1.2;
        }
        .gads-panel {
          background: #0b1329;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 24px;
        }
        .gads-filter-block {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 16px;
        }
        .gads-search-box {
          position: relative;
          width: 100%;
        }
        .gads-input-field {
          width: 100%;
          background: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 8px;
          padding: 8px 12px 8px 36px;
          color: #fff;
          font-size: 13px;
          box-sizing: border-box;
          outline: none;
        }
        .gads-input-field:focus {
          border-color: #2563eb;
        }
        .gads-select-field {
          width: 100%;
          background: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 8px;
          padding: 8px 12px;
          color: #fff;
          font-size: 13px;
          box-sizing: border-box;
          outline: none;
        }
        .gads-table-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border: 1px solid #1e293b;
          border-radius: 8px;
        }
        .gads-table {
          width: 100%;
          min-width: 650px;
          border-collapse: collapse;
          font-size: 13px;
        }
        .gads-form-row {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        /* Desktop Breakpoint */
        @media (min-width: 768px) {
          .gads-wrapper {
            padding: 24px;
          }
          .gads-header-block {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .gads-title {
            font-size: 22px;
          }
          .gads-metrics-grid {
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
          }
          .gads-metric-val {
            font-size: 30px;
          }
          .gads-filter-block {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .gads-search-box {
            width: 280px;
          }
          .gads-select-field {
            width: auto;
          }
          .gads-form-row {
            flex-direction: row;
          }
        }
      `}</style>

      {/* Cabeçalho Responsivo */}
      <div className="gads-header-block">
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <div className="gads-title-wrap">
              <span style={{ background: "#2563eb", borderRadius: "8px", padding: "6px", display: "inline-flex" }}>
                <Send size={20} color="#fff" />
              </span>
              <h1 className="gads-title">
                Google Ads & Roleta de WhatsApp
              </h1>
            </div>
            <button
              onClick={fetchLeads}
              disabled={isRefreshing}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#fff",
                borderRadius: "8px",
                padding: "6px 14px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <RefreshCw size={13} style={{ transform: isRefreshing ? "rotate(180deg)" : "none", transition: "transform 0.4s" }} />
              {isRefreshing ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
          <p className="gads-subtitle">
            Rastreamento de palavras-chave, atribuição de conversões offline (OCI) e divisão alternada de leads.
          </p>
        </div>

        {/* Abas com scroll suave no mobile */}
        <div className="gads-tabs-bar">
          <button
            onClick={() => setCurrentTab("leads")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "leads" ? "#2563eb" : "transparent",
              color: currentTab === "leads" ? "#fff" : "#94a3b8",
            }}
          >
            <Users size={15} /> Leads & Palavras-chave
          </button>
          <button
            onClick={() => setCurrentTab("auditoria")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "auditoria" ? "#2563eb" : "transparent",
              color: currentTab === "auditoria" ? "#fff" : "#94a3b8",
            }}
          >
            <TrendingUp size={15} /> Conversões Google OCI
          </button>
          <button
            onClick={() => setCurrentTab("roleta")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "roleta" ? "#2563eb" : "transparent",
              color: currentTab === "roleta" ? "#fff" : "#94a3b8",
            }}
          >
            <RefreshCw size={15} /> Roleta de Atendentes
          </button>
        </div>
      </div>

      {/* Cards de Métricas Reais */}
      <div className="gads-metrics-grid">
        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#94a3b8" }}>
            Total de Leads
          </span>
          <div className="gads-metric-val" style={{ color: "#ffffff" }}>
            {leadEvents.length}
          </div>
          <span className="gads-metric-sub">Cliques Roteados</span>
        </div>

        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#10b981" }}>
            Enviados ao Google <CheckCircle2 size={14} color="#10b981" />
          </span>
          <div className="gads-metric-val" style={{ color: "#10b981" }}>
            {totalSent}
          </div>
          <span className="gads-metric-sub">Aceitas na API v17</span>
        </div>

        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#38bdf8" }}>
            Fila Maturação <Clock size={14} color="#38bdf8" />
          </span>
          <div className="gads-metric-val" style={{ color: "#38bdf8" }}>
            {totalQueued}
          </div>
          <span className="gads-metric-sub">Espera anti-erro 4h</span>
        </div>

        <div className="gads-metric-card">
          <span className="gads-metric-title" style={{ color: "#f87171" }}>
            Falhas <AlertTriangle size={14} color="#f87171" />
          </span>
          <div className="gads-metric-val" style={{ color: "#f87171" }}>
            {totalFailed}
          </div>
          <span className="gads-metric-sub">Sem rejeições</span>
        </div>
      </div>

      {/* ABA 1: LEADS & PALAVRAS-CHAVE */}
      {currentTab === "leads" && (
        <div className="gads-panel">
          <div className="gads-filter-block">
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                Relatório de Origem de Leads (Google Ads)
              </h2>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                Termo de pesquisa exato que gerou a conversa e atendente que atendeu.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexDirection: "column", width: "100%", maxWidth: "500px" }}>
              <div className="gads-search-box">
                <Search size={15} color="#64748b" style={{ position: "absolute", left: "12px", top: "11px" }} />
                <input
                  type="text"
                  placeholder="Filtrar palavra-chave ou telefone..."
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
                <option value="all">Todos os Atendentes</option>
                {attendants.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
              <Users size={40} style={{ margin: "0 auto 12px auto", opacity: 0.3 }} />
              <p style={{ fontWeight: 600, color: "#94a3b8", margin: 0 }}>
                Nenhum lead registrado ainda
              </p>
              <p style={{ fontSize: "13px", marginTop: "4px" }}>
                Assim que um lead clicar no botão de WhatsApp da Landing Page, ele aparecerá aqui com a palavra-chave em tempo real.
              </p>
            </div>
          ) : (
            <div className="gads-table-scroll">
              <table className="gads-table">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px" }}>Data / Hora</th>
                    <th style={{ padding: "10px 12px" }}>Atendente</th>
                    <th style={{ padding: "10px 12px" }}>Palavra-chave</th>
                    <th style={{ padding: "10px 12px" }}>Campanha</th>
                    <th style={{ padding: "10px 12px" }}>Status Google</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id} style={{ borderBottom: "1px solid #0f172a" }}>
                      <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                        {new Date(event.occurredAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ color: "#ffffff", fontWeight: 600 }}>
                          {event.attendantName}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ color: "#38bdf8", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "5px" }}>
                          <KeyRound size={12} /> {event.keyword}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                        {event.campaign}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span
                          style={{
                            background: "rgba(56, 189, 248, 0.1)",
                            color: "#38bdf8",
                            padding: "3px 8px",
                            borderRadius: "12px",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          Fila Maturação (4h)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ABA 2: AUDITORIA OCI */}
      {currentTab === "auditoria" && (
        <div className="gads-panel">
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: "0 0 12px 0" }}>
            Auditoria de Conversões Offline (OCI API v17)
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "13px", lineHeight: "1.5" }}>
            O RastrackDash aguarda uma janela de maturação de 4 a 6 horas para cada clique antes de disparar para a API do Google Ads, garantindo que o <code>gclid</code> já esteja indexado nos servidores globais do Google e evitando o erro <code>CLICK_NOT_FOUND</code>.
          </p>
        </div>
      )}

      {/* ABA 3: ROLETA DE ATENDENTES */}
      {currentTab === "roleta" && (
        <div className="gads-panel">
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: "0 0 8px 0" }}>
            Gerenciamento da Roleta de Atendentes
          </h2>
          <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 16px 0" }}>
            Atendentes ativos recebem leads alternadamente em 50%/50%.
          </p>

          <form onSubmit={handleAddAttendant} style={{ marginBottom: "20px" }}>
            <div className="gads-form-row">
              <input
                type="text"
                placeholder="Nome (Ex: Carlos)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="gads-input-field"
                style={{ paddingLeft: "12px" }}
              />
              <input
                type="text"
                placeholder="WhatsApp (Ex: 5521999998888)"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="gads-input-field"
                style={{ paddingLeft: "12px" }}
              />
              <button
                type="submit"
                style={{
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  whiteSpace: "nowrap",
                }}
              >
                <UserPlus size={15} /> Adicionar Atendente
              </button>
            </div>
          </form>

          <div className="gads-table-scroll">
            <table className="gads-table">
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "10px 12px" }}>Atendente</th>
                  <th style={{ padding: "10px 12px" }}>WhatsApp</th>
                  <th style={{ padding: "10px 12px" }}>Status na Roleta</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {attendants.map((attendant) => (
                  <tr key={attendant.id} style={{ borderBottom: "1px solid #0f172a" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#fff" }}>
                      {attendant.name}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <Phone size={13} /> {attendant.phone}
                      </span>
                    </td>
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
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <Power size={11} /> {attendant.active ? "Ativo" : "Pausado"}
                      </button>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <button
                        onClick={() => removeAttendant(attendant.id)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                          padding: "6px",
                        }}
                        title="Remover atendente"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
