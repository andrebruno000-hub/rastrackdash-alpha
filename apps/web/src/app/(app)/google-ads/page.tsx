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
  Plus,
  X,
  Save,
  BarChart3,
  Download,
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

interface ConversionRules {
  quote: {
    actionName: string;
    phrases: string[];
  };
  purchase: {
    actionName: string;
    phrases: string[];
  };
}

export default function GoogleAdsPage() {
  const [currentTab, setCurrentTab] = useState<"leads" | "funil" | "relatorios" | "roleta" | "conversoes">("leads");

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

  const [leadEvents, setLeadEvents] = useState<GoogleLeadEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [reportsData, setReportsData] = useState<{
    apiConnected: boolean;
    customerId: string;
    reports: any[];
    totalCost: number;
    totalRevenue: number;
    totalProfit: number;
    overallRoas: number;
  }>({
    apiConnected: false,
    customerId: "3228136878",
    reports: [],
    totalCost: 0,
    totalRevenue: 0,
    totalProfit: 0,
    overallRoas: 0,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filtros Aba 1
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterAttendant, setFilterAttendant] = useState("all");
  const [filterStage, setFilterStage] = useState("all");

  // Filtros Customizáveis Aba de Relatórios
  const [reportDatePreset, setReportDatePreset] = useState<"today" | "yesterday" | "7d" | "30d" | "this_month" | "all">("all");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportCampaign, setReportCampaign] = useState("all");
  const [reportAdGroup, setReportAdGroup] = useState("all");
  const [reportAttendant, setReportAttendant] = useState("all");
  const [reportStage, setReportStage] = useState("all");

  // Regras Dinâmicas de Conversão
  const [rules, setRules] = useState<ConversionRules>({
    quote: {
      actionName: "WhatsApp - Orçamento Enviado",
      phrases: ["orçamento enviado", "orcamento enviado", "segue o orçamento", "proposta enviada", "segue seu orçamento"],
    },
    purchase: {
      actionName: "WhatsApp - Compra Realizada",
      phrases: ["pedido fechado", "compra realizada", "venda confirmada", "pedido confirmado", "segue copia do pedido"],
    },
  });

  const [newQuotePhrase, setNewQuotePhrase] = useState("");
  const [newPurchasePhrase, setNewPurchasePhrase] = useState("");
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fetchData = async () => {
    setIsRefreshing(true);
    try {
      const queryParams = new URLSearchParams();
      if (reportStartDate) queryParams.set("startDate", reportStartDate);
      if (reportEndDate) queryParams.set("endDate", reportEndDate);
      if (reportCampaign !== "all") queryParams.set("campaign", reportCampaign);
      if (reportAdGroup !== "all") queryParams.set("adGroup", reportAdGroup);
      if (reportAttendant !== "all") queryParams.set("attendant", reportAttendant);

      const [leadsRes, auditsRes, rulesRes, reportsRes] = await Promise.all([
        fetch("/api/google-ads/leads"),
        fetch("/api/google-ads/leads?type=audits"),
        fetch("/api/google-ads/leads?type=rules"),
        fetch(`/api/google-ads/reports?${queryParams.toString()}`),
      ]);

      if (leadsRes.ok) {
        const data = await leadsRes.json();
        if (Array.isArray(data)) setLeadEvents(data);
      }
      if (auditsRes.ok) {
        const data = await auditsRes.json();
        if (Array.isArray(data)) setAuditLogs(data);
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        if (data && data.quote && data.purchase) setRules(data);
      }
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        if (data) setReportsData(data);
      }
    } catch (e) {
      console.error("Erro ao carregar dados:", e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [reportStartDate, reportEndDate, reportCampaign, reportAdGroup, reportAttendant]);

  const handleDatePresetChange = (preset: "today" | "yesterday" | "7d" | "30d" | "this_month" | "all") => {
    setReportDatePreset(preset);
    const today = new Date();
    const formatDate = (d: Date) => d.toISOString().split("T")[0];

    if (preset === "today") {
      setReportStartDate(formatDate(today));
      setReportEndDate(formatDate(today));
    } else if (preset === "yesterday") {
      const yest = new Date(today);
      yest.setDate(yest.getDate() - 1);
      setReportStartDate(formatDate(yest));
      setReportEndDate(formatDate(yest));
    } else if (preset === "7d") {
      const past7 = new Date(today);
      past7.setDate(past7.getDate() - 7);
      setReportStartDate(formatDate(past7));
      setReportEndDate(formatDate(today));
    } else if (preset === "30d") {
      const past30 = new Date(today);
      past30.setDate(past30.getDate() - 30);
      setReportStartDate(formatDate(past30));
      setReportEndDate(formatDate(today));
    } else if (preset === "this_month") {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      setReportStartDate(formatDate(startOfMonth));
      setReportEndDate(formatDate(today));
    } else if (preset === "all") {
      setReportStartDate("");
      setReportEndDate("");
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha_google_attendants", JSON.stringify(attendants));
    }
  }, [attendants]);

  const handleAddPhrase = (type: "quote" | "purchase", phrase: string) => {
    const clean = phrase.trim().toLowerCase();
    if (!clean) return;
    if (rules[type].phrases.includes(clean)) return;

    setRules({
      ...rules,
      [type]: {
        ...rules[type],
        phrases: [...rules[type].phrases, clean],
      },
    });

    if (type === "quote") setNewQuotePhrase("");
    if (type === "purchase") setNewPurchasePhrase("");
  };

  const handleRemovePhrase = (type: "quote" | "purchase", phraseToRemove: string) => {
    setRules({
      ...rules,
      [type]: {
        ...rules[type],
        phrases: rules[type].phrases.filter((p) => p !== phraseToRemove),
      },
    });
  };

  const handleSaveRules = async () => {
    setIsSavingRules(true);
    try {
      const res = await fetch("/api/google-ads/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "save_rules", rules }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (e) {
      console.error("Erro ao salvar regras:", e);
    } finally {
      setIsSavingRules(false);
    }
  };

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

  const uniqueCampaigns = useMemo(() => {
    const set = new Set<string>();
    leadEvents.forEach((l) => l.campaign && set.add(l.campaign));
    return Array.from(set);
  }, [leadEvents]);

  const uniqueAdGroups = useMemo(() => {
    const set = new Set<string>();
    leadEvents.forEach((l) => l.adGroup && set.add(l.adGroup));
    return Array.from(set);
  }, [leadEvents]);

  const filteredReportLeads = useMemo(() => {
    return leadEvents.filter((event) => {
      const eventDate = (event.occurredAt || event.firstMessageAt || "").slice(0, 10);
      const matchesDate =
        (!reportStartDate || eventDate >= reportStartDate) &&
        (!reportEndDate || eventDate <= reportEndDate);

      const matchesCampaign = reportCampaign === "all" || event.campaign === reportCampaign;
      const matchesAdGroup = reportAdGroup === "all" || event.adGroup === reportAdGroup;
      const matchesAttendant = reportAttendant === "all" || event.attendantName === reportAttendant;
      const currentLeadStage = event.stage || "conversa_iniciada";
      const matchesStage = reportStage === "all" || currentLeadStage === reportStage;

      return matchesDate && matchesCampaign && matchesAdGroup && matchesAttendant && matchesStage;
    });
  }, [leadEvents, reportStartDate, reportEndDate, reportCampaign, reportAdGroup, reportAttendant, reportStage]);

  const reportMetrics = useMemo(() => {
    const totalLeadsCount = filteredReportLeads.length;
    const quotesCount = filteredReportLeads.filter((l) => l.stage === "orcamento_enviado" || l.stage === "compra_realizada").length;
    const salesCount = filteredReportLeads.filter((l) => l.stage === "compra_realizada").length;
    const totalRevenue = filteredReportLeads
      .filter((l) => l.stage === "compra_realizada" && l.value)
      .reduce((acc, curr) => acc + (curr.value || 0), 0);
    const totalCost = reportsData.totalCost || 0;
    const profit = totalRevenue - totalCost;
    const roas = totalCost > 0 ? Number((totalRevenue / totalCost).toFixed(2)) : totalRevenue > 0 ? 99 : 0;
    const cpl = totalLeadsCount > 0 && totalCost > 0 ? Number((totalCost / totalLeadsCount).toFixed(2)) : 0;
    const averageTicket = salesCount > 0 ? Number((totalRevenue / salesCount).toFixed(2)) : 0;
    const conversionRate = totalLeadsCount > 0 ? Number(((salesCount / totalLeadsCount) * 100).toFixed(1)) : 0;

    return {
      totalLeadsCount,
      quotesCount,
      salesCount,
      totalRevenue,
      totalCost,
      profit,
      roas,
      cpl,
      averageTicket,
      conversionRate,
    };
  }, [filteredReportLeads, reportsData.totalCost]);

  const handleExportCSV = () => {
    const headers = ["Data", "Nome", "Telefone", "Campanha", "Conjunto", "Palavra-Chave", "Atendente", "Etapa", "Valor R$"];
    const rows = filteredReportLeads.map((l) => [
      l.occurredAt,
      `"${l.leadName || "Cliente"}"`,
      l.leadPhone,
      `"${l.campaign}"`,
      `"${l.adGroup}"`,
      `"${l.keyword}"`,
      `"${l.attendantName}"`,
      l.stage || "conversa_iniciada",
      l.value || 0,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_google_ads_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          padding: 6px;
          display: flex;
          gap: 6px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          width: 100%;
          box-sizing: border-box;
        }
        @media (min-width: 1024px) {
          .gads-tabs-bar {
            flex-wrap: wrap;
            overflow-x: visible;
          }
        }
        .gads-tab-btn {
          border: none;
          padding: 9px 15px;
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

        .phrase-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }
        .phrase-remove-btn {
          background: transparent;
          border: none;
          color: inherit;
          opacity: 0.7;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          padding: 0;
        }
        .phrase-remove-btn:hover {
          opacity: 1;
        }

        .date-preset-btn {
          background: #0f172a;
          border: 1px solid #1e293b;
          color: #94a3b8;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
        }
        .date-preset-btn.active {
          background: #2563eb;
          color: #fff;
          border-color: #2563eb;
        }

        @media (min-width: 768px) {
          .gads-wrapper {
            padding: 24px 32px;
          }
          .gads-header-block {
            flex-direction: column;
            align-items: stretch;
            gap: 16px;
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

      {/* CABEÇALHO COM ABAS 100% LARGURA NO DESKTOP */}
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
            Relatórios customizáveis de ROAS, atribuição de palavras-chave, funil CRM por etapas e roleta justa de WhatsApp.
          </p>
        </div>

        {/* BARRA DAS 5 ABAS (100% VISÍVEL NO DESKTOP E MOBILE) */}
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
            onClick={() => setCurrentTab("relatorios")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "relatorios" ? "#2563eb" : "transparent",
              color: currentTab === "relatorios" ? "#fff" : "#94a3b8",
            }}
          >
            <BarChart3 size={15} /> 3. Relatórios & Lucro (BI)
          </button>
          <button
            onClick={() => setCurrentTab("roleta")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "roleta" ? "#2563eb" : "transparent",
              color: currentTab === "roleta" ? "#fff" : "#94a3b8",
            }}
          >
            <RefreshCw size={15} /> 4. Roleta de Atendentes
          </button>
          <button
            onClick={() => setCurrentTab("conversoes")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "conversoes" ? "#2563eb" : "transparent",
              color: currentTab === "conversoes" ? "#fff" : "#94a3b8",
            }}
          >
            <CheckCheck size={15} /> 5. Regras & Auditoria
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
                onClick={fetchData}
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

      {/* ABA 2: FUNIL CRM (KANBAN) */}
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

      {/* ABA 3: RELATÓRIOS & ANALYTICS CUSTOMIZÁVEL */}
      {currentTab === "relatorios" && (
        <div className="gads-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                Relatórios Customizáveis & Inteligência Financeira
              </h2>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                Filtre por períodos, campanhas, conjuntos e atendentes para analisar gastos, faturamento, lucro e ROAS real.
              </p>
            </div>

            <button
              onClick={handleExportCSV}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#38bdf8",
                borderRadius: "8px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <Download size={15} /> Exportar CSV (Excel)
            </button>
          </div>

          <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
              <button
                type="button"
                onClick={() => handleDatePresetChange("all")}
                className={`date-preset-btn ${reportDatePreset === "all" ? "active" : ""}`}
              >
                Todo o Período
              </button>
              <button
                type="button"
                onClick={() => handleDatePresetChange("today")}
                className={`date-preset-btn ${reportDatePreset === "today" ? "active" : ""}`}
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => handleDatePresetChange("yesterday")}
                className={`date-preset-btn ${reportDatePreset === "yesterday" ? "active" : ""}`}
              >
                Ontem
              </button>
              <button
                type="button"
                onClick={() => handleDatePresetChange("7d")}
                className={`date-preset-btn ${reportDatePreset === "7d" ? "active" : ""}`}
              >
                Últimos 7 dias
              </button>
              <button
                type="button"
                onClick={() => handleDatePresetChange("30d")}
                className={`date-preset-btn ${reportDatePreset === "30d" ? "active" : ""}`}
              >
                Últimos 30 dias
              </button>
              <button
                type="button"
                onClick={() => handleDatePresetChange("this_month")}
                className={`date-preset-btn ${reportDatePreset === "this_month" ? "active" : ""}`}
              >
                Este Mês
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                  Data Inicial:
                </label>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => {
                    setReportDatePreset("all");
                    setReportStartDate(e.target.value);
                  }}
                  className="gads-select-field"
                  style={{ padding: "8px 10px" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                  Data Final:
                </label>
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => {
                    setReportDatePreset("all");
                    setReportEndDate(e.target.value);
                  }}
                  className="gads-select-field"
                  style={{ padding: "8px 10px" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                  Campanha:
                </label>
                <select
                  value={reportCampaign}
                  onChange={(e) => setReportCampaign(e.target.value)}
                  className="gads-select-field"
                  style={{ padding: "8px 10px" }}
                >
                  <option value="all">Todas as Campanhas</option>
                  {uniqueCampaigns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                  Conjunto de Anúncios:
                </label>
                <select
                  value={reportAdGroup}
                  onChange={(e) => setReportAdGroup(e.target.value)}
                  className="gads-select-field"
                  style={{ padding: "8px 10px" }}
                >
                  <option value="all">Todos os Conjuntos</option>
                  {uniqueAdGroups.map((ad) => (
                    <option key={ad} value={ad}>
                      {ad}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                  Atendente:
                </label>
                <select
                  value={reportAttendant}
                  onChange={(e) => setReportAttendant(e.target.value)}
                  className="gads-select-field"
                  style={{ padding: "8px 10px" }}
                >
                  <option value="all">Todos Atendentes</option>
                  <option value="Josi">Josi</option>
                  <option value="Sérgio">Sérgio</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
                  Etapa do Funil:
                </label>
                <select
                  value={reportStage}
                  onChange={(e) => setReportStage(e.target.value)}
                  className="gads-select-field"
                  style={{ padding: "8px 10px" }}
                >
                  <option value="all">Todas as Etapas</option>
                  <option value="conversa_iniciada">Conversa Iniciada</option>
                  <option value="em_atendimento">Em Atendimento</option>
                  <option value="orcamento_enviado">Orçamento Enviado</option>
                  <option value="compra_realizada">Compra Realizada</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "28px" }}>
            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Gasto Google Ads</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#ffffff", marginTop: "4px" }}>
                R$ {reportMetrics.totalCost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <small style={{ color: "#64748b", fontSize: "11px" }}>API Google v17</small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700, textTransform: "uppercase" }}>Leads WhatsApp</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#38bdf8", marginTop: "4px" }}>
                {reportMetrics.totalLeadsCount}
              </div>
              <small style={{ color: "#64748b", fontSize: "11px" }}>CPL: R$ {reportMetrics.cpl.toFixed(2)}</small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#c084fc", fontWeight: 700, textTransform: "uppercase" }}>Orçamentos</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#c084fc", marginTop: "4px" }}>
                {reportMetrics.quotesCount}
              </div>
              <small style={{ color: "#64748b", fontSize: "11px" }}>Propostas ativas</small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#10b981", fontWeight: 700, textTransform: "uppercase" }}>Vendas Fechadas</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#10b981", marginTop: "4px" }}>
                {reportMetrics.salesCount}
              </div>
              <small style={{ color: "#34d399", fontSize: "11px" }}>Conversão: {reportMetrics.conversionRate}%</small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#10b981", fontWeight: 700, textTransform: "uppercase" }}>Faturamento Total</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#10b981", marginTop: "4px" }}>
                R$ {reportMetrics.totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <small style={{ color: "#64748b", fontSize: "11px" }}>Ticket Médio: R$ {reportMetrics.averageTicket.toFixed(2)}</small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700, textTransform: "uppercase" }}>Lucro Líquido Real</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: reportMetrics.profit >= 0 ? "#34d399" : "#f87171", marginTop: "4px" }}>
                R$ {reportMetrics.profit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <small style={{ color: "#64748b", fontSize: "11px" }}>Receita - Gasto</small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700, textTransform: "uppercase" }}>ROAS Real</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#38bdf8", marginTop: "4px" }}>
                {reportMetrics.roas}x
              </div>
              <small style={{ color: "#64748b", fontSize: "11px" }}>Retorno s/ anúncio</small>
            </div>
          </div>

          <div style={{ marginBottom: "28px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#fff", marginBottom: "10px" }}>
              Resultado Financeiro por Conjunto de Anúncios no Período
            </h3>

            <div className="gads-table-scroll">
              <table className="gads-table">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px" }}>Campanha Google</th>
                    <th style={{ padding: "10px 12px" }}>Conjunto de Anúncios</th>
                    <th style={{ padding: "10px 12px" }}>Gasto (R$)</th>
                    <th style={{ padding: "10px 12px" }}>Leads WhatsApp</th>
                    <th style={{ padding: "10px 12px" }}>Orçamentos</th>
                    <th style={{ padding: "10px 12px" }}>Vendas (R$)</th>
                    <th style={{ padding: "10px 12px" }}>Lucro Líquido (R$)</th>
                    <th style={{ padding: "10px 12px" }}>ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {reportsData.reports.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>
                        Nenhum conjunto com dados no filtro selecionado
                      </td>
                    </tr>
                  ) : (
                    reportsData.reports.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "10px 12px", color: "#cbd5e1", fontWeight: 600 }}>{item.campaign}</td>
                        <td style={{ padding: "10px 12px", color: "#38bdf8", fontWeight: 600 }}>{item.adGroup}</td>
                        <td style={{ padding: "10px 12px", color: "#fff" }}>
                          R$ {item.cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#fff", fontWeight: 700 }}>{item.whatsappLeads}</td>
                        <td style={{ padding: "10px 12px", color: "#c084fc" }}>{item.whatsappQuotes}</td>
                        <td style={{ padding: "10px 12px", color: "#34d399", fontWeight: 700 }}>
                          R$ {item.whatsappRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: "10px 12px", color: item.profit >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>
                          R$ {item.profit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span
                            style={{
                              background: item.roas >= 4 ? "rgba(16, 185, 129, 0.2)" : "rgba(59, 130, 246, 0.2)",
                              color: item.roas >= 4 ? "#34d399" : "#60a5fa",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              fontWeight: 800,
                              fontSize: "12px",
                            }}
                          >
                            {item.roas}x
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#fff", marginBottom: "10px" }}>
              Leads Analíticos do Período ({filteredReportLeads.length} leads)
            </h3>

            <div className="gads-table-scroll">
              <table className="gads-table">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px" }}>Contato</th>
                    <th style={{ padding: "10px 12px" }}>Palavra-Chave</th>
                    <th style={{ padding: "10px 12px" }}>Campanha / Conjunto</th>
                    <th style={{ padding: "10px 12px" }}>Atendente</th>
                    <th style={{ padding: "10px 12px" }}>Etapa</th>
                    <th style={{ padding: "10px 12px" }}>Valor Venda</th>
                    <th style={{ padding: "10px 12px" }}>Data / Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReportLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>
                        Nenhum lead encontrado com estes filtros
                      </td>
                    </tr>
                  ) : (
                    filteredReportLeads.map((l) => (
                      <tr key={l.id} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <strong style={{ color: "#fff" }}>{l.leadName || "Cliente"}</strong>
                          <div style={{ color: "#64748b", fontSize: "11px" }}>{l.leadPhone}</div>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#38bdf8" }}>{l.keyword || "Pesquisa Direta"}</td>
                        <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>
                          <div>{l.campaign}</div>
                          <small style={{ color: "#64748b" }}>{l.adGroup}</small>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ background: "#1e293b", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                            {l.attendantName}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {l.stage === "compra_realizada" ? (
                            <span style={{ color: "#34d399", fontWeight: 700 }}>Compra Realizada</span>
                          ) : l.stage === "orcamento_enviado" ? (
                            <span style={{ color: "#c084fc", fontWeight: 600 }}>Orçamento</span>
                          ) : l.stage === "em_atendimento" ? (
                            <span style={{ color: "#facc15" }}>Em Atendimento</span>
                          ) : (
                            <span style={{ color: "#60a5fa" }}>Conversa</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", color: l.value ? "#34d399" : "#64748b", fontWeight: l.value ? 700 : 400 }}>
                          {l.value ? `R$ ${l.value.toLocaleString("pt-BR")}` : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#64748b", whiteSpace: "nowrap" }}>
                          {l.occurredAt}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 4: ROLETA DE ATENDENTES */}
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

      {/* ABA 5: CONFIGURAÇÃO DE REGRAS DINÂMICAS & AUDITORIA */}
      {currentTab === "conversoes" && (
        <div className="gads-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                Configuração Dinâmica de Frases & Regras Google Ads
              </h2>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                Edite as frases que disparam as conversões no WhatsApp em tempo real, sem precisar mexer em código.
              </p>
            </div>

            <button
              onClick={handleSaveRules}
              disabled={isSavingRules}
              style={{
                background: saveSuccess ? "#10b981" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                padding: "10px 18px",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                transition: "background 0.2s",
              }}
            >
              {saveSuccess ? <CheckCircle2 size={16} /> : <Save size={16} />}
              {isSavingRules ? "Salvando..." : saveSuccess ? "Regras Salvas!" : "Salvar Regras de Conversão"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px", marginBottom: "28px" }}>
            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#c084fc", fontWeight: 700, fontSize: "14px", marginBottom: "6px" }}>
                <Award size={16} /> Conversão: Orçamento Enviado
              </div>
              <small style={{ color: "#64748b", display: "block", marginBottom: "14px" }}>
                Ação Google Ads: <strong style={{ color: "#cbd5e1" }}>{rules.quote.actionName}</strong>
              </small>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px", minHeight: "65px" }}>
                {rules.quote.phrases.map((phrase) => (
                  <span
                    key={phrase}
                    className="phrase-pill"
                    style={{ background: "rgba(192, 132, 252, 0.15)", color: "#c084fc", border: "1px solid rgba(192, 132, 252, 0.3)" }}
                  >
                    "{phrase}"
                    <button
                      onClick={() => handleRemovePhrase("quote", phrase)}
                      className="phrase-remove-btn"
                      title="Remover frase"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Nova frase (ex: proposta enviada)"
                  value={newQuotePhrase}
                  onChange={(e) => setNewQuotePhrase(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPhrase("quote", newQuotePhrase)}
                  className="gads-input-field"
                  style={{ padding: "8px 12px", fontSize: "12px" }}
                />
                <button
                  type="button"
                  onClick={() => handleAddPhrase("quote", newQuotePhrase)}
                  style={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    color: "#c084fc",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "12px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Plus size={13} /> Adicionar
                </button>
              </div>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#34d399", fontWeight: 700, fontSize: "14px", marginBottom: "6px" }}>
                <CheckCircle2 size={16} /> Conversão: Compra Realizada (com R$)
              </div>
              <small style={{ color: "#64748b", display: "block", marginBottom: "14px" }}>
                Ação Google Ads: <strong style={{ color: "#cbd5e1" }}>{rules.purchase.actionName}</strong>
              </small>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px", minHeight: "65px" }}>
                {rules.purchase.phrases.map((phrase) => (
                  <span
                    key={phrase}
                    className="phrase-pill"
                    style={{ background: "rgba(52, 211, 153, 0.15)", color: "#34d399", border: "1px solid rgba(52, 211, 153, 0.3)" }}
                  >
                    "{phrase}"
                    <button
                      onClick={() => handleRemovePhrase("purchase", phrase)}
                      className="phrase-remove-btn"
                      title="Remover frase"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Nova frase (ex: pix confirmado)"
                  value={newPurchasePhrase}
                  onChange={(e) => setNewPurchasePhrase(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPhrase("purchase", newPurchasePhrase)}
                  className="gads-input-field"
                  style={{ padding: "8px 12px", fontSize: "12px" }}
                />
                <button
                  type="button"
                  onClick={() => handleAddPhrase("purchase", newPurchasePhrase)}
                  style={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    color: "#34d399",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "12px",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Plus size={13} /> Adicionar
                </button>
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid #1e293b", paddingTop: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff", marginBottom: "4px" }}>
              Auditoria de Disparos de Conversão Pelos Atendentes
            </h3>
            <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "14px" }}>
              Registro exato de quando a Josi ou o Sérgio usaram as palavras-chave na conversa para acionar a conversão.
            </p>

            {auditLogs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 16px", color: "#64748b", background: "#090f20", borderRadius: "10px" }}>
                <Clock size={32} color="#334155" style={{ margin: "0 auto 8px", display: "block" }} />
                <strong style={{ display: "block", color: "#94a3b8", fontSize: "13px" }}>
                  Nenhum disparo de conversão registrado ainda
                </strong>
                <p style={{ fontSize: "12px", margin: "6px auto 0", maxWidth: "420px" }}>
                  Quando o atendente responder um cliente no WhatsApp com qualquer uma das frases cadastradas acima, o registro auditado aparecerá aqui.
                </p>
              </div>
            ) : (
              <div className="gads-table-scroll">
                <table className="gads-table">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                      <th style={{ padding: "10px 12px" }}>Atendente</th>
                      <th style={{ padding: "10px 12px" }}>Cliente / Telefone</th>
                      <th style={{ padding: "10px 12px" }}>Ação Disparada</th>
                      <th style={{ padding: "10px 12px" }}>Frase Detectada no Chat</th>
                      <th style={{ padding: "10px 12px" }}>Valor Registrado</th>
                      <th style={{ padding: "10px 12px" }}>Status Google OCI</th>
                      <th style={{ padding: "10px 12px" }}>Data / Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((item) => (
                      <tr key={item.id} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 600, color: "#fff" }}>
                          {item.attendant || "Atendente"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#94a3b8" }}>
                          {item.leadName || item.leadPhone}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {item.action === "orcamento_enviado" ? (
                            <span style={{ color: "#c084fc", fontWeight: 600 }}>Orçamento Enviado</span>
                          ) : item.action === "compra_realizada" ? (
                            <span style={{ color: "#34d399", fontWeight: 600 }}>Compra Realizada</span>
                          ) : (
                            <span style={{ color: "#38bdf8", fontWeight: 600 }}>Conversa Iniciada</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#e2e8f0", fontStyle: "italic", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          "{item.detectedPhrase}"
                        </td>
                        <td style={{ padding: "10px 12px", color: "#fff" }}>
                          {item.value ? `R$ ${item.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "—"}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ color: "#10b981", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px" }}>
                            <CheckCircle2 size={12} /> Fila OCI Ativa
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#64748b", whiteSpace: "nowrap" }}>
                          {item.timestamp ? new Date(item.timestamp).toLocaleString("pt-BR") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
