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
      { id: "1", name: "Sergio", phone: "5521999998888", active: true, leadsCount: 0 },
      { id: "2", name: "Jose", phone: "5521977776666", active: true, leadsCount: 0 },
    ];
  });

  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // Leads e Eventos Reais (Inicia zerado - sem dados fictícios)
  const [leadEvents, setLeadEvents] = useState<GoogleLeadEvent[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("alpha_google_lead_events");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {}
      }
    }
    return [];
  });

  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterAttendant, setFilterAttendant] = useState("all");

  // Persistência local no navegador
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha_google_attendants", JSON.stringify(attendants));
    }
  }, [attendants]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha_google_lead_events", JSON.stringify(leadEvents));
    }
  }, [leadEvents]);

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
    <div style={{ padding: "24px 32px", color: "#e2e8f0", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ background: "#2563eb", borderRadius: "8px", padding: "6px", display: "inline-flex" }}>
              <Send size={22} color="#fff" />
            </span>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
              Google Ads & Roleta de WhatsApp
            </h1>
          </div>
          <p style={{ color: "#94a3b8", fontSize: "14px", marginTop: "6px" }}>
            Rastreamento de palavras-chave, atribuição de conversões offline (OCI) e divisão alternada de leads.
          </p>
        </div>

        {/* Abas */}
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "10px", padding: "4px", display: "flex", gap: "4px" }}>
          <button
            onClick={() => setCurrentTab("leads")}
            style={{
              background: currentTab === "leads" ? "#2563eb" : "transparent",
              color: currentTab === "leads" ? "#fff" : "#94a3b8",
              border: "none",
              padding: "8px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Users size={15} /> Leads & Palavras-chave
          </button>
          <button
            onClick={() => setCurrentTab("auditoria")}
            style={{
              background: currentTab === "auditoria" ? "#2563eb" : "transparent",
              color: currentTab === "auditoria" ? "#fff" : "#94a3b8",
              border: "none",
              padding: "8px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <TrendingUp size={15} /> Conversões Google OCI
          </button>
          <button
            onClick={() => setCurrentTab("roleta")}
            style={{
              background: currentTab === "roleta" ? "#2563eb" : "transparent",
              color: currentTab === "roleta" ? "#fff" : "#94a3b8",
              border: "none",
              padding: "8px 16px",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RefreshCw size={15} /> Roleta de Atendentes
          </button>
        </div>
      </div>

      {/* Cards de Métricas Reais */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
        <div style={{ background: "#0b1329", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px 20px" }}>
          <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#94a3b8" }}>
            Total de Leads Recebidos
          </span>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#ffffff", marginTop: "8px" }}>
            {leadEvents.length}
          </div>
          <span style={{ fontSize: "12px", color: "#64748b" }}>Oriundos de anúncios de pesquisa</span>
        </div>

        <div style={{ background: "#0b1329", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#10b981" }}>
              Enviados ao Google Ads
            </span>
            <CheckCircle2 size={16} color="#10b981" />
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#10b981", marginTop: "8px" }}>
            {totalSent}
          </div>
          <span style={{ fontSize: "12px", color: "#64748b" }}>Conversões aceitas pela API</span>
        </div>

        <div style={{ background: "#0b1329", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#38bdf8" }}>
              Na Fila de Maturação
            </span>
            <Clock size={16} color="#38bdf8" />
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#38bdf8", marginTop: "8px" }}>
            {totalQueued}
          </div>
          <span style={{ fontSize: "12px", color: "#64748b" }}>Aguardando 4h anti-erro do Google</span>
        </div>

        <div style={{ background: "#0b1329", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.05em", color: "#f87171" }}>
              Falhas de Transmissão
            </span>
            <AlertTriangle size={16} color="#f87171" />
          </div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#f87171", marginTop: "8px" }}>
            {totalFailed}
          </div>
          <span style={{ fontSize: "12px", color: "#64748b" }}>Nenhuma rejeição registrada</span>
        </div>
      </div>

      {/* ABA 1: LEADS & PALAVRAS-CHAVE */}
      {currentTab === "leads" && (
        <div style={{ background: "#0b1329", border: "1px solid #1e293b", borderRadius: "12px", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                Relatório de Origem de Leads (Google Ads)
              </h2>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                Veja exatamente qual palavra-chave, campanha e conjunto trouxeram cada cliente e qual atendente recebeu.
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ position: "relative" }}>
                <Search size={15} color="#64748b" style={{ position: "absolute", left: "12px", top: "11px" }} />
                <input
                  type="text"
                  placeholder="Filtrar por palavra-chave ou telefone..."
                  value={filterKeyword}
                  onChange={(e) => setFilterKeyword(e.target.value)}
                  style={{
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: "8px",
                    padding: "8px 12px 8px 34px",
                    color: "#fff",
                    fontSize: "13px",
                    width: "280px",
                  }}
                />
              </div>

              <select
                value={filterAttendant}
                onChange={(e) => setFilterAttendant(e.target.value)}
                style={{
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  color: "#fff",
                  fontSize: "13px",
                }}
              >
                <option value="all">Todos os atendentes</option>
                {attendants.map((a) => (
                  <option key={a.id} value={a.name}>
                    Atendente: {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#64748b" }}>
              <Users size={40} color="#334155" style={{ margin: "0 auto 12px", display: "block" }} />
              <strong style={{ display: "block", color: "#94a3b8", fontSize: "15px" }}>
                Nenhum lead registrado ainda (Zero)
              </strong>
              <p style={{ maxWidth: "480px", margin: "8px auto 0", fontSize: "13px", lineHeight: "1.5" }}>
                Assim que os visitantes clicarem nos seus anúncios do Google e chamarem no WhatsApp, a palavra-chave pesquisada, o conjunto e o atendente que recebeu aparecerão aqui em tempo real.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "12px 14px" }}>Lead / Telefone</th>
                    <th style={{ padding: "12px 14px" }}>Palavra-Chave (Termo de Pesquisa)</th>
                    <th style={{ padding: "12px 14px" }}>Campanha & Conjunto</th>
                    <th style={{ padding: "12px 14px" }}>Atendente da Roleta</th>
                    <th style={{ padding: "12px 14px" }}>Status Google Ads</th>
                    <th style={{ padding: "12px 14px" }}>Data / Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <tr key={event.id} style={{ borderBottom: "1px solid #0f172a" }}>
                      <td style={{ padding: "12px 14px", fontWeight: 600, color: "#fff" }}>
                        {event.leadPhone}
                      </td>
                      <td style={{ padding: "12px 14px", color: "#38bdf8" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                          <KeyRound size={13} /> {event.keyword || "Pesquisa Direta"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", color: "#cbd5e1" }}>
                        <div><strong>{event.campaign || "Campanha Pesquisa"}</strong></div>
                        <small style={{ color: "#64748b" }}>{event.adGroup || "Geral"}</small>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{ background: "#1e293b", padding: "4px 8px", borderRadius: "6px", fontSize: "12px", color: "#e2e8f0" }}>
                          {event.attendantName}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        {event.status === "sent" && (
                          <span style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <CheckCircle2 size={14} /> Enviado
                          </span>
                        )}
                        {event.status === "queued" && (
                          <span style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <Clock size={14} /> Fila Maturação
                          </span>
                        )}
                        {event.status === "failed" && (
                          <span style={{ color: "#f87171", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <AlertTriangle size={14} /> Falha
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px", color: "#64748b" }}>
                        {event.occurredAt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ABA 2: AUDITORIA DE CONVERSÕES OCI */}
      {currentTab === "auditoria" && (
        <div style={{ background: "#0b1329", border: "1px solid #1e293b", borderRadius: "12px", padding: "20px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", marginBottom: "6px" }}>
            Transmissões Oficiais via Google Ads API (OCI)
          </h2>
          <p style={{ color: "#64748b", fontSize: "13px", marginBottom: "20px" }}>
            Histórico das 3 ações oficiais: WhatsApp - Conversa Iniciada, Orçamento Enviado e Compra Realizada.
          </p>

          <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
            <Clock size={36} color="#334155" style={{ margin: "0 auto 12px", display: "block" }} />
            <strong style={{ display: "block", color: "#94a3b8", fontSize: "14px" }}>
              Nenhuma conversão enviada ainda (Zero)
            </strong>
            <p style={{ fontSize: "13px", marginTop: "6px" }}>
              Assim que o lead enviar a 1ª mensagem com a tag do Google, o disparo para a API v17 aparecerá aqui com seu identificador de clique (GCLID).
            </p>
          </div>
        </div>
      )}

      {/* ABA 3: ROLETA DE ATENDENTES */}
      {currentTab === "roleta" && (
        <div style={{ background: "#0b1329", border: "1px solid #1e293b", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                Configuração da Roleta de Atendentes (50% / 50%)
              </h2>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                Os cliques da Landing Page alternam sequencialmente entre os atendentes ativos.
              </p>
            </div>
          </div>

          {/* Formulário de Cadastro */}
          <form onSubmit={handleAddAttendant} style={{ display: "flex", gap: "12px", marginBottom: "24px", background: "#0f172a", padding: "16px", borderRadius: "10px", border: "1px solid #1e293b" }}>
            <input
              type="text"
              placeholder="Nome do atendente (ex: Sergio)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{
                background: "#0b1329",
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "8px 12px",
                color: "#fff",
                fontSize: "13px",
                flex: 1,
              }}
            />
            <input
              type="text"
              placeholder="WhatsApp com DDD (ex: 5521999998888)"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              style={{
                background: "#0b1329",
                border: "1px solid #334155",
                borderRadius: "8px",
                padding: "8px 12px",
                color: "#fff",
                fontSize: "13px",
                flex: 1,
              }}
            />
            <button
              type="submit"
              style={{
                background: "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                padding: "8px 18px",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <UserPlus size={15} /> Adicionar Atendente
            </button>
          </form>

          {/* Tabela de Atendentes */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "12px 14px" }}>Atendente</th>
                <th style={{ padding: "12px 14px" }}>WhatsApp</th>
                <th style={{ padding: "12px 14px" }}>Status na Roleta</th>
                <th style={{ padding: "12px 14px" }}>Leads Recebidos</th>
                <th style={{ padding: "12px 14px", textAlign: "right" }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {attendants.map((attendant) => (
                <tr key={attendant.id} style={{ borderBottom: "1px solid #0f172a" }}>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "#fff" }}>
                    {attendant.name}
                  </td>
                  <td style={{ padding: "12px 14px", color: "#94a3b8" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <Phone size={13} /> {attendant.phone}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
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
                      <Power size={11} /> {attendant.active ? "Ativo na Roleta" : "Pausado (Férias/Folga)"}
                    </button>
                  </td>
                  <td style={{ padding: "12px 14px", fontWeight: 700, color: "#ffffff" }}>
                    {attendant.leadsCount} leads
                  </td>
                  <td style={{ padding: "12px 14px", textAlign: "right" }}>
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
      )}
    </div>
  );
}
