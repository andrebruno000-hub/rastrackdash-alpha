"use client";

import React, { useState } from "react";
import { Send, CheckCircle2, Clock, AlertTriangle, RefreshCw, Eye, Users, UserPlus, Phone, Power, Trash2 } from "lucide-react";

export default function GoogleAdsPage() {
  const [currentSection, setCurrentSection] = useState<"auditoria" | "roleta">("auditoria");
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);

  const [attendants, setAttendants] = useState([
    { id: "1", name: "Sergio", phone: "5521999999999", active: true, leadsCount: 42 },
    { id: "2", name: "Jose", phone: "5521888888888", active: true, leadsCount: 41 },
  ]);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const handleAddAttendant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newPhone) return;
    const cleanPhone = newPhone.replace(/\D/g, "");
    setAttendants([
      ...attendants,
      { id: String(Date.now()), name: newName, phone: cleanPhone, active: true, leadsCount: 0 },
    ]);
    setNewName("");
    setNewPhone("");
  };

  const toggleAttendant = (id: string) => {
    setAttendants(attendants.map((a) => (a.id === id ? { ...a, active: !a.active } : a)));
  };

  const removeAttendant = (id: string) => {
    if (confirm("Deseja remover este atendente da roleta?")) {
      setAttendants(attendants.filter((a) => a.id !== id));
    }
  };

  const sampleEvents = [
    {
      id: "gconv_01",
      eventName: "WhatsApp - Conversa Iniciada",
      gclid: "Cj0KCQjwiOy1BhD2ARIsAEG_sample_lead_01",
      status: "sent",
      phone: "+55 (21) 98765-4321",
      attendant: "Sergio",
      trigger: "auto_lead (1ª mensagem)",
      occurredAt: "10/11/2026, 14:10",
      deliveredAt: "10/11/2026, 19:40",
      delayReason: "Maturação anti-CLICK_NOT_FOUND (5h 30m)",
    },
    {
      id: "gconv_02",
      eventName: "WhatsApp - Orçamento Enviado",
      gclid: "Cj0KCQjwiOy1BhD2ARIsAEG_sample_lead_02",
      status: "sent",
      phone: "+55 (21) 98111-2233",
      attendant: "Jose",
      trigger: "Palavra-chave: 'orcamento enviado'",
      occurredAt: "10/11/2026, 15:20",
      deliveredAt: "10/11/2026, 15:21",
      delayReason: "Disparo Imediato (clique já maturado)",
    },
  ];

  return (
    <div style={{ padding: "24px", color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
            <Send size={24} color="#3b82f6" /> Google Ads (Rede de Pesquisa & WhatsApp)
          </h1>
          <p style={{ color: "#94a3b8", marginTop: "4px" }}>
            Atribuição oficial de conversões offline (OCI) e distribuição alternada de leads (Roleta).
          </p>
        </div>

        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "4px", display: "flex", gap: "4px" }}>
          <button
            onClick={() => setCurrentSection("auditoria")}
            style={{
              background: currentSection === "auditoria" ? "#3b82f6" : "transparent",
              color: currentSection === "auditoria" ? "#fff" : "#94a3b8",
              border: "none",
              padding: "8px 16px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Auditoria de Conversões
          </button>
          <button
            onClick={() => setCurrentSection("roleta")}
            style={{
              background: currentSection === "roleta" ? "#3b82f6" : "transparent",
              color: currentSection === "roleta" ? "#fff" : "#94a3b8",
              border: "none",
              padding: "8px 16px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <Users size={16} /> Roleta de Atendentes
          </button>
        </div>
      </div>

      {currentSection === "auditoria" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "24px" }}>
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#10b981" }}>
                <span>ENVIADOS</span>
                <CheckCircle2 size={18} />
              </div>
              <strong style={{ fontSize: "28px", color: "#fff", display: "block", marginTop: "8px" }}>83</strong>
              <small style={{ color: "#64748b" }}>Recebidos com sucesso pelo Google</small>
            </div>

            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#38bdf8" }}>
                <span>NA FILA (MATURAÇÃO)</span>
                <Clock size={18} />
              </div>
              <strong style={{ fontSize: "28px", color: "#fff", display: "block", marginTop: "8px" }}>2</strong>
              <small style={{ color: "#64748b" }}>Retenção anti-CLICK_NOT_FOUND (5h)</small>
            </div>

            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#ef4444" }}>
                <span>FALHAS</span>
                <AlertTriangle size={18} />
              </div>
              <strong style={{ fontSize: "28px", color: "#fff", display: "block", marginTop: "8px" }}>0</strong>
              <small style={{ color: "#64748b" }}>Nenhuma rejeição de API</small>
            </div>
          </div>

          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", overflow: "hidden" }}>
            <div style={{ padding: "16px", borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>Eventos Transmitidos e Agendados</h2>
              <button
                onClick={() => alert("Reenviando lote para a API do Google...")}
                style={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  color: "#e2e8f0",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <RefreshCw size={14} /> Reenviar bloqueados
              </button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b", color: "#64748b" }}>
                  <th style={{ padding: "12px 16px" }}>EVENTO</th>
                  <th style={{ padding: "12px 16px" }}>LEAD & ATENDENTE</th>
                  <th style={{ padding: "12px 16px" }}>GATILHO / ORIGEM</th>
                  <th style={{ padding: "12px 16px" }}>STATUS</th>
                  <th style={{ padding: "12px 16px" }}>HORÁRIO</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {sampleEvents.map((evt) => (
                  <tr key={evt.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ padding: "12px 16px" }}>
                      <strong style={{ color: "#fff" }}>{evt.eventName}</strong>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span>{evt.phone}</span>
                      <small style={{ display: "block", color: "#38bdf8" }}>Atendente: {evt.attendant}</small>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#cbd5e1" }}>{evt.trigger}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          background: evt.status === "sent" ? "rgba(16, 185, 129, 0.15)" : "rgba(56, 189, 248, 0.15)",
                          color: evt.status === "sent" ? "#10b981" : "#38bdf8",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        {evt.status === "sent" ? "Enviado" : "Na Fila"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#94a3b8" }}>{evt.occurredAt}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button
                        onClick={() => setSelectedEvent(evt)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#38bdf8",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <Eye size={14} /> Inspecionar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "24px" }}>
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "20px" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#fff", marginBottom: "8px" }}>
              Atendentes da Roleta (Round-Robin)
            </h2>
            <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "20px" }}>
              Os cliques do botão de WhatsApp na Landing Page são divididos de forma 50%/50% alternada entre os atendentes ativos.
            </p>

            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e293b", color: "#64748b" }}>
                  <th style={{ padding: "12px 16px" }}>NOME</th>
                  <th style={{ padding: "12px 16px" }}>WHATSAPP</th>
                  <th style={{ padding: "12px 16px" }}>LEADS RECEBIDOS</th>
                  <th style={{ padding: "12px 16px" }}>STATUS</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {attendants.map((att) => (
                  <tr key={att.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#fff" }}>{att.name}</td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "#cbd5e1" }}>
                      +{att.phone}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#10b981", fontWeight: "bold" }}>
                      {att.leadsCount} leads
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          background: att.active ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                          color: att.active ? "#10b981" : "#ef4444",
                          padding: "4px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        {att.active ? "Ativo na Roleta" : "Pausado"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button
                        onClick={() => toggleAttendant(att.id)}
                        title={att.active ? "Pausar recebimento" : "Ativar na roleta"}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: att.active ? "#f59e0b" : "#10b981",
                          cursor: "pointer",
                          marginRight: "12px",
                        }}
                      >
                        <Power size={16} />
                      </button>
                      <button
                        onClick={() => removeAttendant(att.id)}
                        title="Remover atendente"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "20px", height: "fit-content" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
              <UserPlus size={18} color="#3b82f6" /> Cadastrar Atendente
            </h3>
            <form onSubmit={handleAddAttendant}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "13px", color: "#94a3b8", marginBottom: "4px" }}>
                  Nome do Atendente
                </label>
                <input
                  type="text"
                  placeholder="Ex: Sergio ou Jose"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#020617",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    color: "#fff",
                  }}
                />
              </div>

              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "13px", color: "#94a3b8", marginBottom: "4px" }}>
                  WhatsApp com DDD
                </label>
                <input
                  type="text"
                  placeholder="Ex: 5521999998888"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#020617",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    color: "#fff",
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: "100%",
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  padding: "10px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                <Phone size={16} /> Salvar na Roleta
              </button>
            </form>
          </div>
        </div>
      )}

      {selectedEvent && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "12px",
              width: "600px",
              maxWidth: "90%",
              padding: "24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "18px", color: "#fff" }}>Auditoria de Conversão Google Ads</h3>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: "18px" }}
              >
                ✕
              </button>
            </div>

            <div style={{ background: "#020617", padding: "16px", borderRadius: "8px", fontSize: "13px", fontFamily: "monospace" }}>
              <p><strong>Evento:</strong> {selectedEvent.eventName}</p>
              <p><strong>GCLID:</strong> {selectedEvent.gclid}</p>
              <p><strong>Atendente:</strong> {selectedEvent.attendant}</p>
              <p><strong>Telefone:</strong> {selectedEvent.phone}</p>
              <p><strong>Status:</strong> {selectedEvent.status === "sent" ? "Enviado com Sucesso" : "Na Fila (Maturação)"}</p>
              <p><strong>Motivo / Delay:</strong> {selectedEvent.delayReason}</p>
              <p><strong>Endpoint:</strong> POST /v17/customers/3228136878:uploadClickConversions</p>
            </div>

            <div style={{ marginTop: "16px", textAlign: "right" }}>
              <button
                onClick={() => setSelectedEvent(null)}
                style={{
                  background: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
