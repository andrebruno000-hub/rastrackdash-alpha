"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award,
  Calendar,
  CheckCircle2,
  DollarSign,
  GripVertical,
  LayoutDashboard,
  Lock,
  LogOut,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

/**
 * PASSO M4: PORTAL EXCLUSIVO DO CLIENTE (/google-ads/acesso)
 * Caminho no GitHub: apps/web/src/app/google-ads/acesso/page.tsx
 *
 * - 100% isolado da Meta Ads (fora do grupo (app)/AppShell)
 * - Três abas comerciais e motivadoras: Visão Geral, Leads e Funil Kanban arrastável
 * - Zero exibição de palavras-chave, campanhas, custos, CPL, ROAS, prejuízo ou regras
 */

type ClientStage =
  | "clique_anuncio"
  | "conversa_iniciada"
  | "orcamento_enviado"
  | "compra_realizada";

type DatePreset =
  | "all"
  | "today"
  | "yesterday"
  | "day_before_yesterday"
  | "7d"
  | "14d"
  | "30d"
  | "this_month";

interface ClientSessionInfo {
  tenantSlug: string;
  clientName: string;
  routingMode: "single" | "roulette";
  userId?: string;
  username: string;
  displayName: string;
}

interface ClientLeadItem {
  id: string;
  leadName: string;
  leadPhone: string;
  attendantName: string;
  stage?: ClientStage;
  value: number;
  occurredAt: string;
  firstMessageAt?: string | null;
  quotedAt?: string | null;
  purchasedAt?: string | null;
  updatedAt?: string | null;
}

interface ClientMetaInfo {
  name: string;
  displayName: string;
  routingMode: "single" | "roulette";
  attendants: Array<{ id: string; name: string }>;
}

function toBrDateKey(input?: string | Date | null): string {
  if (!input) return "";
  const date = input instanceof Date ? input : new Date(input);
  if (isNaN(date.getTime())) {
    return typeof input === "string" && /^\d{4}-\d{2}-\d{2}/.test(input) ? input.slice(0, 10) : "";
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function formatBrDateTime(input?: string | null): string {
  if (!input) return "—";
  const date = new Date(input);
  if (isNaN(date.getTime())) return String(input);
  try {
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.day}/${map.month}/${map.year} ${map.hour}:${map.minute}`;
  } catch {
    return date.toLocaleString("pt-BR");
  }
}

function formatBrDateShort(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [, m, d] = dateKey.split("-");
  return `${d}/${m}`;
}

function getBrDateRangeForPreset(preset: DatePreset): { start: string; end: string } {
  if (preset === "all") return { start: "", end: "" };
  const todayKey = toBrDateKey(new Date());
  const [y, m, d] = todayKey.split("-").map(Number);
  const baseUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const shiftDays = (days: number) => {
    const dt = new Date(baseUtc.getTime() + days * 24 * 60 * 60 * 1000);
    return dt.toISOString().slice(0, 10);
  };

  if (preset === "today") return { start: todayKey, end: todayKey };
  if (preset === "yesterday") {
    const yest = shiftDays(-1);
    return { start: yest, end: yest };
  }
  if (preset === "day_before_yesterday") {
    const dby = shiftDays(-2);
    return { start: dby, end: dby };
  }
  if (preset === "7d") return { start: shiftDays(-6), end: todayKey };
  if (preset === "14d") return { start: shiftDays(-13), end: todayKey };
  if (preset === "30d") return { start: shiftDays(-29), end: todayKey };
  if (preset === "this_month") return { start: `${todayKey.slice(0, 7)}-01`, end: todayKey };
  return { start: "", end: "" };
}

function isWaitingWhatsApp(phone?: string): boolean {
  const p = String(phone || "").trim();
  return !p || /aguardando/i.test(p);
}

function getEffectiveStage(lead: ClientLeadItem): ClientStage {
  if (lead.stage === "compra_realizada") return "compra_realizada";
  if (lead.stage === "orcamento_enviado") return "orcamento_enviado";
  if (lead.stage === "clique_anuncio" || (!lead.firstMessageAt && isWaitingWhatsApp(lead.leadPhone))) {
    return "clique_anuncio";
  }
  return "conversa_iniciada";
}

function formatStageLabel(stage: ClientStage): string {
  if (stage === "clique_anuncio") return "1. Interesse no WhatsApp";
  if (stage === "conversa_iniciada") return "2. Conversa Iniciada";
  if (stage === "orcamento_enviado") return "3. Orçamento Enviado";
  return "4. Compra Realizada";
}

function formatCurrencyBr(val: number): string {
  return Number(val || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function GoogleAdsClientPortalPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [session, setSession] = useState<ClientSessionInfo | null>(null);

  // Estado do Login
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Estado do Portal Autenticado (apenas 3 abas)
  const [activeTab, setActiveTab] = useState<"overview" | "leads" | "funil">("overview");
  const [clientInfo, setClientInfo] = useState<ClientMetaInfo | null>(null);
  const [leads, setLeads] = useState<ClientLeadItem[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [portalFeedback, setPortalFeedback] = useState<string | null>(null);

  // Filtros de Visão Geral
  const [overviewPreset, setOverviewPreset] = useState<DatePreset>("all");
  const [overviewStartDate, setOverviewStartDate] = useState("");
  const [overviewEndDate, setOverviewEndDate] = useState("");

  // Filtros da Aba Leads
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<"all" | ClientStage>("all");
  const [attendantFilter, setAttendantFilter] = useState<string>("all");
  const [leadsPreset, setLeadsPreset] = useState<DatePreset>("all");
  const [leadsStartDate, setLeadsStartDate] = useState("");
  const [leadsEndDate, setLeadsEndDate] = useState("");

  // Drag & Drop e Modal de Valor de Venda no Kanban
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ClientStage | null>(null);
  const [saleModalLead, setSaleModalLead] = useState<ClientLeadItem | null>(null);
  const [saleValueInput, setSaleValueInput] = useState<string>("");
  const [isUpdatingLead, setIsUpdatingLead] = useState(false);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch("/api/google-ads/client-auth", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data?.authenticated && data?.session) {
          setSession(data.session);
        } else {
          setSession(null);
        }
      }
    } catch {
      setSession(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  const fetchPortalData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const res = await fetch("/api/google-ads/client-portal", { cache: "no-store" });
      if (res.status === 401) {
        setSession(null);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data?.client) setClientInfo(data.client);
        if (Array.isArray(data?.leads)) setLeads(data.leads);
      }
    } catch (err) {
      console.error("Erro ao carregar dados do portal:", err);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (!session) return;
    void fetchPortalData();
    const timer = setInterval(() => {
      if (!draggingLeadId && !saleModalLead) {
        void fetchPortalData();
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [session, fetchPortalData, draggingLeadId, saleModalLead]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/google-ads/client-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.authenticated && data?.session) {
        setSession(data.session);
        setLoginPassword("");
      } else {
        setLoginError(data?.error || "Login ou senha incorretos.");
      }
    } catch {
      setLoginError("Falha de conexão ao entrar. Tente novamente.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/google-ads/client-auth", { method: "DELETE" });
    } catch {}
    setSession(null);
    setClientInfo(null);
    setLeads([]);
  };

  const handleMoveLeadStage = async (
    leadId: string,
    targetStage: ClientStage,
    saleValue?: number
  ) => {
    setIsUpdatingLead(true);
    setLeads((prev) =>
      prev.map((item) =>
        item.id === leadId
          ? {
              ...item,
              stage: targetStage,
              value: saleValue !== undefined ? saleValue : item.value,
              firstMessageAt:
                targetStage !== "clique_anuncio" && !item.firstMessageAt
                  ? new Date().toISOString()
                  : item.firstMessageAt,
            }
          : item
      )
    );

    try {
      const res = await fetch("/api/google-ads/client-portal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: leadId,
          stage: targetStage,
          value: saleValue,
        }),
      });
      if (res.status === 401) {
        setSession(null);
        return;
      }
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.lead) {
          setLeads((prev) => prev.map((it) => (it.id === leadId ? data.lead : it)));
        }
        setPortalFeedback(
          targetStage === "compra_realizada"
            ? "Venda registrada com sucesso!"
            : `Atendimento atualizado para "${formatStageLabel(targetStage)}".`
        );
        setTimeout(() => setPortalFeedback(null), 2800);
      }
    } catch (err) {
      console.error("Erro ao atualizar etapa:", err);
    } finally {
      setIsUpdatingLead(false);
    }
  };

  const openCloseSaleModal = (lead: ClientLeadItem) => {
    setSaleModalLead(lead);
    setSaleValueInput(lead.value > 0 ? String(lead.value) : "");
  };

  const handleConfirmSaleModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saleModalLead) return;
    const normalized = saleValueInput.replace(",", ".").trim();
    const numericValue = normalized ? parseFloat(normalized) : 0;
    const finalVal = isNaN(numericValue) || numericValue < 0 ? 0 : numericValue;
    const targetId = saleModalLead.id;
    setSaleModalLead(null);
    await handleMoveLeadStage(targetId, "compra_realizada", finalVal);
  };

  const handleOverviewPresetChange = (preset: DatePreset) => {
    setOverviewPreset(preset);
    const range = getBrDateRangeForPreset(preset);
    setOverviewStartDate(range.start);
    setOverviewEndDate(range.end);
  };

  const handleLeadsPresetChange = (preset: DatePreset) => {
    setLeadsPreset(preset);
    const range = getBrDateRangeForPreset(preset);
    setLeadsStartDate(range.start);
    setLeadsEndDate(range.end);
  };

  // Dados filtrados para Visão Geral (100% comerciais e positivos)
  const overviewFilteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const dt = toBrDateKey(lead.occurredAt || lead.firstMessageAt);
      if (overviewStartDate && (!dt || dt < overviewStartDate)) return false;
      if (overviewEndDate && (!dt || dt > overviewEndDate)) return false;
      return true;
    });
  }, [leads, overviewStartDate, overviewEndDate]);

  const overviewStats = useMemo(() => {
    const totalInterests = overviewFilteredLeads.length;
    const realChats = overviewFilteredLeads.filter(
      (l) => getEffectiveStage(l) !== "clique_anuncio"
    ).length;
    const quotesCount = overviewFilteredLeads.filter((l) => {
      const st = getEffectiveStage(l);
      return st === "orcamento_enviado" || st === "compra_realizada";
    }).length;
    const salesLeads = overviewFilteredLeads.filter(
      (l) => getEffectiveStage(l) === "compra_realizada"
    );
    const salesCount = salesLeads.length;
    const totalRevenue = salesLeads.reduce((acc, cur) => acc + Number(cur.value || 0), 0);
    const avgTicket = salesCount > 0 ? totalRevenue / salesCount : 0;
    const chatRate = totalInterests > 0 ? Math.round((realChats / totalInterests) * 100) : 0;
    const quoteRate = realChats > 0 ? Math.round((quotesCount / realChats) * 100) : 0;
    const closeRate = quotesCount > 0 ? Math.round((salesCount / quotesCount) * 100) : 0;

    // Evolução diária (até 7 dias ativos mais recentes)
    const dayMap = new Map<
      string,
      { dateKey: string; label: string; interests: number; chats: number; sales: number }
    >();
    overviewFilteredLeads.forEach((l) => {
      const dk = toBrDateKey(l.occurredAt || l.firstMessageAt);
      if (!dk) return;
      if (!dayMap.has(dk)) {
        dayMap.set(dk, {
          dateKey: dk,
          label: formatBrDateShort(dk),
          interests: 0,
          chats: 0,
          sales: 0,
        });
      }
      const row = dayMap.get(dk)!;
      row.interests += 1;
      const st = getEffectiveStage(l);
      if (st !== "clique_anuncio") row.chats += 1;
      if (st === "compra_realizada") row.sales += 1;
    });
    const dailySeries = Array.from(dayMap.values())
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(-7);
    const maxDaily = Math.max(1, ...dailySeries.map((d) => d.interests));

    // Atendentes (apenas quando a empresa usa roleta)
    const attNames = Array.from(
      new Set(
        [
          ...(clientInfo?.attendants || []).map((a) => a.name),
          ...overviewFilteredLeads.map((l) => l.attendantName),
        ].filter(Boolean)
      )
    );
    const attendantsStats = attNames.map((name) => {
      const list = overviewFilteredLeads.filter(
        (l) => l.attendantName.toLowerCase() === name.toLowerCase()
      );
      const chats = list.filter((l) => getEffectiveStage(l) !== "clique_anuncio").length;
      const quotes = list.filter((l) => {
        const st = getEffectiveStage(l);
        return st === "orcamento_enviado" || st === "compra_realizada";
      }).length;
      const sales = list.filter((l) => getEffectiveStage(l) === "compra_realizada").length;
      return { name, total: list.length, chats, quotes, sales };
    });

    const recentAttendances = [
      ...overviewFilteredLeads.filter((l) => getEffectiveStage(l) !== "clique_anuncio"),
      ...overviewFilteredLeads.filter((l) => getEffectiveStage(l) === "clique_anuncio"),
    ].slice(0, 6);

    return {
      totalInterests,
      realChats,
      quotesCount,
      salesCount,
      totalRevenue,
      avgTicket,
      chatRate,
      quoteRate,
      closeRate,
      dailySeries,
      maxDaily,
      attendantsStats,
      recentAttendances,
    };
  }, [overviewFilteredLeads, clientInfo]);

  const attendantFilterOptions = useMemo(() => {
    const names = new Set<string>();
    (clientInfo?.attendants || []).forEach((a) => {
      if (a.name) names.add(a.name);
    });
    leads.forEach((l) => {
      if (l.attendantName) names.add(l.attendantName);
    });
    return Array.from(names);
  }, [clientInfo, leads]);

  const filteredLeadsList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      const dt = toBrDateKey(lead.occurredAt || lead.firstMessageAt);
      if (leadsStartDate && (!dt || dt < leadsStartDate)) return false;
      if (leadsEndDate && (!dt || dt > leadsEndDate)) return false;
      if (stageFilter !== "all" && getEffectiveStage(lead) !== stageFilter) return false;
      if (attendantFilter !== "all" && lead.attendantName !== attendantFilter) return false;
      if (q) {
        const matchName = String(lead.leadName || "").toLowerCase().includes(q);
        const matchPhone = String(lead.leadPhone || "").toLowerCase().includes(q);
        if (!matchName && !matchPhone) return false;
      }
      return true;
    });
  }, [leads, leadsStartDate, leadsEndDate, stageFilter, attendantFilter, searchQuery]);

  const kanbanColumns: Array<{
    id: ClientStage;
    title: string;
    subtitle: string;
    accent: string;
    badgeBg: string;
  }> = [
    {
      id: "clique_anuncio",
      title: "1. Interesse no WhatsApp",
      subtitle: "Clicaram no botão de contato",
      accent: "#facc15",
      badgeBg: "rgba(250, 204, 21, 0.14)",
    },
    {
      id: "conversa_iniciada",
      title: "2. Conversa Iniciada",
      subtitle: "Em atendimento no WhatsApp",
      accent: "#38bdf8",
      badgeBg: "rgba(56, 189, 248, 0.14)",
    },
    {
      id: "orcamento_enviado",
      title: "3. Orçamento Enviado",
      subtitle: "Proposta apresentada",
      accent: "#c084fc",
      badgeBg: "rgba(192, 132, 252, 0.14)",
    },
    {
      id: "compra_realizada",
      title: "4. Venda Fechada",
      subtitle: "Negócio concluído",
      accent: "#34d399",
      badgeBg: "rgba(52, 211, 153, 0.14)",
    },
  ];

  // Loading inicial de sessão
  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#060b18",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "#94a3b8" }}>
          <RefreshCw size={18} /> Verificando seu acesso...
        </div>
      </div>
    );
  }

  // Tela de Login do Cliente
  if (!session) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "radial-gradient(circle at top right, #0f1f44 0%, #060b18 55%)",
          color: "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "420px",
            background: "#0b1329",
            border: "1px solid #1e293b",
            borderRadius: "16px",
            padding: "28px 24px",
            boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
            <span
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #2563eb, #0ea5e9)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <TrendingUp size={20} color="#fff" />
            </span>
            <div>
              <h1 style={{ margin: 0, fontSize: "19px", fontWeight: 800, color: "#fff" }}>
                Portal de Atendimentos
              </h1>
              <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
                Acompanhamento Comercial &amp; Funil de Vendas
              </p>
            </div>
          </div>

          <p style={{ fontSize: "13px", color: "#94a3b8", lineHeight: 1.5, margin: "14px 0 20px" }}>
            Entre com o usuário e senha fornecidos pelo seu gestor para acompanhar seus contatos e gerenciar seu funil comercial.
          </p>

          <form onSubmit={handleLoginSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#cbd5e1", marginBottom: "6px" }}>
                Login ou E-mail
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="Digite seu usuário"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#060b18",
                  border: "1px solid #334155",
                  borderRadius: "9px",
                  padding: "11px 13px",
                  color: "#fff",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#cbd5e1", marginBottom: "6px" }}>
                Senha
              </label>
              <input
                type="password"
                required
                placeholder="Digite sua senha"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#060b18",
                  border: "1px solid #334155",
                  borderRadius: "9px",
                  padding: "11px 13px",
                  color: "#fff",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
            </div>

            {loginError && (
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.14)",
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  color: "#fca5a5",
                  borderRadius: "8px",
                  padding: "9px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              style={{
                background: "linear-gradient(135deg, #2563eb, #1d4ed8)",
                color: "#fff",
                border: "none",
                borderRadius: "9px",
                padding: "12px 16px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginTop: "4px",
              }}
            >
              <Lock size={15} /> {isLoggingIn ? "Entrando..." : "Acessar Meu Painel"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const showRouletteAttendants = (clientInfo?.routingMode || session.routingMode) === "roulette";

  return (
    <div className="cp-shell">
      <style>{`
        .cp-shell {
          min-height: 100vh;
          background: #060b18;
          color: #e2e8f0;
          padding: 18px 14px 48px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-sizing: border-box;
        }
        .cp-container {
          max-width: 1360px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .cp-topbar {
          background: #0b1329;
          border: 1px solid #1e293b;
          border-radius: 14px;
          padding: 16px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }
        .cp-tabs {
          background: #0b1329;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 5px;
          display: flex;
          gap: 6px;
          overflow-x: auto;
        }
        .cp-tab-btn {
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
          transition: all 0.15s ease;
        }
        .cp-panel {
          background: #0b1329;
          border: 1px solid #1e293b;
          border-radius: 14px;
          padding: 18px;
        }
        .cp-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .cp-kpi-card {
          background: #0b1329;
          border: 1px solid #1e293b;
          border-radius: 14px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 6px;
        }
        .cp-preset-btn {
          background: #0f172a;
          border: 1px solid #1e293b;
          color: #94a3b8;
          border-radius: 7px;
          padding: 6px 11px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .cp-preset-btn.active {
          background: #2563eb;
          border-color: #2563eb;
          color: #fff;
        }
        .cp-input {
          background: #060b18;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 9px 12px;
          color: #fff;
          font-size: 13px;
          box-sizing: border-box;
        }
        .cp-table-wrap {
          width: 100%;
          overflow-x: auto;
        }
        .cp-table {
          width: 100%;
          min-width: 680px;
          border-collapse: collapse;
          font-size: 13px;
        }
        .cp-kanban-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        .cp-kanban-col {
          background: #090f20;
          border: 1px solid #1e293b;
          border-radius: 12px;
          padding: 12px;
          min-height: 420px;
          display: flex;
          flex-direction: column;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .cp-kanban-col.drag-over {
          border-color: #38bdf8;
          background: rgba(56, 189, 248, 0.06);
        }
        .cp-kanban-card {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 12px;
          cursor: grab;
          transition: transform 0.12s ease, border-color 0.12s ease;
        }
        .cp-kanban-card:hover {
          border-color: #3b82f6;
          transform: translateY(-1px);
        }
        @media (min-width: 768px) {
          .cp-shell { padding: 24px 28px 60px; }
          .cp-kpi-grid { grid-template-columns: repeat(4, 1fr); gap: 16px; }
          .cp-panel { padding: 22px; }
          .cp-kanban-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 1200px) {
          .cp-kanban-grid { grid-template-columns: repeat(4, 1fr); }
        }
      `}</style>

      <div className="cp-container">
        {/* TOPO LIMPO COM MARCA DA EMPRESA DO CLIENTE */}
        <header className="cp-topbar">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "9px",
                  background: "linear-gradient(135deg, #2563eb, #0ea5e9)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Sparkles size={17} color="#fff" />
              </span>
              <div>
                <h1 style={{ margin: 0, fontSize: "19px", fontWeight: 800, color: "#fff" }}>
                  {clientInfo?.name || session.clientName}
                </h1>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                  Painel Comercial de Contatos &amp; Vendas • Olá,{" "}
                  <strong style={{ color: "#e2e8f0" }}>{session.displayName}</strong>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void fetchPortalData()}
              disabled={isLoadingData}
              style={{
                background: "#0f172a",
                border: "1px solid #334155",
                color: "#cbd5e1",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <RefreshCw size={13} /> {isLoadingData ? "Atualizando..." : "Atualizar"}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              style={{
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#fca5a5",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <LogOut size={13} /> Sair
            </button>
          </div>
        </header>

        {/* NAVEGAÇÃO DE 3 ABAS EXCLUSIVAS */}
        <nav className="cp-tabs">
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            className="cp-tab-btn"
            style={{
              background: activeTab === "overview" ? "#2563eb" : "transparent",
              color: activeTab === "overview" ? "#fff" : "#94a3b8",
            }}
          >
            <LayoutDashboard size={15} /> Visão Geral
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("leads")}
            className="cp-tab-btn"
            style={{
              background: activeTab === "leads" ? "#2563eb" : "transparent",
              color: activeTab === "leads" ? "#fff" : "#94a3b8",
            }}
          >
            <Users size={15} /> Leads ({leads.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("funil")}
            className="cp-tab-btn"
            style={{
              background: activeTab === "funil" ? "#059669" : "transparent",
              color: activeTab === "funil" ? "#fff" : "#34d399",
            }}
          >
            <TrendingUp size={15} /> Funil Kanban
          </button>
        </nav>

        {portalFeedback && (
          <div
            style={{
              background: "rgba(16, 185, 129, 0.14)",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              color: "#6ee7b7",
              borderRadius: "10px",
              padding: "10px 14px",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            {portalFeedback}
          </div>
        )}

        {/* =========================================================
            ABA 1: VISÃO GERAL COMERCIAL (MOTIVADORA & LIMPA)
           ========================================================= */}
        {activeTab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div className="cp-panel" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#fff" }}>
                    Resumo dos seus Atendimentos
                  </h2>
                  <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                    Acompanhe a entrada de clientes no WhatsApp, orçamentos e vendas fechadas em horário de Brasília.
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <Calendar size={14} color="#64748b" />
                  <input
                    type="date"
                    value={overviewStartDate}
                    onChange={(e) => {
                      setOverviewPreset("all");
                      setOverviewStartDate(e.target.value);
                    }}
                    className="cp-input"
                    style={{ padding: "6px 10px", fontSize: "12px" }}
                  />
                  <span style={{ fontSize: "12px", color: "#64748b" }}>até</span>
                  <input
                    type="date"
                    value={overviewEndDate}
                    onChange={(e) => {
                      setOverviewPreset("all");
                      setOverviewEndDate(e.target.value);
                    }}
                    className="cp-input"
                    style={{ padding: "6px 10px", fontSize: "12px" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {(
                  [
                    { id: "all", label: "Todo o Período" },
                    { id: "today", label: "Hoje" },
                    { id: "yesterday", label: "Ontem" },
                    { id: "day_before_yesterday", label: "Anteontem" },
                    { id: "7d", label: "Últimos 7 dias" },
                    { id: "14d", label: "Últimos 14 dias" },
                    { id: "30d", label: "Últimos 30 dias" },
                    { id: "this_month", label: "Este Mês" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleOverviewPresetChange(p.id)}
                    className={`cp-preset-btn ${overviewPreset === p.id ? "active" : ""}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4 KPIs POSITIVOS E COMERCIAIS */}
            <div className="cp-kpi-grid">
              <div className="cp-kpi-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", fontWeight: 700, color: "#facc15", textTransform: "uppercase" }}>
                  <span>Interesses no WhatsApp</span>
                  <Users size={15} color="#facc15" />
                </div>
                <div style={{ fontSize: "28px", fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                  {overviewStats.totalInterests}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                  Contatos que clicaram para falar com você
                </div>
              </div>

              <div className="cp-kpi-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase" }}>
                  <span>Conversas Iniciadas</span>
                  <MessageSquare size={15} color="#38bdf8" />
                </div>
                <div style={{ fontSize: "28px", fontWeight: 800, color: "#38bdf8", fontVariantNumeric: "tabular-nums" }}>
                  {overviewStats.realChats}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                  {overviewStats.chatRate}% iniciaram conversa real
                </div>
              </div>

              <div className="cp-kpi-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", fontWeight: 700, color: "#c084fc", textTransform: "uppercase" }}>
                  <span>Orçamentos Enviados</span>
                  <Award size={15} color="#c084fc" />
                </div>
                <div style={{ fontSize: "28px", fontWeight: 800, color: "#c084fc", fontVariantNumeric: "tabular-nums" }}>
                  {overviewStats.quotesCount}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                  {overviewStats.quoteRate}% das conversas receberam proposta
                </div>
              </div>

              <div className="cp-kpi-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", fontWeight: 700, color: "#34d399", textTransform: "uppercase" }}>
                  <span>Vendas &amp; Faturamento</span>
                  <DollarSign size={15} color="#34d399" />
                </div>
                <div style={{ fontSize: "26px", fontWeight: 800, color: "#34d399", fontVariantNumeric: "tabular-nums" }}>
                  {overviewStats.totalRevenue > 0
                    ? `R$ ${formatCurrencyBr(overviewStats.totalRevenue)}`
                    : `${overviewStats.salesCount} venda(s)`}
                </div>
                <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                  {overviewStats.salesCount} fechada(s)
                  {overviewStats.avgTicket > 0 ? ` • Ticket R$ ${formatCurrencyBr(overviewStats.avgTicket)}` : ""}
                </div>
              </div>
            </div>

            {overviewStats.totalInterests === 0 ? (
              <div className="cp-panel" style={{ textAlign: "center", padding: "38px 20px" }}>
                <Sparkles size={28} color="#38bdf8" style={{ margin: "0 auto 10px", display: "block" }} />
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#fff" }}>
                  Tudo pronto para receber seus novos clientes!
                </h3>
                <p style={{ margin: "8px auto 0", maxWidth: "480px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.5 }}>
                  Assim que os interessados clicarem no WhatsApp e iniciarem conversa com sua equipe, os atendimentos aparecerão aqui e no seu Funil Kanban em tempo real.
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
                {/* FUNIL COMERCIAL */}
                <div className="cp-panel">
                  <h3 style={{ margin: "0 0 14px", fontSize: "15px", fontWeight: 700, color: "#fff" }}>
                    Funil Comercial do Período
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {[
                      {
                        label: "1. Interesse no WhatsApp",
                        val: overviewStats.totalInterests,
                        pct: 100,
                        color: "#facc15",
                        note: "Base total de interessados",
                      },
                      {
                        label: "2. Conversas Iniciadas",
                        val: overviewStats.realChats,
                        pct: overviewStats.totalInterests > 0 ? Math.round((overviewStats.realChats / overviewStats.totalInterests) * 100) : 0,
                        color: "#38bdf8",
                        note: `${overviewStats.chatRate}% dos cliques`,
                      },
                      {
                        label: "3. Orçamentos Enviados",
                        val: overviewStats.quotesCount,
                        pct: overviewStats.totalInterests > 0 ? Math.round((overviewStats.quotesCount / overviewStats.totalInterests) * 100) : 0,
                        color: "#c084fc",
                        note: `${overviewStats.quoteRate}% das conversas`,
                      },
                      {
                        label: "4. Vendas Fechadas",
                        val: overviewStats.salesCount,
                        pct: overviewStats.totalInterests > 0 ? Math.round((overviewStats.salesCount / overviewStats.totalInterests) * 100) : 0,
                        color: "#34d399",
                        note: `${overviewStats.closeRate}% dos orçamentos`,
                      },
                    ].map((step) => (
                      <div key={step.label}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "5px" }}>
                          <span style={{ color: "#e2e8f0", fontWeight: 700 }}>{step.label}</span>
                          <span style={{ color: step.color, fontWeight: 800 }}>
                            {step.val} <small style={{ color: "#94a3b8", fontWeight: 500 }}>({step.note})</small>
                          </span>
                        </div>
                        <div style={{ width: "100%", height: "10px", background: "#060b18", borderRadius: "999px", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${Math.max(step.val > 0 ? 6 : 0, step.pct)}%`,
                              height: "100%",
                              background: step.color,
                              borderRadius: "999px",
                              transition: "width 0.3s ease",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* MOVIMENTO DIÁRIO */}
                <div className="cp-panel">
                  <h3 style={{ margin: "0 0 14px", fontSize: "15px", fontWeight: 700, color: "#fff" }}>
                    Movimento Diário (Últimos Dias Ativos)
                  </h3>
                  {overviewStats.dailySeries.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "#64748b", padding: "24px 0" }}>
                      Sem movimentação diária neste recorte.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {overviewStats.dailySeries.map((day) => {
                        const intPct = Math.round((day.interests / overviewStats.maxDaily) * 100);
                        const chatPct = Math.round((day.chats / overviewStats.maxDaily) * 100);
                        return (
                          <div key={day.dateKey} style={{ display: "grid", gridTemplateColumns: "52px 1fr auto", gap: "10px", alignItems: "center" }}>
                            <span style={{ fontSize: "12px", fontWeight: 700, color: "#cbd5e1" }}>{day.label}</span>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <div style={{ height: "7px", background: "#060b18", borderRadius: "999px", overflow: "hidden" }}>
                                <div style={{ width: `${Math.max(day.interests > 0 ? 5 : 0, intPct)}%`, height: "100%", background: "#facc15" }} />
                              </div>
                              <div style={{ height: "7px", background: "#060b18", borderRadius: "999px", overflow: "hidden" }}>
                                <div style={{ width: `${Math.max(day.chats > 0 ? 5 : 0, chatPct)}%`, height: "100%", background: "#38bdf8" }} />
                              </div>
                            </div>
                            <div style={{ fontSize: "11px", color: "#94a3b8", textAlign: "right", minWidth: "96px" }}>
                              <span style={{ color: "#facc15", fontWeight: 700 }}>{day.interests}</span> cl. •{" "}
                              <span style={{ color: "#38bdf8", fontWeight: 700 }}>{day.chats}</span> ch.
                              {day.sales > 0 && (
                                <span style={{ color: "#34d399", fontWeight: 700 }}> • {day.sales}v</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* EQUIPE (APENAS SE EMPRESA USA ROLETA) */}
            {showRouletteAttendants && overviewStats.attendantsStats.length > 0 && (
              <div className="cp-panel">
                <h3 style={{ margin: "0 0 12px", fontSize: "15px", fontWeight: 700, color: "#fff" }}>
                  Atendimentos por Vendedor
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                  {overviewStats.attendantsStats.map((att) => (
                    <div
                      key={att.name}
                      style={{
                        background: "#090f20",
                        border: "1px solid #1e293b",
                        borderRadius: "10px",
                        padding: "14px",
                      }}
                    >
                      <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "8px" }}>
                        {att.name}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", textAlign: "center" }}>
                        <div style={{ background: "#0f172a", padding: "7px", borderRadius: "7px" }}>
                          <div style={{ fontSize: "10px", color: "#94a3b8" }}>Conversas</div>
                          <div style={{ fontSize: "16px", fontWeight: 800, color: "#38bdf8" }}>{att.chats}</div>
                        </div>
                        <div style={{ background: "#0f172a", padding: "7px", borderRadius: "7px" }}>
                          <div style={{ fontSize: "10px", color: "#94a3b8" }}>Orçamentos</div>
                          <div style={{ fontSize: "16px", fontWeight: 800, color: "#c084fc" }}>{att.quotes}</div>
                        </div>
                        <div style={{ background: "#0f172a", padding: "7px", borderRadius: "7px" }}>
                          <div style={{ fontSize: "10px", color: "#94a3b8" }}>Vendas</div>
                          <div style={{ fontSize: "16px", fontWeight: 800, color: "#34d399" }}>{att.sales}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ATENDIMENTOS RECENTES (ZERO DADOS TÉCNICOS) */}
            {overviewStats.recentAttendances.length > 0 && (
              <div className="cp-panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#fff" }}>
                    Atendimentos Recentes
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab("funil")}
                    style={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#38bdf8",
                      borderRadius: "7px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Abrir Funil Kanban
                  </button>
                </div>

                <div className="cp-table-wrap">
                  <table className="cp-table">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                        <th style={{ padding: "9px 10px" }}>Cliente</th>
                        {showRouletteAttendants && <th style={{ padding: "9px 10px" }}>Atendente</th>}
                        <th style={{ padding: "9px 10px" }}>Etapa</th>
                        <th style={{ padding: "9px 10px" }}>Valor</th>
                        <th style={{ padding: "9px 10px" }}>Data / Hora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewStats.recentAttendances.map((item) => {
                        const st = getEffectiveStage(item);
                        return (
                          <tr key={item.id} style={{ borderBottom: "1px solid #0f172a" }}>
                            <td style={{ padding: "10px" }}>
                              <div style={{ fontWeight: 700, color: "#fff" }}>{item.leadName || "Cliente WhatsApp"}</div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>{item.leadPhone}</div>
                            </td>
                            {showRouletteAttendants && (
                              <td style={{ padding: "10px", color: "#cbd5e1" }}>{item.attendantName}</td>
                            )}
                            <td style={{ padding: "10px", fontWeight: 700, color: st === "compra_realizada" ? "#34d399" : st === "orcamento_enviado" ? "#c084fc" : st === "conversa_iniciada" ? "#38bdf8" : "#facc15" }}>
                              {formatStageLabel(st)}
                            </td>
                            <td style={{ padding: "10px", color: item.value > 0 ? "#34d399" : "#64748b", fontWeight: item.value > 0 ? 700 : 400 }}>
                              {item.value > 0 ? `R$ ${formatCurrencyBr(item.value)}` : "—"}
                            </td>
                            <td style={{ padding: "10px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                              {formatBrDateTime(item.occurredAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            ABA 2: LEADS (LISTA LIMPA SEM PALAVRA-CHAVE OU CAMPANHA)
           ========================================================= */}
        {activeTab === "leads" && (
          <div className="cp-panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#fff" }}>
                  Lista de Contatos &amp; Atendimentos ({filteredLeadsList.length})
                </h2>
                <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                  Filtre por nome, telefone, etapa ou período para acompanhar e atualizar seus leads.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {(
                [
                  { id: "all", label: "Todo o Período" },
                  { id: "today", label: "Hoje" },
                  { id: "yesterday", label: "Ontem" },
                  { id: "7d", label: "Últimos 7 dias" },
                  { id: "30d", label: "Últimos 30 dias" },
                  { id: "this_month", label: "Este Mês" },
                ] as const
              ).map((p) => (
                <button
                  key={`ld_${p.id}`}
                  type="button"
                  onClick={() => handleLeadsPresetChange(p.id)}
                  className={`cp-preset-btn ${leadsPreset === p.id ? "active" : ""}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
              <div style={{ position: "relative" }}>
                <Search size={14} color="#64748b" style={{ position: "absolute", left: "11px", top: "12px" }} />
                <input
                  type="text"
                  placeholder="Buscar por nome ou WhatsApp..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="cp-input"
                  style={{ width: "100%", paddingLeft: "34px" }}
                />
              </div>

              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value as "all" | ClientStage)}
                className="cp-input"
              >
                <option value="all">Todas as Etapas</option>
                <option value="clique_anuncio">1. Interesse no WhatsApp</option>
                <option value="conversa_iniciada">2. Conversa Iniciada</option>
                <option value="orcamento_enviado">3. Orçamento Enviado</option>
                <option value="compra_realizada">4. Venda Fechada</option>
              </select>

              {showRouletteAttendants && (
                <select
                  value={attendantFilter}
                  onChange={(e) => setAttendantFilter(e.target.value)}
                  className="cp-input"
                >
                  <option value="all">Todos os Atendentes</option>
                  {attendantFilterOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}

              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="date"
                  value={leadsStartDate}
                  onChange={(e) => {
                    setLeadsPreset("all");
                    setLeadsStartDate(e.target.value);
                  }}
                  className="cp-input"
                  style={{ flex: 1, fontSize: "12px" }}
                />
                <input
                  type="date"
                  value={leadsEndDate}
                  onChange={(e) => {
                    setLeadsPreset("all");
                    setLeadsEndDate(e.target.value);
                  }}
                  className="cp-input"
                  style={{ flex: 1, fontSize: "12px" }}
                />
              </div>
            </div>

            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px" }}>Cliente / WhatsApp</th>
                    {showRouletteAttendants && <th style={{ padding: "10px" }}>Atendente</th>}
                    <th style={{ padding: "10px" }}>Etapa do Funil</th>
                    <th style={{ padding: "10px" }}>Valor Registrado</th>
                    <th style={{ padding: "10px" }}>Data / Hora (BR)</th>
                    <th style={{ padding: "10px", textAlign: "right" }}>Atualizar</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeadsList.length === 0 ? (
                    <tr>
                      <td colSpan={showRouletteAttendants ? 6 : 5} style={{ textAlign: "center", padding: "30px", color: "#64748b" }}>
                        Nenhum atendimento encontrado neste filtro.
                      </td>
                    </tr>
                  ) : (
                    filteredLeadsList.map((lead) => {
                      const st = getEffectiveStage(lead);
                      return (
                        <tr key={lead.id} style={{ borderBottom: "1px solid #0f172a" }}>
                          <td style={{ padding: "11px 10px" }}>
                            <div style={{ fontWeight: 700, color: "#fff" }}>{lead.leadName || "Cliente WhatsApp"}</div>
                            <div style={{ fontSize: "12px", color: "#94a3b8", display: "flex", alignItems: "center", gap: "5px", marginTop: "2px" }}>
                              <Phone size={11} color="#38bdf8" /> {lead.leadPhone}
                            </div>
                          </td>
                          {showRouletteAttendants && (
                            <td style={{ padding: "11px 10px", color: "#cbd5e1" }}>{lead.attendantName}</td>
                          )}
                          <td style={{ padding: "11px 10px" }}>
                            <select
                              value={st}
                              onChange={(e) => {
                                const nextSt = e.target.value as ClientStage;
                                if (nextSt === "compra_realizada") {
                                  openCloseSaleModal(lead);
                                } else {
                                  void handleMoveLeadStage(lead.id, nextSt);
                                }
                              }}
                              className="cp-input"
                              style={{ padding: "6px 10px", fontSize: "12px" }}
                            >
                              <option value="clique_anuncio">1. Interesse no WhatsApp</option>
                              <option value="conversa_iniciada">2. Conversa Iniciada</option>
                              <option value="orcamento_enviado">3. Orçamento Enviado</option>
                              <option value="compra_realizada">4. Compra Realizada</option>
                            </select>
                          </td>
                          <td style={{ padding: "11px 10px", fontWeight: 700, color: lead.value > 0 ? "#34d399" : "#64748b" }}>
                            {lead.value > 0 ? `R$ ${formatCurrencyBr(lead.value)}` : "—"}
                          </td>
                          <td style={{ padding: "11px 10px", color: "#94a3b8", whiteSpace: "nowrap" }}>
                            {formatBrDateTime(lead.occurredAt)}
                          </td>
                          <td style={{ padding: "11px 10px", textAlign: "right" }}>
                            <button
                              type="button"
                              onClick={() => openCloseSaleModal(lead)}
                              style={{
                                background: st === "compra_realizada" ? "#1e293b" : "rgba(16, 185, 129, 0.16)",
                                border: `1px solid ${st === "compra_realizada" ? "#334155" : "rgba(16, 185, 129, 0.35)"}`,
                                color: st === "compra_realizada" ? "#cbd5e1" : "#34d399",
                                borderRadius: "7px",
                                padding: "6px 10px",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {st === "compra_realizada" ? "Editar Valor R$" : "Fechar Venda R$"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================================
            ABA 3: FUNIL KANBAN INTERATIVO (ARRASTAR & GERENCIAR)
           ========================================================= */}
        {activeTab === "funil" && (
          <div className="cp-panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#fff" }}>
                  Funil Comercial Kanban (Arraste os cards ou use os botões)
                </h2>
                <p style={{ margin: "3px 0 0", fontSize: "12px", color: "#94a3b8" }}>
                  Mova seus clientes entre as etapas e registre os valores das vendas fechadas.
                </p>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b" }}>
                Total de atendimentos no funil: <strong style={{ color: "#fff" }}>{leads.length}</strong>
              </div>
            </div>

            <div className="cp-kanban-grid">
              {kanbanColumns.map((col) => {
                const colLeads = leads.filter((l) => getEffectiveStage(l) === col.id);
                const colRevenue =
                  col.id === "compra_realizada"
                    ? colLeads.reduce((acc, c) => acc + Number(c.value || 0), 0)
                    : 0;

                return (
                  <div
                    key={col.id}
                    className={`cp-kanban-col ${dragOverColumn === col.id ? "drag-over" : ""}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOverColumn !== col.id) setDragOverColumn(col.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverColumn === col.id) setDragOverColumn(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const droppedId = e.dataTransfer.getData("text/plain") || draggingLeadId;
                      setDragOverColumn(null);
                      setDraggingLeadId(null);
                      if (!droppedId) return;
                      const found = leads.find((item) => item.id === droppedId);
                      if (!found) return;
                      if (getEffectiveStage(found) === col.id) return;
                      if (col.id === "compra_realizada") {
                        openCloseSaleModal(found);
                      } else {
                        void handleMoveLeadStage(found.id, col.id);
                      }
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: "10px", borderBottom: "1px solid #1e293b", marginBottom: "12px" }}>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 800, color: col.accent }}>{col.title}</div>
                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                          {col.id === "compra_realizada" && colRevenue > 0
                            ? `R$ ${formatCurrencyBr(colRevenue)}`
                            : col.subtitle}
                        </div>
                      </div>
                      <span
                        style={{
                          background: col.badgeBg,
                          color: col.accent,
                          padding: "3px 9px",
                          borderRadius: "999px",
                          fontSize: "11px",
                          fontWeight: 800,
                        }}
                      >
                        {colLeads.length}
                      </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
                      {colLeads.length === 0 ? (
                        <div
                          style={{
                            border: "1px dashed #1e293b",
                            borderRadius: "10px",
                            padding: "24px 12px",
                            textAlign: "center",
                            fontSize: "12px",
                            color: "#475569",
                          }}
                        >
                          Arraste um card para cá
                        </div>
                      ) : (
                        colLeads.map((lead) => (
                          <div
                            key={lead.id}
                            draggable
                            onDragStart={(e) => {
                              setDraggingLeadId(lead.id);
                              e.dataTransfer.setData("text/plain", lead.id);
                            }}
                            onDragEnd={() => {
                              setDraggingLeadId(null);
                              setDragOverColumn(null);
                            }}
                            className="cp-kanban-card"
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
                              <div>
                                <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>
                                  {lead.leadName || "Cliente WhatsApp"}
                                </div>
                                <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                                  {lead.leadPhone}
                                </div>
                              </div>
                              <GripVertical size={14} color="#475569" />
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", fontSize: "11px", color: "#64748b" }}>
                              <span>{formatBrDateTime(lead.occurredAt)}</span>
                              {showRouletteAttendants && (
                                <span style={{ color: "#cbd5e1", fontWeight: 600 }}>{lead.attendantName}</span>
                              )}
                            </div>

                            {lead.value > 0 && (
                              <div style={{ marginTop: "8px", fontSize: "13px", fontWeight: 800, color: "#34d399" }}>
                                Valor: R$ {formatCurrencyBr(lead.value)}
                              </div>
                            )}

                            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px", paddingTop: "8px", borderTop: "1px solid #1e293b" }}>
                              {col.id === "clique_anuncio" && (
                                <button
                                  type="button"
                                  onClick={() => void handleMoveLeadStage(lead.id, "conversa_iniciada")}
                                  style={{
                                    flex: 1,
                                    background: "rgba(56, 189, 248, 0.16)",
                                    border: "1px solid rgba(56, 189, 248, 0.35)",
                                    color: "#7dd3fc",
                                    borderRadius: "6px",
                                    padding: "6px 8px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  → Conversa
                                </button>
                              )}

                              {(col.id === "clique_anuncio" || col.id === "conversa_iniciada") && (
                                <button
                                  type="button"
                                  onClick={() => void handleMoveLeadStage(lead.id, "orcamento_enviado")}
                                  style={{
                                    flex: 1,
                                    background: "rgba(192, 132, 252, 0.16)",
                                    border: "1px solid rgba(192, 132, 252, 0.35)",
                                    color: "#e9d5ff",
                                    borderRadius: "6px",
                                    padding: "6px 8px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  → Orçamento
                                </button>
                              )}

                              {col.id !== "compra_realizada" ? (
                                <button
                                  type="button"
                                  onClick={() => openCloseSaleModal(lead)}
                                  style={{
                                    flex: 1,
                                    background: "rgba(16, 185, 129, 0.16)",
                                    border: "1px solid rgba(16, 185, 129, 0.4)",
                                    color: "#6ee7b7",
                                    borderRadius: "6px",
                                    padding: "6px 8px",
                                    fontSize: "11px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  ✓ Venda R$
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openCloseSaleModal(lead)}
                                    style={{
                                      flex: 1,
                                      background: "#1e293b",
                                      border: "1px solid #334155",
                                      color: "#cbd5e1",
                                      borderRadius: "6px",
                                      padding: "6px 8px",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    Editar Valor R$
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleMoveLeadStage(lead.id, "orcamento_enviado")}
                                    style={{
                                      background: "transparent",
                                      border: "1px solid #334155",
                                      color: "#94a3b8",
                                      borderRadius: "6px",
                                      padding: "6px 8px",
                                      fontSize: "11px",
                                      cursor: "pointer",
                                    }}
                                  >
                                    ← Voltar
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* MODAL PARA REGISTRAR VALOR DA VENDA AO MOVER PARA "COMPRA REALIZADA" */}
      {saleModalLead && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            zIndex: 50,
          }}
        >
          <form
            onSubmit={handleConfirmSaleModal}
            style={{
              width: "100%",
              maxWidth: "400px",
              background: "#0b1329",
              border: "1px solid #334155",
              borderRadius: "14px",
              padding: "22px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
                <CheckCircle2 size={18} color="#34d399" /> Registrar Venda Fechada
              </h3>
              <button
                type="button"
                onClick={() => setSaleModalLead(null)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: "13px", color: "#cbd5e1" }}>
              Cliente: <strong>{saleModalLead.leadName || saleModalLead.leadPhone}</strong>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>
                Valor da Venda (R$)
              </label>
              <input
                type="text"
                inputMode="decimal"
                autoFocus
                placeholder="Ex: 1500,00"
                value={saleValueInput}
                onChange={(e) => setSaleValueInput(e.target.value)}
                className="cp-input"
                style={{ width: "100%", fontSize: "15px", fontWeight: 700 }}
              />
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setSaleModalLead(null)}
                style={{
                  background: "#1e293b",
                  border: "1px solid #334155",
                  color: "#cbd5e1",
                  borderRadius: "8px",
                  padding: "9px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isUpdatingLead}
                style={{
                  background: "#059669",
                  border: "none",
                  color: "#fff",
                  borderRadius: "8px",
                  padding: "9px 16px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {isUpdatingLead ? "Salvando..." : "Confirmar Venda"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
