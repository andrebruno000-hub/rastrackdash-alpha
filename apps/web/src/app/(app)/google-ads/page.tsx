"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Send,
  CheckCircle2,
  Clock,
  RefreshCw,
  Users,
  Phone,
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
  Calendar,
  Download,
  AlertTriangle,
  Lock,
  Target,
  Flame,
  Copy,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  LayoutDashboard,
  Building2,
  Tag,
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
  campaignName?: string;
  adGroup: string;
  adGroupName?: string;
  gclid: string;
  conversionType?: "clique_anuncio" | "conversa_iniciada" | "orcamento_enviado" | "compra_realizada";
  stage?: "clique_anuncio" | "conversa_iniciada" | "orcamento_enviado" | "compra_realizada";
  status: "queued" | "sent" | "failed";
  occurredAt: string;
  firstMessageAt?: string;
  quotedAt?: string;
  purchasedAt?: string;
  value?: number;
  triggerPhrase?: string;
  matchedRulePhrase?: string;
  matchedRuleLabel?: string;
  ociOrderId?: string;
  ociError?: string | null;
  ociResult?: string | null;
  lastUploadedStage?: string;
  clickViewEnriched?: boolean;
  matchType?: string;
  adId?: string;
  pendingConversionAdjustment?: any;
}

interface ConversionRules {
  quote: {
    actionName: string;
    phrases: string[];
    labels?: string[];
  };
  purchase: {
    actionName: string;
    phrases: string[];
    labels?: string[];
  };
}

interface ManagedTenantAttendant {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  hasToken?: boolean;
  tokenMasked?: string;
  validDdi55?: boolean;
}

interface ManagedTenantUser {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
}

interface ManagedTenant {
  slug: string;
  name: string;
  active: boolean;
  googleCustomerId: string;
  routingMode: "single" | "roulette";
  initialMessage: string;
  attendants: ManagedTenantAttendant[];
  uazapi: {
    baseUrl: string;
    configured: boolean;
    hasSingleToken?: boolean;
    hasJosiToken?: boolean;
    hasSergioToken?: boolean;
    singleTokenMasked?: string;
    josiTokenMasked?: string;
    sergioTokenMasked?: string;
    updatedAt?: string;
  };
  clientAccess: {
    enabled: boolean;
    users: ManagedTenantUser[];
  };
  createdAt?: string;
  updatedAt?: string;
}

type DatePreset =
  | "all"
  | "today"
  | "yesterday"
  | "day_before_yesterday"
  | "7d"
  | "14d"
  | "30d"
  | "this_month";

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

function slugifyClientName(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isBrazilianPhoneDdiValid(rawPhone: string): boolean {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  return digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
}

export default function GoogleAdsPage() {
  const [currentTab, setCurrentTab] = useState<
    "overview" | "leads" | "funil" | "relatorios" | "roleta" | "conversoes" | "bi" | "clientes"
  >("overview");

  // Multi-Cliente Google Ads (Passo M3 — 100% isolado da Meta)
  const [tenantsList, setTenantsList] = useState<ManagedTenant[]>([]);
  const [activeTenantSlug, setActiveTenantSlug] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("client");
      if (fromUrl) return slugifyClientName(fromUrl) || "cnac";
      return localStorage.getItem("alpha_google_active_tenant") || "cnac";
    }
    return "cnac";
  });
  const activeTenant = useMemo(
    () => tenantsList.find((t) => t.slug === activeTenantSlug) || tenantsList[0] || null,
    [tenantsList, activeTenantSlug]
  );

  // Roleta / Atendentes (dinâmicos por cliente ativo)
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

  // Base Real de Leads, Auditoria e Relatórios + BI Avançado (Passo 4)
  const [leadEvents, setLeadEvents] = useState<GoogleLeadEvent[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [reportsData, setReportsData] = useState<{
    apiConnected: boolean;
    apiVersionUsed?: string;
    apiError?: string | null;
    customerId: string;
    biCacheFetchedAt?: string | null;
    biFromCache?: boolean;
    reports: any[];
    totalCost: number;
    totalRevenue: number;
    totalProfit: number;
    overallRoas: number;
    campaignHealth?: any[];
    searchTerms?: any[];
    keywordPerformance?: any[];
    adPerformance?: any[];
    decisionInsights?: {
      wastedTermsCount: number;
      wastedTermsCost: number;
      topWastedTerms: any[];
      topWinningTerms: any[];
      bestAdGroup: any;
      bestKeyword: any;
      budgetOpportunityCampaigns: any[];
    };
  }>({
    apiConnected: false,
    apiVersionUsed: undefined,
    apiError: null,
    customerId: "3228136878",
    reports: [],
    totalCost: 0,
    totalRevenue: 0,
    totalProfit: 0,
    overallRoas: 0,
    campaignHealth: [],
    searchTerms: [],
    keywordPerformance: [],
    adPerformance: [],
  });

  // Estados da Aba 6 (Inteligência & Decisão BI)
  const [biSubTab, setBiSubTab] = useState<"termos" | "keywords" | "conjuntos" | "anuncios">("termos");
  const [biSearchQuery, setBiSearchQuery] = useState("");
  const [biTermFilter, setBiTermFilter] = useState<"all" | "NEGATIVAR" | "ESCALAR" | "PMAX">("all");
  const [biSortField, setBiSortField] = useState<"cost" | "clicks" | "impressions" | "whatsappLeads" | "whatsappSalesCount" | "roas" | "profit">("cost");
  const [biSortDir, setBiSortDir] = useState<"desc" | "asc">("desc");
  const [isRefreshingBi, setIsRefreshingBi] = useState(false);
  const [copiedNegativesFeedback, setCopiedNegativesFeedback] = useState<string | null>(null);
  const [editingAdjustmentLeadId, setEditingAdjustmentLeadId] = useState<string | null>(null);
  const [adjustmentValueDraft, setAdjustmentValueDraft] = useState<string>("");
  const [isSendingAdjustment, setIsSendingAdjustment] = useState(false);
  const [adjustmentFeedback, setAdjustmentFeedback] = useState<string | null>(null);

  const [entitiesStatus, setEntitiesStatus] = useState<{
    apiConnected: boolean;
    apiVersionUsed?: string;
    campaignsCount: number;
    adGroupsCount: number;
    mappedKeysCount?: number;
    lastSyncAt?: string;
    lastAttemptAt?: string;
    lastError?: string | null;
    missingEnvVars?: string[];
    storageDir?: string;
    isPersistentStorage?: boolean;
    leadsCount?: number;
    lastLeadAt?: string | null;
    ociStats?: { queued: number; sent: number; failed: number };
    uazapiStatus?: {
      configured: boolean;
      source?: string;
      baseUrl?: string;
      instancesCount?: number;
      hasSingleToken?: boolean;
      hasJosiToken?: boolean;
      hasSergioToken?: boolean;
      singleTokenMasked?: string;
      josiTokenMasked?: string;
      sergioTokenMasked?: string;
      lastSyncAt?: string | null;
      lastError?: string | null;
      recoveredCount?: number;
      updatedCount?: number;
      checkedMessagesCount?: number;
      instanceStatuses?: Array<{
        name: string;
        connected: boolean | null;
        state: string;
        phone?: string;
        checkedMessages?: number;
        recovered?: number;
        updated?: number;
        error?: string | null;
      }>;
    };
  }>({
    apiConnected: false,
    campaignsCount: 0,
    adGroupsCount: 0,
    lastError: null,
    missingEnvVars: [],
    isPersistentStorage: true,
    ociStats: { queued: 0, sent: 0, failed: 0 },
  });
  const [backendFetchError, setBackendFetchError] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filtros Globais da Aba 1 (com filtro de datas padrão brasileiro igual ao Meta Ads)
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterAttendant, setFilterAttendant] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [leadsDatePreset, setLeadsDatePreset] = useState<DatePreset>("all");
  const [leadsStartDate, setLeadsStartDate] = useState("");
  const [leadsEndDate, setLeadsEndDate] = useState("");

  // FILTROS CUSTOMIZÁVEIS DA ABA VISÃO GERAL & RELATÓRIOS
  const [reportDatePreset, setReportDatePreset] = useState<DatePreset>("all");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportCampaign, setReportCampaign] = useState("all");
  const [reportAdGroup, setReportAdGroup] = useState("all");
  const [reportAttendant, setReportAttendant] = useState("all");
  const [reportStage, setReportStage] = useState("all");

  // Regras Dinâmicas de Conversão (Frases + Etiquetas WhatsApp Business — Exclusivas do Gestor)
  const [rules, setRules] = useState<ConversionRules>({
    quote: {
      actionName: "WhatsApp - Orçamento Enviado",
      phrases: ["orçamento enviado", "orcamento enviado", "segue o orçamento", "proposta enviada", "segue seu orçamento"],
      labels: [],
    },
    purchase: {
      actionName: "WhatsApp - Compra Realizada",
      phrases: ["pedido fechado", "compra realizada", "venda confirmada", "pedido confirmado", "segue copia do pedido"],
      labels: [],
    },
  });

  const [newQuotePhrase, setNewQuotePhrase] = useState("");
  const [newPurchasePhrase, setNewPurchasePhrase] = useState("");
  const [newQuoteLabel, setNewQuoteLabel] = useState("");
  const [newPurchaseLabel, setNewPurchaseLabel] = useState("");
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [rulesErrorMsg, setRulesErrorMsg] = useState<string | null>(null);
  const lastRulesEditRef = useRef<number>(0);
  const isSavingRulesRef = useRef<boolean>(false);

  // Configuração da Reconciliação Automática WhatsApp (Uazapi Pull Sync + Teste Ao Vivo + Etiquetas)
  const [uazapiBaseUrl, setUazapiBaseUrl] = useState("");
  const [uazapiSingleToken, setUazapiSingleToken] = useState("");
  const [uazapiJosiToken, setUazapiJosiToken] = useState("");
  const [uazapiSergioToken, setUazapiSergioToken] = useState("");
  const [isSavingUazapi, setIsSavingUazapi] = useState(false);
  const [uazapiFeedback, setUazapiFeedback] = useState<string | null>(null);
  const uazapiConfigLoadedRef = useRef<boolean>(false);
  const [editingUazapiTokens, setEditingUazapiTokens] = useState(false);
  const [availableWaLabels, setAvailableWaLabels] = useState<Array<{ id?: string; name: string }>>([]);
  const [isTestingUazapi, setIsTestingUazapi] = useState(false);
  const [uazapiTestResult, setUazapiTestResult] = useState<any>(null);
  const [showAdvancedTech, setShowAdvancedTech] = useState(false);
  const [closingSaleLeadId, setClosingSaleLeadId] = useState<string | null>(null);
  const [closingSaleValue, setClosingSaleValue] = useState<string>("1200");

  // Estados da Aba "Clientes & Acessos" (Exclusiva do Gestor)
  const [editingTenantSlug, setEditingTenantSlug] = useState<string | null>(null);
  const [tenantFormName, setTenantFormName] = useState("");
  const [tenantFormSlug, setTenantFormSlug] = useState("");
  const [tenantFormCustomerId, setTenantFormCustomerId] = useState("");
  const [tenantFormRoutingMode, setTenantFormRoutingMode] = useState<"single" | "roulette">("single");
  const [tenantFormInitialMsg, setTenantFormInitialMsg] = useState("Olá! Gostaria de solicitar um orçamento.");
  const [tenantFormAttendantName, setTenantFormAttendantName] = useState("Atendimento Principal");
  const [tenantFormAttendantPhone, setTenantFormAttendantPhone] = useState("55");
  const [tenantFormUazapiBase, setTenantFormUazapiBase] = useState("");
  const [tenantFormUazapiToken, setTenantFormUazapiToken] = useState("");
  const [tenantFormRouletteAttendants, setTenantFormRouletteAttendants] = useState<
    Array<{ name: string; phone: string; uazapiToken: string }>
  >([
    { name: "Atendente 1", phone: "55", uazapiToken: "" },
    { name: "Atendente 2", phone: "55", uazapiToken: "" },
  ]);
  const [isSavingTenant, setIsSavingTenant] = useState(false);
  const [tenantFormFeedback, setTenantFormFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tenantFormTestResult, setTenantFormTestResult] = useState<any>(null);
  const [isTestingTenantFormUazapi, setIsTestingTenantFormUazapi] = useState(false);

  // Acessos do Portal do Cliente (Passo M4) gerenciados pelo Gestor
  const [accessTargetSlug, setAccessTargetSlug] = useState<string>("cnac");
  const [clientUserUsername, setClientUserUsername] = useState("");
  const [clientUserDisplayName, setClientUserDisplayName] = useState("");
  const [clientUserPassword, setClientUserPassword] = useState("");
  const [isSavingClientUser, setIsSavingClientUser] = useState(false);
  const [clientUserFeedback, setClientUserFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copiedHelperMsg, setCopiedHelperMsg] = useState<string | null>(null);

  const handleDownloadBackup = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(leadEvents, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `backup_google_leads_${activeTenantSlug}_${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleDeleteLead = async (id: string) => {
    if (!confirm("Deseja realmente remover este lead?")) return;
    try {
      const res = await fetch(
        `/api/google-ads/leads?client=${encodeURIComponent(activeTenantSlug)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error("Erro ao deletar lead:", err);
    }
  };

  const handleCleanAttendantLeads = async () => {
    if (!confirm("Remover registros gravados acidentalmente com telefones dos próprios atendentes?")) return;
    try {
      const res = await fetch(
        `/api/google-ads/leads?client=${encodeURIComponent(activeTenantSlug)}&action=clean_attendants`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error("Erro ao limpar leads:", err);
    }
  };

  // Verificação dinâmica de números dos atendentes do cliente selecionado
  const activeAttendantPhones = useMemo(() => {
    const list: string[] = [];
    const sourceAttendants =
      activeTenant?.attendants && activeTenant.attendants.length > 0 ? activeTenant.attendants : attendants;
    sourceAttendants.forEach((a) => {
      const p = String(a.phone || "").replace(/\D/g, "");
      if (p) {
        list.push(p);
        if (p.startsWith("55") && p.length >= 12) list.push(p.slice(2));
      }
    });
    return list;
  }, [activeTenant, attendants]);

  const isAttendantLead = (phone: string): boolean => {
    const p = String(phone || "").replace(/\D/g, "");
    if (!p) return false;
    return activeAttendantPhones.some(
      (att) => p === att || (p.length >= 8 && att.length >= 8 && p.slice(-8) === att.slice(-8))
    );
  };

  const isWaitingWhatsApp = (phone?: string): boolean => {
    const p = String(phone || "").trim();
    return !p || /aguardando/i.test(p);
  };

  // Identificação Infalível de Leads Reais do Google Ads:
  // Preserva todo clique pago real (com GCLID ou Palavra-Chave) e descarta bots/healthchecks sem anúncio
  const isRealGoogleLead = (l: any): boolean => {
    const hasGclid = Boolean(l.gclid && l.gclid !== "sem_gclid");
    const hasKeyword = Boolean(l.keyword && l.keyword !== "Direto (Sem palavra-chave)" && l.keyword !== "Pesquisa Google");
    const hasRealPhone = Boolean(l.leadPhone && !isAttendantLead(l.leadPhone) && !isWaitingWhatsApp(l.leadPhone));
    return hasGclid || hasKeyword || hasRealPhone;
  };

  // Central OCI v25/v26: Diagnóstico Oficial, Enhanced Conversions & Retry Inteligente
  const [isSyncingOci, setIsSyncingOci] = useState(false);
  const [ociSyncResult, setOciSyncResult] = useState<any>(null);
  const [ociDiagnostics, setOciDiagnostics] = useState<any>(null);
  const [isRefreshingOciDiag, setIsRefreshingOciDiag] = useState(false);
  const [ociActionMapDraft, setOciActionMapDraft] = useState<{
    conversa_iniciada: string;
    orcamento_enviado: string;
    compra_realizada: string;
  }>({
    conversa_iniciada: "",
    orcamento_enviado: "",
    compra_realizada: "",
  });
  const [isSavingOciMapping, setIsSavingOciMapping] = useState(false);
  const [ociMappingFeedback, setOciMappingFeedback] = useState<string | null>(null);
  const ociActionMapLoadedRef = useRef<boolean>(false);
  const lastAutoOciTriggerRef = useRef<number>(0);

  const fetchOciDiagnostics = async (forceRefresh = false, slugOverride?: string) => {
    const targetSlug = slugOverride || activeTenantSlug;
    if (forceRefresh) setIsRefreshingOciDiag(true);
    try {
      const res = await fetch(
        `/api/google-ads/oci?client=${encodeURIComponent(targetSlug)}${forceRefresh ? "&refresh=true" : ""}`
      );
      if (res.ok) {
        const data = await res.json();
        setOciDiagnostics(data);
        if (!ociActionMapLoadedRef.current && data?.actionMapping) {
          ociActionMapLoadedRef.current = true;
          setOciActionMapDraft({
            conversa_iniciada: data.actionMapping.conversa_iniciada || "",
            orcamento_enviado: data.actionMapping.orcamento_enviado || "",
            compra_realizada: data.actionMapping.compra_realizada || "",
          });
        }
        // Disparo automático seguro para conversões que já completaram maturação de 4h
        const readyCount = Number(data?.stats?.readyToUpload || 0);
        if (readyCount > 0 && Date.now() - lastAutoOciTriggerRef.current > 2 * 60 * 1000) {
          lastAutoOciTriggerRef.current = Date.now();
          fetch(`/api/google-ads/oci?client=${encodeURIComponent(targetSlug)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "auto", clientSlug: targetSlug }),
          })
            .then((r) => r.json())
            .then((autoRes) => {
              if (autoRes && (autoRes.uploadedCount > 0 || autoRes.failedCount > 0)) {
                setOciSyncResult(autoRes);
                fetchData(false, targetSlug);
                fetch(`/api/google-ads/oci?client=${encodeURIComponent(targetSlug)}`)
                  .then((d) => d.json())
                  .then((refreshed) => setOciDiagnostics(refreshed))
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.error("Erro ao consultar diagnóstico OCI:", err);
    } finally {
      if (forceRefresh) setIsRefreshingOciDiag(false);
    }
  };

  const handleTriggerOciRetry = async (id?: string) => {
    setIsSyncingOci(true);
    try {
      const res = await fetch(`/api/google-ads/oci?client=${encodeURIComponent(activeTenantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "retry_failed", id, clientSlug: activeTenantSlug }),
      });
      const data = await res.json();
      setOciSyncResult(data);
      await Promise.all([fetchData(false), fetchOciDiagnostics(false)]);
    } catch (err) {
      console.error("Erro ao reenviar falhas OCI:", err);
    } finally {
      setIsSyncingOci(false);
    }
  };

  const handleSaveOciMapping = async () => {
    setIsSavingOciMapping(true);
    setOciMappingFeedback(null);
    try {
      const res = await fetch(`/api/google-ads/oci?client=${encodeURIComponent(activeTenantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_action_mapping",
          mapping: ociActionMapDraft,
          clientSlug: activeTenantSlug,
        }),
      });
      if (res.ok) {
        setOciMappingFeedback("Vínculo de ações de conversão salvo com sucesso!");
        await fetchOciDiagnostics(false);
        setTimeout(() => setOciMappingFeedback(null), 3500);
      } else {
        setOciMappingFeedback("Erro ao salvar vínculo de ações.");
      }
    } catch {
      setOciMappingFeedback("Falha de comunicação ao salvar vínculo.");
    } finally {
      setIsSavingOciMapping(false);
    }
  };

  const fetchTenants = async () => {
    try {
      const res = await fetch("/api/google-ads/tenants");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.tenants)) {
          setTenantsList(data.tenants);
          const current = data.tenants.find((t: ManagedTenant) => t.slug === activeTenantSlug);
          if (current?.attendants?.length) {
            setAttendants(
              current.attendants.map((a: ManagedTenantAttendant) => ({
                id: a.id,
                name: a.name,
                phone: a.phone,
                active: a.active !== false,
                leadsCount: 0,
              }))
            );
          }
        }
      }
    } catch {}
  };

  const handleSelectTenant = (slug: string) => {
    const clean = slugifyClientName(slug) || "cnac";
    setActiveTenantSlug(clean);
    setAccessTargetSlug(clean);
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha_google_active_tenant", clean);
    }
    uazapiConfigLoadedRef.current = false;
    ociActionMapLoadedRef.current = false;
    setUazapiBaseUrl("");
    setUazapiSingleToken("");
    setUazapiJosiToken("");
    setUazapiSergioToken("");
    setUazapiFeedback(null);
    setUazapiTestResult(null);
    setAvailableWaLabels([]);
    setFilterAttendant("all");
    setReportAttendant("all");
    setReportCampaign("all");
    setReportAdGroup("all");
    setLeadEvents([]);
    setAuditLogs([]);
    setOciSyncResult(null);
    setEditingAdjustmentLeadId(null);

    const found = tenantsList.find((t) => t.slug === clean);
    if (found?.attendants) {
      setAttendants(
        found.attendants.map((a) => ({
          id: a.id,
          name: a.name,
          phone: a.phone,
          active: a.active !== false,
          leadsCount: 0,
        }))
      );
    }
    void fetchData(false, clean);
    void fetchOciDiagnostics(false, clean);
  };

  // Carregar dados do cliente ativo (sincronização 100% automática no backend com cache 20m para BI Google)
  const fetchData = async (refreshBi = false, slugOverride?: string) => {
    const targetSlug = slugOverride || activeTenantSlug;
    setIsRefreshing(true);
    if (refreshBi) setIsRefreshingBi(true);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set("client", targetSlug);
      if (reportStartDate) queryParams.set("startDate", reportStartDate);
      if (reportEndDate) queryParams.set("endDate", reportEndDate);
      if (reportCampaign !== "all") queryParams.set("campaign", reportCampaign);
      if (reportAdGroup !== "all") queryParams.set("adGroup", reportAdGroup);
      if (reportAttendant !== "all") queryParams.set("attendant", reportAttendant);
      if (refreshBi) queryParams.set("refreshBi", "true");

      const clientQs = `client=${encodeURIComponent(targetSlug)}`;
      const [leadsRes, auditsRes, rulesRes, reportsRes, entitiesStatusRes] = await Promise.all([
        fetch(`/api/google-ads/leads?${clientQs}`),
        fetch(`/api/google-ads/leads?type=audits&${clientQs}`),
        fetch(`/api/google-ads/leads?type=rules&${clientQs}`),
        fetch(`/api/google-ads/reports?${queryParams.toString()}`),
        fetch(`/api/google-ads/leads?type=entities_status&${clientQs}`),
      ]);

      if (!leadsRes.ok) {
        setBackendFetchError(`Erro HTTP ${leadsRes.status} ao consultar /api/google-ads/leads`);
      } else {
        setBackendFetchError(null);
      }

      if (leadsRes.ok) {
        const data = await leadsRes.json();
        if (Array.isArray(data)) {
          setLeadEvents(data);
        }
      }
      if (auditsRes.ok) {
        const data = await auditsRes.json();
        if (Array.isArray(data)) setAuditLogs(data);
      }
      if (rulesRes.ok) {
        const data = await rulesRes.json();
        const canApplyPollRules =
          !isSavingRulesRef.current && Date.now() - lastRulesEditRef.current > 12000;
        if (canApplyPollRules && data && data.quote && data.purchase) {
          setRules({
            quote: {
              actionName: data.quote.actionName || "WhatsApp - Orçamento Enviado",
              phrases: Array.isArray(data.quote.phrases) ? data.quote.phrases : [],
              labels: Array.isArray(data.quote.labels) ? data.quote.labels : [],
            },
            purchase: {
              actionName: data.purchase.actionName || "WhatsApp - Compra Realizada",
              phrases: Array.isArray(data.purchase.phrases) ? data.purchase.phrases : [],
              labels: Array.isArray(data.purchase.labels) ? data.purchase.labels : [],
            },
          });
        }
      }
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        if (data) setReportsData(data);
      }
      if (entitiesStatusRes.ok) {
        const data = await entitiesStatusRes.json();
        if (data) {
          setEntitiesStatus(data);
          if (!uazapiConfigLoadedRef.current && data.uazapiStatus) {
            uazapiConfigLoadedRef.current = true;
            if (data.uazapiStatus.baseUrl) setUazapiBaseUrl(data.uazapiStatus.baseUrl);
            if (data.uazapiStatus.singleTokenMasked) setUazapiSingleToken(data.uazapiStatus.singleTokenMasked);
            if (data.uazapiStatus.josiTokenMasked) setUazapiJosiToken(data.uazapiStatus.josiTokenMasked);
            if (data.uazapiStatus.sergioTokenMasked) setUazapiSergioToken(data.uazapiStatus.sergioTokenMasked);
          }
        }
      }
    } catch (e: any) {
      console.error("Erro ao carregar dados:", e);
      setBackendFetchError(e?.message || "Falha de comunicação com o backend");
    } finally {
      if (refreshBi) setIsRefreshingBi(false);
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  const handleCopyNegativeTerms = async () => {
    const terms = (reportsData.searchTerms || [])
      .filter((t: any) => t.recommendation === "NEGATIVAR")
      .map((t: any) => `[${t.searchTerm}]`);
    if (terms.length === 0) {
      setCopiedNegativesFeedback("Nenhum termo crítico para negativar no período selecionado.");
      setTimeout(() => setCopiedNegativesFeedback(null), 3000);
      return;
    }
    const text = terms.join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    setCopiedNegativesFeedback(`${terms.length} termo(s) em correspondência exata copiado(s) para colar nas Palavras Negativas do Google Ads!`);
    setTimeout(() => setCopiedNegativesFeedback(null), 4000);
  };

  const handleSendConversionAdjustment = async (
    leadId: string,
    adjustmentType: "RESTATEMENT" | "RETRACTION",
    adjustedValue?: number
  ) => {
    setIsSendingAdjustment(true);
    setAdjustmentFeedback(null);
    try {
      const res = await fetch(`/api/google-ads/oci?client=${encodeURIComponent(activeTenantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upload_adjustment",
          clientSlug: activeTenantSlug,
          leadId,
          adjustmentType,
          adjustedValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setAdjustmentFeedback(
          `Ajuste ${adjustmentType} enviado com sucesso para o orderId ${data.orderId} (API ${data.apiVersionUsed}).`
        );
        setEditingAdjustmentLeadId(null);
        await Promise.all([fetchData(false), fetchOciDiagnostics(false)]);
      } else {
        setAdjustmentFeedback(`Erro ao enviar ajuste: ${data.error || "Falha na API"}`);
      }
    } catch {
      setAdjustmentFeedback("Erro de rede ao enviar ajuste de conversão.");
    } finally {
      setIsSendingAdjustment(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  useEffect(() => {
    fetchData(false);
    const interval = setInterval(() => fetchData(false), 4000);
    return () => clearInterval(interval);
  }, [activeTenantSlug, reportStartDate, reportEndDate, reportCampaign, reportAdGroup, reportAttendant]);

  useEffect(() => {
    fetchOciDiagnostics(false);
    const ociInterval = setInterval(() => {
      fetchOciDiagnostics(false);
    }, 30000);
    return () => clearInterval(ociInterval);
  }, [activeTenantSlug]);

  // Manipulador de Presets de Data (Visão Geral & Relatórios — horário de Brasília)
  const handleDatePresetChange = (preset: DatePreset) => {
    setReportDatePreset(preset);
    const range = getBrDateRangeForPreset(preset);
    setReportStartDate(range.start);
    setReportEndDate(range.end);
  };

  // Manipulador de Presets de Data da Aba 1 (Leads)
  const handleLeadsDatePresetChange = (preset: DatePreset) => {
    setLeadsDatePreset(preset);
    const range = getBrDateRangeForPreset(preset);
    setLeadsStartDate(range.start);
    setLeadsEndDate(range.end);
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("alpha_google_attendants", JSON.stringify(attendants));
    }
  }, [attendants]);

  // Persistência imediata das Regras Dinâmicas (Frases + Etiquetas WhatsApp Business — Exclusivas do Gestor)
  const persistRulesImmediately = async (nextRules: ConversionRules) => {
    lastRulesEditRef.current = Date.now();
    isSavingRulesRef.current = true;
    setIsSavingRules(true);
    setRulesErrorMsg(null);
    try {
      const res = await fetch(`/api/google-ads/leads?client=${encodeURIComponent(activeTenantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "save_rules", clientSlug: activeTenantSlug, rules: nextRules }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.rules) {
          setRules({
            quote: {
              actionName: data.rules.quote?.actionName || "WhatsApp - Orçamento Enviado",
              phrases: Array.isArray(data.rules.quote?.phrases) ? data.rules.quote.phrases : [],
              labels: Array.isArray(data.rules.quote?.labels) ? data.rules.quote.labels : [],
            },
            purchase: {
              actionName: data.rules.purchase?.actionName || "WhatsApp - Compra Realizada",
              phrases: Array.isArray(data.rules.purchase?.phrases) ? data.rules.purchase.phrases : [],
              labels: Array.isArray(data.rules.purchase?.labels) ? data.rules.purchase.labels : [],
            },
          });
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      } else {
        setRulesErrorMsg("Falha ao gravar regras no servidor.");
      }
    } catch (e) {
      console.error("Erro ao salvar regras:", e);
      setRulesErrorMsg("Erro de rede ao salvar regras.");
    } finally {
      isSavingRulesRef.current = false;
      setIsSavingRules(false);
    }
  };

  const handleAddPhrase = (type: "quote" | "purchase", phrase: string) => {
    const clean = phrase.trim().toLowerCase();
    if (!clean) return;
    if (rules[type].phrases.some((p) => p.trim().toLowerCase() === clean)) {
      if (type === "quote") setNewQuotePhrase("");
      if (type === "purchase") setNewPurchasePhrase("");
      return;
    }

    lastRulesEditRef.current = Date.now();
    const updated: ConversionRules = {
      ...rules,
      [type]: {
        ...rules[type],
        phrases: [...rules[type].phrases, clean],
      },
    };
    setRules(updated);

    if (type === "quote") setNewQuotePhrase("");
    if (type === "purchase") setNewPurchasePhrase("");
    void persistRulesImmediately(updated);
  };

  const handleRemovePhrase = (type: "quote" | "purchase", phraseToRemove: string) => {
    lastRulesEditRef.current = Date.now();
    const updated: ConversionRules = {
      ...rules,
      [type]: {
        ...rules[type],
        phrases: rules[type].phrases.filter((p) => p !== phraseToRemove),
      },
    };
    setRules(updated);
    void persistRulesImmediately(updated);
  };

  const handleAddLabelRule = (type: "quote" | "purchase", rawLabel: string) => {
    const clean = rawLabel.trim();
    if (!clean) return;
    const currentLabels = Array.isArray(rules[type].labels) ? rules[type].labels : [];
    if (currentLabels.some((l) => l.trim().toLowerCase() === clean.toLowerCase())) {
      if (type === "quote") setNewQuoteLabel("");
      if (type === "purchase") setNewPurchaseLabel("");
      return;
    }

    lastRulesEditRef.current = Date.now();
    const updated: ConversionRules = {
      ...rules,
      [type]: {
        ...rules[type],
        labels: [...currentLabels, clean],
      },
    };
    setRules(updated);
    if (type === "quote") setNewQuoteLabel("");
    if (type === "purchase") setNewPurchaseLabel("");
    void persistRulesImmediately(updated);
  };

  const handleRemoveLabelRule = (type: "quote" | "purchase", labelToRemove: string) => {
    lastRulesEditRef.current = Date.now();
    const currentLabels = Array.isArray(rules[type].labels) ? rules[type].labels : [];
    const updated: ConversionRules = {
      ...rules,
      [type]: {
        ...rules[type],
        labels: currentLabels.filter((l) => l !== labelToRemove),
      },
    };
    setRules(updated);
    void persistRulesImmediately(updated);
  };

  const handleSaveRules = async () => {
    await persistRulesImmediately(rules);
  };

  const handleTestLiveUazapi = async () => {
    setIsTestingUazapi(true);
    setUazapiFeedback(null);
    try {
      const res = await fetch(`/api/google-ads/uazapi-test?client=${encodeURIComponent(activeTenantSlug)}`);
      const data = await res.json().catch(() => null);
      if (data) {
        setUazapiTestResult(data);
        if (Array.isArray(data.availableLabels)) {
          setAvailableWaLabels(data.availableLabels);
        }
        const okCount = Array.isArray(data.instances)
          ? data.instances.filter((i: any) => i.connected).length
          : 0;
        setUazapiFeedback(
          data.anyConnected
            ? `Conexão Uazapi ativa (${okCount} instância(s) conectada(s))! ${data.availableLabels?.length || 0} etiqueta(s) do WhatsApp Business carregada(s).`
            : "Uazapi configurada, mas nenhuma instância respondeu como conectada neste teste."
        );
      }
    } catch {
      setUazapiFeedback("Erro ao testar conexão Uazapi ao vivo.");
    } finally {
      setIsTestingUazapi(false);
    }
  };

  const handleSaveUazapiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingUazapi(true);
    setUazapiFeedback(null);
    try {
      const isSingleMode = activeTenant?.routingMode === "single";
      const res = await fetch(`/api/google-ads/leads?client=${encodeURIComponent(activeTenantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "save_uazapi_config",
          clientSlug: activeTenantSlug,
          baseUrl: uazapiBaseUrl.trim(),
          singleToken: isSingleMode ? uazapiSingleToken.trim() : undefined,
          josiToken: !isSingleMode ? uazapiJosiToken.trim() : undefined,
          sergioToken: !isSingleMode ? uazapiSergioToken.trim() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const rec = data.syncResult?.recoveredCount || 0;
        const upd = data.syncResult?.updatedCount || 0;
        setUazapiFeedback(
          data.syncResult?.lastError
            ? `Configuração salva, mas Uazapi retornou: ${data.syncResult.lastError}`
            : `Reconciliação Uazapi ativa! Verificação concluída (${rec} leads recuperados, ${upd} atualizados).`
        );
        await Promise.all([fetchData(false), fetchTenants(), handleTestLiveUazapi()]);
      } else {
        setUazapiFeedback(data.error || "Falha ao salvar configuração da Uazapi.");
      }
    } catch (err: any) {
      setUazapiFeedback(err?.message || "Erro ao conectar com o servidor.");
    } finally {
      setIsSavingUazapi(false);
    }
  };

  const handleTriggerUazapiReconcile = async () => {
    setIsSavingUazapi(true);
    setUazapiFeedback(null);
    try {
      const res = await fetch(`/api/google-ads/leads?client=${encodeURIComponent(activeTenantSlug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile_uazapi", clientSlug: activeTenantSlug }),
      });
      const data = await res.json().catch(() => ({}));
      const rec = data.recoveredCount || 0;
      const upd = data.updatedCount || 0;
      const disconnectedList = Array.isArray(data.instanceStatuses)
        ? data.instanceStatuses.filter((s: any) => s.connected === false).map((s: any) => s.name)
        : [];

      if (data.lastError) {
        setUazapiFeedback(`Aviso Uazapi: ${data.lastError}`);
      } else if (rec > 0 || upd > 0) {
        setUazapiFeedback(`Sincronização concluída! ${rec} lead(s) recuperado(s) e ${upd} conversa(s) atualizada(s).`);
      } else if (disconnectedList.length > 0) {
        setUazapiFeedback(
          `Nenhuma conversa pendente encontrada (${disconnectedList.join(", ")} está desconectada na Uazapi — reconecte o WhatsApp para puxar o histórico).`
        );
      } else {
        setUazapiFeedback("Histórico conferido! Nenhuma conversa pendente nova encontrada.");
      }
      await fetchData(false);
    } catch {
      setUazapiFeedback("Erro ao executar reconciliação Uazapi.");
    } finally {
      setIsSavingUazapi(false);
    }
  };

  // Handlers de Gerenciamento de Clientes & Acessos (Aba 7 — Gestor)
  const resetTenantForm = () => {
    setEditingTenantSlug(null);
    setTenantFormName("");
    setTenantFormSlug("");
    setTenantFormCustomerId("");
    setTenantFormRoutingMode("single");
    setTenantFormInitialMsg("Olá! Gostaria de solicitar um orçamento.");
    setTenantFormAttendantName("Atendimento Principal");
    setTenantFormAttendantPhone("55");
    setTenantFormUazapiBase(uazapiBaseUrl || "");
    setTenantFormUazapiToken("");
    setTenantFormRouletteAttendants([
      { name: "Atendente 1", phone: "55", uazapiToken: "" },
      { name: "Atendente 2", phone: "55", uazapiToken: "" },
    ]);
    setTenantFormFeedback(null);
    setTenantFormTestResult(null);
  };

  const startEditingTenant = (t: ManagedTenant) => {
    setEditingTenantSlug(t.slug);
    setTenantFormName(t.name);
    setTenantFormSlug(t.slug);
    setTenantFormCustomerId(t.googleCustomerId || "");
    setTenantFormRoutingMode(t.routingMode === "roulette" ? "roulette" : "single");
    setTenantFormInitialMsg(t.initialMessage || "");
    setTenantFormAttendantName(t.attendants?.[0]?.name || t.name);
    setTenantFormAttendantPhone(t.attendants?.[0]?.phone || "55");
    setTenantFormUazapiBase(t.uazapi?.baseUrl || "");
    setTenantFormUazapiToken(t.uazapi?.singleTokenMasked || "");
    setTenantFormRouletteAttendants(
      t.attendants && t.attendants.length > 0
        ? t.attendants.map((a) => ({
            name: a.name,
            phone: a.phone,
            uazapiToken: a.tokenMasked || "",
          }))
        : [
            { name: "Atendente 1", phone: "55", uazapiToken: "" },
            { name: "Atendente 2", phone: "55", uazapiToken: "" },
          ]
    );
    setTenantFormFeedback(null);
    setTenantFormTestResult(null);
  };

  const handleTestTenantFormUazapi = async () => {
    setIsTestingTenantFormUazapi(true);
    setTenantFormTestResult(null);
    try {
      const tokenToSend =
        tenantFormRoutingMode === "single"
          ? tenantFormUazapiToken.trim()
          : tenantFormRouletteAttendants[0]?.uazapiToken?.trim() || "";
      const phoneToCheck =
        tenantFormRoutingMode === "single"
          ? tenantFormAttendantPhone
          : tenantFormRouletteAttendants[0]?.phone || "";
      const res = await fetch("/api/google-ads/uazapi-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientSlug: tenantFormSlug || editingTenantSlug || "novo",
          baseUrl: tenantFormUazapiBase.trim(),
          token: tokenToSend,
          attendantPhone: phoneToCheck,
          instanceName: tenantFormAttendantName || tenantFormName || "WhatsApp Principal",
        }),
      });
      const data = await res.json().catch(() => null);
      setTenantFormTestResult(data);
    } catch {
      setTenantFormTestResult({ success: false, error: "Erro de rede ao testar Uazapi." });
    } finally {
      setIsTestingTenantFormUazapi(false);
    }
  };

  const handleSaveTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTenant(true);
    setTenantFormFeedback(null);
    try {
      const isEdit = Boolean(editingTenantSlug);
      const payload: any = {
        action: isEdit ? "update_tenant" : "create_tenant",
        name: tenantFormName.trim(),
        slug: (editingTenantSlug || tenantFormSlug || slugifyClientName(tenantFormName)).trim(),
        googleCustomerId: tenantFormCustomerId.replace(/\D/g, ""),
        routingMode: tenantFormRoutingMode,
        initialMessage: tenantFormInitialMsg.trim(),
        uazapiBaseUrl: tenantFormUazapiBase.trim(),
      };
      if (tenantFormRoutingMode === "single") {
        payload.attendantName = tenantFormAttendantName.trim() || tenantFormName.trim();
        payload.attendantPhone = tenantFormAttendantPhone.replace(/\D/g, "");
        payload.singleToken = tenantFormUazapiToken.trim();
      } else {
        payload.attendants = tenantFormRouletteAttendants.map((a) => ({
          name: a.name.trim(),
          phone: a.phone.replace(/\D/g, ""),
          uazapiToken: a.uazapiToken.trim(),
          active: true,
        }));
      }

      const res = await fetch("/api/google-ads/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const warnText =
          Array.isArray(data.phoneWarnings) && data.phoneWarnings.length > 0
            ? ` (Aviso DDI: ${data.phoneWarnings.join("; ")})`
            : "";
        setTenantFormFeedback({ ok: true, msg: `${data.message}${warnText}` });
        await fetchTenants();
        if (data.tenant?.slug) {
          setAccessTargetSlug(data.tenant.slug);
          if (!isEdit) resetTenantForm();
          setTenantFormFeedback({ ok: true, msg: `${data.message}${warnText}` });
        }
      } else {
        setTenantFormFeedback({ ok: false, msg: data.error || "Erro ao salvar cliente." });
      }
    } catch {
      setTenantFormFeedback({ ok: false, msg: "Falha de comunicação ao salvar cliente." });
    } finally {
      setIsSavingTenant(false);
    }
  };

  const handleSaveClientUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingClientUser(true);
    setClientUserFeedback(null);
    try {
      const res = await fetch("/api/google-ads/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_client_user",
          tenantSlug: accessTargetSlug,
          username: clientUserUsername.trim(),
          displayName: clientUserDisplayName.trim() || clientUserUsername.trim(),
          password: clientUserPassword,
          enablePortal: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setClientUserFeedback({ ok: true, msg: data.message });
        setClientUserUsername("");
        setClientUserDisplayName("");
        setClientUserPassword("");
        await fetchTenants();
      } else {
        setClientUserFeedback({ ok: false, msg: data.error || "Erro ao salvar usuário do cliente." });
      }
    } catch {
      setClientUserFeedback({ ok: false, msg: "Erro de comunicação ao criar acesso." });
    } finally {
      setIsSavingClientUser(false);
    }
  };

  const handleToggleClientPortal = async (tenantSlug: string, enabled: boolean) => {
    try {
      await fetch("/api/google-ads/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_client_access", tenantSlug, enabled }),
      });
      await fetchTenants();
    } catch {}
  };

  const handleDeleteClientUser = async (tenantSlug: string, userId: string) => {
    if (!confirm("Remover este login de acesso do cliente?")) return;
    try {
      await fetch("/api/google-ads/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_client_user", tenantSlug, userId }),
      });
      await fetchTenants();
    } catch {}
  };

  const handleDeleteTenant = async (slug: string, name: string) => {
    if (!confirm(`Remover o cliente "${name}" (/r/${slug}) do painel?`)) return;
    try {
      const res = await fetch(`/api/google-ads/tenants?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchTenants();
        if (activeTenantSlug === slug) {
          handleSelectTenant("cnac");
        }
      }
    } catch {}
  };

  // Movimentação do Funil via PATCH
  const updateLeadStage = async (id: string, newStage: GoogleLeadEvent["stage"], value?: number) => {
    setLeadEvents((prev) =>
      prev.map((l) => (l.id === id ? { ...l, stage: newStage, value: value !== undefined ? value : l.value } : l))
    );

    try {
      await fetch(`/api/google-ads/leads?client=${encodeURIComponent(activeTenantSlug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, stage: newStage, value, clientSlug: activeTenantSlug }),
      });
    } catch (err) {
      console.error("Falha ao atualizar etapa do lead:", err);
    }
  };

  // Filtro Infalível: Preserva 100% dos cliques reais e descarta bots
  const realLeadEvents = useMemo(() => {
    return leadEvents.filter(isRealGoogleLead);
  }, [leadEvents, activeAttendantPhones]);

  // Listas Dinâmicas de Opções para Filtros (ID + Nome Real via Google Ads API)
  const uniqueCampaigns = useMemo(() => {
    const map = new Map<string, string>();
    realLeadEvents.forEach((l) => {
      if (l.campaign) map.set(l.campaign, l.campaignName || l.campaign);
    });
    (reportsData.reports || []).forEach((r: any) => {
      if (r.campaignId && r.campaign) map.set(r.campaignId, r.campaign);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [realLeadEvents, reportsData.reports]);

  const uniqueAdGroups = useMemo(() => {
    const map = new Map<string, string>();
    realLeadEvents.forEach((l) => {
      if (l.adGroup) map.set(l.adGroup, l.adGroupName || l.adGroup);
    });
    (reportsData.reports || []).forEach((r: any) => {
      if (r.adGroupId && r.adGroup) map.set(r.adGroupId, r.adGroup);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [realLeadEvents, reportsData.reports]);

  const getEffectiveStage = (
    l: GoogleLeadEvent
  ): "clique_anuncio" | "conversa_iniciada" | "orcamento_enviado" | "compra_realizada" => {
    if (l.stage === "compra_realizada") return "compra_realizada";
    if (l.stage === "orcamento_enviado") return "orcamento_enviado";
    if (
      l.stage === "clique_anuncio" ||
      (!l.firstMessageAt && (isAttendantLead(l.leadPhone) || isWaitingWhatsApp(l.leadPhone)))
    ) {
      return "clique_anuncio";
    }
    return "conversa_iniciada";
  };

  // Leads filtrados para Visão Geral & Relatório Customizável (calendário BR)
  const filteredReportLeads = useMemo(() => {
    return realLeadEvents.filter((event) => {
      const eventDate = toBrDateKey(event.occurredAt || event.firstMessageAt);
      const matchesDate =
        (!reportStartDate || (eventDate && eventDate >= reportStartDate)) &&
        (!reportEndDate || (eventDate && eventDate <= reportEndDate));

      const matchesCampaign =
        reportCampaign === "all" || event.campaign === reportCampaign || event.campaignName === reportCampaign;
      const matchesAdGroup =
        reportAdGroup === "all" || event.adGroup === reportAdGroup || event.adGroupName === reportAdGroup;
      const matchesAttendant = reportAttendant === "all" || event.attendantName === reportAttendant;
      const currentLeadStage = getEffectiveStage(event);
      const matchesStage = reportStage === "all" || currentLeadStage === reportStage;

      return matchesDate && matchesCampaign && matchesAdGroup && matchesAttendant && matchesStage;
    });
  }, [realLeadEvents, reportStartDate, reportEndDate, reportCampaign, reportAdGroup, reportAttendant, reportStage]);

  // Métricas Consolidadas do Relatório & Visão Geral no Período (separando cliques de conversas reais)
  const reportMetrics = useMemo(() => {
    const totalClicksCount = filteredReportLeads.length;
    const clicksOnlyCount = filteredReportLeads.filter((l) => getEffectiveStage(l) === "clique_anuncio").length;
    const totalLeadsCount = filteredReportLeads.filter((l) => getEffectiveStage(l) !== "clique_anuncio").length;
    const clickToChatRate = totalClicksCount > 0 ? Math.round((totalLeadsCount / totalClicksCount) * 100) : 0;
    const quotesCount = filteredReportLeads.filter((l) => {
      const st = getEffectiveStage(l);
      return st === "orcamento_enviado" || st === "compra_realizada";
    }).length;
    const salesCount = filteredReportLeads.filter((l) => getEffectiveStage(l) === "compra_realizada").length;
    const totalRevenue = filteredReportLeads
      .filter((l) => getEffectiveStage(l) === "compra_realizada" && l.value)
      .reduce((acc, curr) => acc + (curr.value || 0), 0);
    const totalCost = reportsData.totalCost || 0;
    const profit = totalRevenue - totalCost;
    const roas = totalCost > 0 ? Number((totalRevenue / totalCost).toFixed(2)) : totalRevenue > 0 ? 99 : 0;
    const cpl = totalLeadsCount > 0 && totalCost > 0 ? Number((totalCost / totalLeadsCount).toFixed(2)) : 0;
    const averageTicket = salesCount > 0 ? Number((totalRevenue / salesCount).toFixed(2)) : 0;
    const conversionRate = totalLeadsCount > 0 ? Number(((salesCount / totalLeadsCount) * 100).toFixed(1)) : 0;

    return {
      totalClicksCount,
      clicksOnlyCount,
      totalLeadsCount,
      clickToChatRate,
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

  // Dados agregados da Visão Geral (gráfico diário, funil, campanhas e atendentes no período)
  const overviewStats = useMemo(() => {
    const quoteFromChatsRate =
      reportMetrics.totalLeadsCount > 0 ? Math.round((reportMetrics.quotesCount / reportMetrics.totalLeadsCount) * 100) : 0;
    const salesFromQuotesRate =
      reportMetrics.quotesCount > 0 ? Math.round((reportMetrics.salesCount / reportMetrics.quotesCount) * 100) : 0;

    // Evolução diária (até 7 dias mais recentes com movimento ou últimos 7 dias BR)
    const dayMap = new Map<string, { dateKey: string; label: string; clicks: number; realChats: number; sales: number }>();
    filteredReportLeads.forEach((l) => {
      const dk = toBrDateKey(l.occurredAt || l.firstMessageAt);
      if (!dk) return;
      if (!dayMap.has(dk)) {
        dayMap.set(dk, { dateKey: dk, label: formatBrDateShort(dk), clicks: 0, realChats: 0, sales: 0 });
      }
      const entry = dayMap.get(dk)!;
      entry.clicks += 1;
      const st = getEffectiveStage(l);
      if (st !== "clique_anuncio") entry.realChats += 1;
      if (st === "compra_realizada") entry.sales += 1;
    });
    const dailySeries = Array.from(dayMap.values())
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(-7);
    const maxDailyClicks = Math.max(1, ...dailySeries.map((d) => d.clicks));

    // Campanhas consolidadas no período
    const campMap = new Map<
      string,
      {
        campaign: string;
        cost: number;
        adButtonClicks: number;
        whatsappLeads: number;
        whatsappQuotes: number;
        whatsappSalesCount: number;
        whatsappRevenue: number;
      }
    >();
    (reportsData.reports || []).forEach((r: any) => {
      const name = String(r.campaign || "Campanha Pesquisa");
      if (!campMap.has(name)) {
        campMap.set(name, {
          campaign: name,
          cost: 0,
          adButtonClicks: 0,
          whatsappLeads: 0,
          whatsappQuotes: 0,
          whatsappSalesCount: 0,
          whatsappRevenue: 0,
        });
      }
      const c = campMap.get(name)!;
      c.cost += Number(r.cost || 0);
      c.adButtonClicks += Number(r.adButtonClicks || 0);
      c.whatsappLeads += Number(r.whatsappLeads || 0);
      c.whatsappQuotes += Number(r.whatsappQuotes || 0);
      c.whatsappSalesCount += Number(r.whatsappSalesCount || 0);
      c.whatsappRevenue += Number(r.whatsappRevenue || 0);
    });
    const campaignSummary = Array.from(campMap.values())
      .map((c) => ({
        ...c,
        cpl: c.whatsappLeads > 0 && c.cost > 0 ? Number((c.cost / c.whatsappLeads).toFixed(2)) : 0,
        roas: c.cost > 0 ? Number((c.whatsappRevenue / c.cost).toFixed(2)) : c.whatsappRevenue > 0 ? 99 : 0,
      }))
      .sort((a, b) => b.cost - a.cost || b.whatsappLeads - a.whatsappLeads);

    // Lista unificada de atendentes do cliente selecionado
    const baseNames = (
      activeTenant?.attendants && activeTenant.attendants.length > 0
        ? activeTenant.attendants.map((a) => a.name)
        : attendants.map((a) => a.name)
    ).filter(Boolean);
    const seenAtt = new Set<string>();
    const attendantsPeriod: Array<{
      name: string;
      clicks: number;
      chats: number;
      quotes: number;
      sales: number;
      chatRate: number;
    }> = [];

    const addAttStat = (displayName: string) => {
      const norm = displayName.trim().toLowerCase();
      if (!norm || seenAtt.has(norm)) return;
      seenAtt.add(norm);
      const list = filteredReportLeads.filter((l) => {
        const ln = String(l.attendantName || "").toLowerCase();
        return ln === norm || ln.includes(norm) || norm.includes(ln);
      });
      const clicks = list.length;
      const chats = list.filter((l) => getEffectiveStage(l) !== "clique_anuncio").length;
      const quotes = list.filter((l) => {
        const st = getEffectiveStage(l);
        return st === "orcamento_enviado" || st === "compra_realizada";
      }).length;
      const sales = list.filter((l) => getEffectiveStage(l) === "compra_realizada").length;
      const chatRate = clicks > 0 ? Math.round((chats / clicks) * 100) : 0;
      attendantsPeriod.push({ name: displayName, clicks, chats, quotes, sales, chatRate });
    };

    baseNames.forEach(addAttStat);
    filteredReportLeads.forEach((l) => {
      if (l.attendantName) addAttStat(l.attendantName);
    });

    const recentConversations = [
      ...filteredReportLeads.filter((l) => getEffectiveStage(l) !== "clique_anuncio"),
      ...filteredReportLeads.filter((l) => getEffectiveStage(l) === "clique_anuncio"),
    ].slice(0, 6);

    return {
      quoteFromChatsRate,
      salesFromQuotesRate,
      dailySeries,
      maxDailyClicks,
      campaignSummary,
      attendantsPeriod,
      recentConversations,
    };
  }, [filteredReportLeads, reportsData.reports, reportMetrics, activeTenant, attendants]);

  const attendantFilterOptions = useMemo(() => {
    const names = new Set<string>();
    (activeTenant?.attendants || attendants).forEach((a) => {
      if (a.name) names.add(a.name);
    });
    realLeadEvents.forEach((l) => {
      if (l.attendantName) names.add(l.attendantName);
    });
    return Array.from(names);
  }, [activeTenant, attendants, realLeadEvents]);

  // Exportar Relatório para CSV
  const handleExportCSV = () => {
    const headers = ["Data", "Nome", "Telefone", "Campanha", "Conjunto", "Palavra-Chave", "Atendente", "Etapa", "Valor R$"];
    const rows = filteredReportLeads.map((l) => [
      formatBrDateTime(l.occurredAt),
      `"${l.leadName || "Cliente"}"`,
      l.leadPhone,
      `"${l.campaignName || l.campaign}"`,
      `"${l.adGroupName || l.adGroup}"`,
      `"${l.keyword}"`,
      `"${l.attendantName}"`,
      getEffectiveStage(l),
      l.value || 0,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_google_ads_${toBrDateKey(new Date())}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Contadores Globais (Cliques no Anúncio vs Conversas Reais no WhatsApp)
  const totalLeads = realLeadEvents.length;
  const apenasCliques = realLeadEvents.filter((l) => getEffectiveStage(l) === "clique_anuncio").length;
  const conversasTotais = realLeadEvents.filter((l) => getEffectiveStage(l) !== "clique_anuncio").length;
  const conversasEmAberto = realLeadEvents.filter((l) => getEffectiveStage(l) === "conversa_iniciada").length;
  const orcamentosTotais = realLeadEvents.filter((l) => {
    const st = getEffectiveStage(l);
    return st === "orcamento_enviado" || st === "compra_realizada";
  }).length;
  const orcamentosEnviados = realLeadEvents.filter((l) => getEffectiveStage(l) === "orcamento_enviado").length;
  const comprasRealizadas = realLeadEvents.filter((l) => getEffectiveStage(l) === "compra_realizada").length;
  const chatStartRate = totalLeads > 0 ? Math.round((conversasTotais / totalLeads) * 100) : 0;
  const faturamentoTotal = realLeadEvents
    .filter((l) => getEffectiveStage(l) === "compra_realizada" && l.value)
    .reduce((acc, curr) => acc + (curr.value || 0), 0);

  const filteredEvents = useMemo(() => {
    return realLeadEvents.filter((event) => {
      const eventDate = toBrDateKey(event.occurredAt || event.firstMessageAt);
      const matchesDate =
        (!leadsStartDate || (eventDate && eventDate >= leadsStartDate)) &&
        (!leadsEndDate || (eventDate && eventDate <= leadsEndDate));

      const term = filterKeyword.toLowerCase().trim();
      const matchesSearch =
        !term ||
        (event.leadName && event.leadName.toLowerCase().includes(term)) ||
        event.leadPhone.includes(term) ||
        event.keyword.toLowerCase().includes(term) ||
        event.campaign.toLowerCase().includes(term) ||
        (event.campaignName && event.campaignName.toLowerCase().includes(term)) ||
        event.adGroup.toLowerCase().includes(term) ||
        (event.adGroupName && event.adGroupName.toLowerCase().includes(term));

      const matchesAttendant = filterAttendant === "all" || event.attendantName === filterAttendant;
      const currentLeadStage = getEffectiveStage(event);
      const matchesStage = filterStage === "all" || currentLeadStage === filterStage;

      return matchesDate && matchesSearch && matchesAttendant && matchesStage;
    });
  }, [realLeadEvents, leadsStartDate, leadsEndDate, filterKeyword, filterAttendant, filterStage]);

  const filteredLeadsSummary = useMemo(() => {
    const total = filteredEvents.length;
    const clicksOnly = filteredEvents.filter((l) => getEffectiveStage(l) === "clique_anuncio").length;
    const realChats = total - clicksOnly;
    return { total, clicksOnly, realChats };
  }, [filteredEvents]);

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
          padding: 5px;
          display: flex;
          gap: 6px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
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
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (min-width: 1200px) {
          .kanban-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }
      `}</style>

      {/* CABEÇALHO */}
      <div className="gads-header-block">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div className="gads-title-wrap">
                <span style={{ background: "#2563eb", borderRadius: "8px", padding: "6px", display: "inline-flex" }}>
                  <Send size={20} color="#fff" />
                </span>
                <h1 className="gads-title">Google Ads — Painel do Gestor</h1>
              </div>
              <span className="gads-badge-iso">
                <ShieldCheck size={13} /> 100% Isolado da Meta Ads
              </span>
            </div>
            <p className="gads-subtitle">
              Gerenciamento multi-cliente via MCC, atribuição de palavras-chave, funil CRM, regras exclusivas do gestor e controle de acessos.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {/* SELETOR DE CLIENTE GOOGLE ADS */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", padding: "4px 8px" }}>
              <Building2 size={14} color="#38bdf8" />
              <select
                value={activeTenantSlug}
                onChange={(e) => handleSelectTenant(e.target.value)}
                aria-label="Selecionar Cliente"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  outline: "none",
                  paddingRight: "6px",
                }}
              >
                {tenantsList.length === 0 ? (
                  <option value={activeTenantSlug} style={{ background: "#0f172a" }}>
                    {activeTenantSlug.toUpperCase()}
                  </option>
                ) : (
                  tenantsList.map((t) => (
                    <option key={t.slug} value={t.slug} style={{ background: "#0f172a" }}>
                      {t.name} ({t.routingMode === "single" ? "1 WhatsApp" : "Roleta"})
                    </option>
                  ))
                )}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                resetTenantForm();
                setCurrentTab("clientes");
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "9px 12px",
                borderRadius: "8px",
                background: "rgba(37, 99, 235, 0.16)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                color: "#7dd3fc",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Plus size={14} /> Novo Cliente
            </button>

            <Link
              href="/overview"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "9px 14px",
                borderRadius: "8px",
                background: "#0f172a",
                border: "1px solid #334155",
                color: "#e2e8f0",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              <ArrowLeft size={15} /> Voltar para Meta Ads
            </Link>
          </div>
        </div>

        {/* NAVEGAÇÃO ENTRE AS ABAS */}
        <div className="gads-tabs-bar">
          <button
            onClick={() => setCurrentTab("overview")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "overview" ? "#2563eb" : "transparent",
              color: currentTab === "overview" ? "#fff" : "#94a3b8",
            }}
          >
            <LayoutDashboard size={15} /> Visão Geral
          </button>
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
            <RefreshCw size={15} /> {activeTenant?.routingMode === "single" ? "4. Atendimento WhatsApp" : "4. Roleta de Atendentes"}
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
          <button
            onClick={() => setCurrentTab("bi")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "bi" ? "#059669" : "transparent",
              color: currentTab === "bi" ? "#fff" : "#34d399",
            }}
          >
            <Target size={15} /> 6. Inteligência & Decisão (BI)
          </button>
          <button
            onClick={() => setCurrentTab("clientes")}
            className="gads-tab-btn"
            style={{
              background: currentTab === "clientes" ? "#7c3aed" : "transparent",
              color: currentTab === "clientes" ? "#fff" : "#c084fc",
            }}
          >
            <Building2 size={15} /> 7. Clientes & Acessos
          </button>
        </div>

        {/* BARRA DE STATUS COMPACTA DO SISTEMA */}
        <div
          style={{
            background: "#090f20",
            border: `1px solid ${
              backendFetchError || (entitiesStatus.ociStats?.failed ?? 0) > 0
                ? "rgba(239, 68, 68, 0.45)"
                : !entitiesStatus.apiConnected || entitiesStatus.isPersistentStorage === false
                  ? "rgba(234, 179, 8, 0.4)"
                  : "rgba(16, 185, 129, 0.3)"
            }`,
            borderRadius: "10px",
            padding: "8px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            fontSize: "12px",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: 700,
                  color: entitiesStatus.apiConnected ? "#34d399" : "#fde047",
                }}
              >
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: entitiesStatus.apiConnected ? "#10b981" : "#eab308",
                    display: "inline-block",
                  }}
                />
                {entitiesStatus.apiConnected
                  ? `Google Ads Conectado (${entitiesStatus.apiVersionUsed || "v25"})`
                  : "Google Ads Offline"}
              </span>

              <span style={{ color: "#334155" }}>•</span>
              <span style={{ color: "#cbd5e1", fontWeight: 600 }}>
                {entitiesStatus.leadsCount ?? realLeadEvents.length} lead(s) rastreados
              </span>

              <span style={{ color: "#334155" }}>•</span>
              <span style={{ color: entitiesStatus.uazapiStatus?.configured ? "#34d399" : "#94a3b8", fontWeight: 600 }}>
                WhatsApp: {entitiesStatus.uazapiStatus?.configured ? "Webhook + Backup Uazapi Ativos" : "Webhook Ativo"}
              </span>
            </div>

            {(entitiesStatus.ociStats?.failed ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  setCurrentTab("conversoes");
                  setShowAdvancedTech(true);
                }}
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#fca5a5",
                  borderRadius: "6px",
                  padding: "3px 10px",
                  fontSize: "11px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                {entitiesStatus.ociStats?.failed} falha(s) no envio OCI — Ver na Aba 5
              </button>
            )}
          </div>

          {backendFetchError && (
            <div style={{ color: "#fca5a5", fontWeight: 600 }}>
              Erro no Backend Web: {backendFetchError}
            </div>
          )}

          {!entitiesStatus.apiConnected && (entitiesStatus.lastError || reportsData.apiError) && (
            <div style={{ color: "#fde047" }}>
              <strong>Diagnóstico Google Ads API:</strong> {entitiesStatus.lastError || reportsData.apiError}
            </div>
          )}

          {entitiesStatus.isPersistentStorage === false && (
            <div style={{ color: "#fde047" }}>
              <strong>Aviso de Persistência:</strong> O volume <code>/data</code> não está montado no serviço <code>web</code> do Dokploy.
            </div>
          )}
        </div>
      </div>

      {/* CARDS DE MÉTRICAS GLOBAIS (ocultos na Visão Geral para evitar repetição) */}
      {currentTab !== "overview" && (
        <div className="gads-metrics-grid">
          <div className="gads-metric-card">
            <span className="gads-metric-title" style={{ color: "#facc15" }}>
              1. Cliques no Anúncio <Users size={14} color="#facc15" />
            </span>
            <div className="gads-metric-val" style={{ color: "#ffffff" }}>
              {totalLeads}
            </div>
            <span className="gads-metric-sub">
              {apenasCliques} aguardando msg • {chatStartRate}% iniciou chat
            </span>
          </div>

          <div className="gads-metric-card">
            <span className="gads-metric-title" style={{ color: "#38bdf8" }}>
              2. Conversas Iniciadas <MessageSquare size={14} color="#38bdf8" />
            </span>
            <div className="gads-metric-val" style={{ color: "#38bdf8" }}>
              {conversasTotais}
            </div>
            <span className="gads-metric-sub">
              {conversasEmAberto} em atendimento (sem orçamento)
            </span>
          </div>

          <div className="gads-metric-card">
            <span className="gads-metric-title" style={{ color: "#a855f7" }}>
              3. Orçamentos Enviados <Award size={14} color="#a855f7" />
            </span>
            <div className="gads-metric-val" style={{ color: "#a855f7" }}>
              {orcamentosTotais}
            </div>
            <span className="gads-metric-sub">
              {orcamentosEnviados} em aberto • {comprasRealizadas} fechados
            </span>
          </div>

          <div className="gads-metric-card">
            <span className="gads-metric-title" style={{ color: "#10b981" }}>
              4. Vendas / Faturamento <DollarSign size={14} color="#10b981" />
            </span>
            <div className="gads-metric-val" style={{ color: "#10b981" }}>
              {faturamentoTotal > 0
                ? `R$ ${faturamentoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                : `${comprasRealizadas} Vendas`}
            </div>
            <span className="gads-metric-sub">{comprasRealizadas} venda(s) confirmada(s)</span>
          </div>
        </div>
      )}

      {/* =========================================================================
          ABA 0: VISÃO GERAL DO NEGÓCIO (ESPELHADA NO META ADS)
         ========================================================================= */}
      {currentTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Banner Superior com Seletor de Período */}
          <div className="gads-panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff", margin: 0 }}>
                    Visão Geral do Negócio • Google Ads
                  </h2>
                  <span style={{ fontSize: "11px", background: "rgba(16, 185, 129, 0.14)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.3)", padding: "2px 8px", borderRadius: "6px", fontWeight: 700 }}>
                    Ao Vivo
                  </span>
                </div>
                <p style={{ color: "#64748b", fontSize: "13px", margin: "4px 0 0" }}>
                  Resumo executivo completo: investimento, cliques no WhatsApp, conversas reais, funil de vendas e ROAS.
                </p>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="date"
                  value={reportStartDate}
                  onChange={(e) => {
                    setReportDatePreset("all");
                    setReportStartDate(e.target.value);
                  }}
                  className="gads-select-field"
                  style={{ padding: "6px 10px", fontSize: "12px", width: "auto" }}
                  title="Data inicial"
                />
                <span style={{ color: "#64748b", fontSize: "12px" }}>até</span>
                <input
                  type="date"
                  value={reportEndDate}
                  onChange={(e) => {
                    setReportDatePreset("all");
                    setReportEndDate(e.target.value);
                  }}
                  className="gads-select-field"
                  style={{ padding: "6px 10px", fontSize: "12px", width: "auto" }}
                  title="Data final"
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
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
                ] as Array<{ id: DatePreset; label: string }>
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleDatePresetChange(preset.id)}
                  className={`date-preset-btn ${reportDatePreset === preset.id && (!reportStartDate || preset.id !== "all") ? "active" : ""}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5 KPI Cards Executivos (padrão Meta Ads) */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "12px" }}>
            <div className="gads-metric-card">
              <span className="gads-metric-title" style={{ color: "#94a3b8" }}>
                Investimento Google <DollarSign size={14} color="#94a3b8" />
              </span>
              <div className="gads-metric-val" style={{ color: "#ffffff" }}>
                R$ {reportMetrics.totalCost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <span className="gads-metric-sub">
                {reportsData.apiConnected ? `Conta ativa (${reportsData.apiVersionUsed || "v25"})` : "Aguardando Google Ads API"}
              </span>
            </div>

            <div className="gads-metric-card">
              <span className="gads-metric-title" style={{ color: "#38bdf8" }}>
                Conversas Reais <MessageSquare size={14} color="#38bdf8" />
              </span>
              <div className="gads-metric-val" style={{ color: "#38bdf8" }}>
                {reportMetrics.totalLeadsCount}
              </div>
              <span className="gads-metric-sub">
                De {reportMetrics.totalClicksCount} clique(s) no WPP • {reportMetrics.clickToChatRate}% iniciou
              </span>
            </div>

            <div className="gads-metric-card">
              <span className="gads-metric-title" style={{ color: "#facc15" }}>
                Custo p/ Conversa Real <Target size={14} color="#facc15" />
              </span>
              <div className="gads-metric-val" style={{ color: "#ffffff" }}>
                R$ {reportMetrics.cpl.toFixed(2)}
              </div>
              <span className="gads-metric-sub">
                {reportMetrics.quotesCount} orçamento(s) • {reportMetrics.clicksOnlyCount} só clicou
              </span>
            </div>

            <div className="gads-metric-card">
              <span className="gads-metric-title" style={{ color: "#10b981" }}>
                Vendas Rastreadas <Award size={14} color="#10b981" />
              </span>
              <div className="gads-metric-val" style={{ color: "#10b981" }}>
                R$ {reportMetrics.totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <span className="gads-metric-sub">
                {reportMetrics.salesCount} venda(s) • Conversão {reportMetrics.conversionRate}%
              </span>
            </div>

            <div className="gads-metric-card">
              <span className="gads-metric-title" style={{ color: "#c084fc" }}>
                ROAS & Lucro Líquido <TrendingUp size={14} color="#c084fc" />
              </span>
              <div className="gads-metric-val" style={{ color: reportMetrics.profit >= 0 ? "#34d399" : "#f87171" }}>
                {reportMetrics.roas}x
              </div>
              <span className="gads-metric-sub">
                Lucro: R$ {reportMetrics.profit.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Funil Completo do Negócio + Desempenho Diário & Atendentes */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
            {/* Funil do Negócio */}
            <div className="gads-panel">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#fff", margin: 0 }}>
                    Funil Real do Negócio (Google Ads → WhatsApp)
                  </h3>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "3px 0 0" }}>
                    Acompanhamento completo de quem clicou até a venda fechada
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentTab("funil")}
                  style={{ background: "transparent", border: "none", color: "#38bdf8", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                >
                  Abrir Kanban →
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  {
                    label: "1. Clicou no WhatsApp",
                    value: reportMetrics.totalClicksCount,
                    pct: 100,
                    sub: "Total de cliques rastreados para o WhatsApp",
                    color: "#facc15",
                  },
                  {
                    label: "2. Conversas Reais Iniciadas",
                    value: reportMetrics.totalLeadsCount,
                    pct: reportMetrics.totalClicksCount > 0 ? Math.round((reportMetrics.totalLeadsCount / reportMetrics.totalClicksCount) * 100) : 0,
                    sub: `${reportMetrics.clickToChatRate}% dos cliques mandaram mensagem`,
                    color: "#38bdf8",
                  },
                  {
                    label: "3. Orçamentos Enviados",
                    value: reportMetrics.quotesCount,
                    pct: reportMetrics.totalClicksCount > 0 ? Math.round((reportMetrics.quotesCount / reportMetrics.totalClicksCount) * 100) : 0,
                    sub: `${overviewStats.quoteFromChatsRate}% das conversas reais receberam proposta`,
                    color: "#c084fc",
                  },
                  {
                    label: "4. Compras Realizadas",
                    value: reportMetrics.salesCount,
                    pct: reportMetrics.totalClicksCount > 0 ? Math.round((reportMetrics.salesCount / reportMetrics.totalClicksCount) * 100) : 0,
                    sub: `${overviewStats.salesFromQuotesRate}% dos orçamentos • R$ ${reportMetrics.totalRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
                    color: "#10b981",
                  },
                ].map((step) => (
                  <div key={step.label} style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "11px 13px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{step.label}</span>
                      <span style={{ fontSize: "14px", fontWeight: 800, color: step.color }}>{step.value}</span>
                    </div>
                    <div style={{ width: "100%", height: "7px", background: "#0f172a", borderRadius: "99px", overflow: "hidden", marginBottom: "5px" }}>
                      <div style={{ width: `${Math.max(step.value > 0 ? 4 : 0, Math.min(100, step.pct))}%`, height: "100%", background: step.color, borderRadius: "99px", transition: "width 0.3s" }} />
                    </div>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>{step.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Evolução Diária + Desempenho dos Atendentes */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Gráfico Diário */}
              <div className="gads-panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#fff", margin: 0 }}>
                      Desempenho Diário • Cliques vs Conversas Reais
                    </h3>
                    <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                      Comparativo diário no período selecionado (horário de Brasília)
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "10px", fontSize: "11px", fontWeight: 600 }}>
                    <span style={{ color: "#facc15" }}>● Clicou WPP</span>
                    <span style={{ color: "#38bdf8" }}>● Conversa Real</span>
                  </div>
                </div>

                {overviewStats.dailySeries.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "28px 10px", color: "#64748b", fontSize: "12px" }}>
                    Sem movimentação registrada no período selecionado.
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "8px", height: "150px", paddingTop: "16px", borderBottom: "1px solid #1e293b", paddingBottom: "8px" }}>
                    {overviewStats.dailySeries.map((day) => {
                      const clickPct = Math.round((day.clicks / overviewStats.maxDailyClicks) * 100);
                      const chatPct = Math.round((day.realChats / overviewStats.maxDailyClicks) * 100);
                      return (
                        <div key={day.dateKey} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: "6px" }}>
                          <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 700 }}>
                            {day.clicks}/{day.realChats}
                          </div>
                          <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "95px", width: "100%", justifyContent: "center" }}>
                            <div
                              title={`${day.label}: ${day.clicks} clique(s) no WhatsApp`}
                              style={{ width: "14px", height: `${Math.max(day.clicks > 0 ? 8 : 0, clickPct)}%`, background: "rgba(250, 204, 21, 0.75)", borderRadius: "4px 4px 0 0" }}
                            />
                            <div
                              title={`${day.label}: ${day.realChats} conversa(s) real(is)`}
                              style={{ width: "14px", height: `${Math.max(day.realChats > 0 ? 8 : 0, chatPct)}%`, background: "#38bdf8", borderRadius: "4px 4px 0 0" }}
                            />
                          </div>
                          <span style={{ fontSize: "11px", color: "#cbd5e1", fontWeight: 600 }}>{day.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Atendentes no Período */}
              <div className="gads-panel">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#fff", margin: 0 }}>
                    Atendimento no Período ({activeTenant?.name || "Cliente"})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setCurrentTab("roleta")}
                    style={{ background: "transparent", border: "none", color: "#38bdf8", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                  >
                    Ver Detalhes →
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px" }}>
                  {overviewStats.attendantsPeriod.map((att, idx) => (
                    <div key={att.name} style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "8px", padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <strong style={{ color: idx % 2 === 0 ? "#f472b6" : "#60a5fa", fontSize: "13px" }}>{att.name}</strong>
                        <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>{att.chatRate}% conv.</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "4px", fontSize: "11px", color: "#cbd5e1" }}>
                        <span>Cliques: <strong>{att.clicks}</strong></span>
                        <span>Conversas: <strong style={{ color: "#38bdf8" }}>{att.chats}</strong></span>
                        <span>Orçamentos: <strong style={{ color: "#c084fc" }}>{att.quotes}</strong></span>
                        <span>Vendas: <strong style={{ color: "#34d399" }}>{att.sales}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Campanhas Google Ads no Período */}
          <div className="gads-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#fff", margin: 0 }}>
                  Campanhas Google Ads no Período
                </h3>
                <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
                  Comparativo entre gasto no Google, cliques no botão do WhatsApp, conversas reais e retorno
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentTab("relatorios")}
                style={{ background: "transparent", border: "none", color: "#38bdf8", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
              >
                Abrir Relatório Completo →
              </button>
            </div>

            <div className="gads-table-scroll">
              <table className="gads-table">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "8px 10px" }}>Campanha</th>
                    <th style={{ padding: "8px 10px" }}>Gasto</th>
                    <th style={{ padding: "8px 10px" }}>Clicou WPP</th>
                    <th style={{ padding: "8px 10px" }}>Conversas Reais</th>
                    <th style={{ padding: "8px 10px" }}>CPL Real</th>
                    <th style={{ padding: "8px 10px" }}>Vendas</th>
                    <th style={{ padding: "8px 10px" }}>ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewStats.campaignSummary.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: "20px", color: "#64748b" }}>
                        Nenhuma campanha com dados neste período
                      </td>
                    </tr>
                  ) : (
                    overviewStats.campaignSummary.map((c) => (
                      <tr key={c.campaign} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "9px 10px", fontWeight: 600, color: "#fff" }}>{c.campaign}</td>
                        <td style={{ padding: "9px 10px", color: "#e2e8f0" }}>
                          R$ {c.cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: "9px 10px", color: "#facc15", fontWeight: 700 }}>{c.adButtonClicks}</td>
                        <td style={{ padding: "9px 10px", color: "#38bdf8", fontWeight: 700 }}>{c.whatsappLeads}</td>
                        <td style={{ padding: "9px 10px", color: "#cbd5e1" }}>
                          {c.cpl > 0 ? `R$ ${c.cpl.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "9px 10px", color: "#34d399", fontWeight: 700 }}>
                          {c.whatsappSalesCount} • R$ {c.whatsappRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: "9px 10px", color: "#38bdf8", fontWeight: 800 }}>{c.roas}x</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Últimas Conversas Recebidas (Feed padrão Meta Ads) */}
          <div className="gads-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <MessageSquare size={16} color="#38bdf8" />
                <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#fff", margin: 0 }}>
                  Últimos Leads & Conversas no Período
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCurrentTab("leads")}
                style={{ background: "transparent", border: "none", color: "#38bdf8", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
              >
                Ver todos os leads ({filteredReportLeads.length}) →
              </button>
            </div>

            {overviewStats.recentConversations.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px", color: "#64748b", fontSize: "13px" }}>
                Nenhum lead encontrado neste período.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                {overviewStats.recentConversations.map((lead) => {
                  const st = getEffectiveStage(lead);
                  return (
                    <div key={lead.id} style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                        <strong style={{ color: "#fff", fontSize: "13px" }}>
                          {lead.leadName || (st === "clique_anuncio" ? "Clicou no WhatsApp" : "Cliente WhatsApp")}
                        </strong>
                        <span style={{ fontSize: "11px", color: "#64748b", whiteSpace: "nowrap" }}>
                          {formatBrDateTime(lead.occurredAt)}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: st === "clique_anuncio" ? "#eab308" : "#94a3b8" }}>
                        {st === "clique_anuncio" ? "Aguardando 1ª msg no WhatsApp" : lead.leadPhone}
                      </div>
                      <div style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 600 }}>
                        <KeyRound size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {lead.keyword || "Pesquisa Direta"}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "6px", borderTop: "1px solid #1e293b", fontSize: "11px" }}>
                        <span style={{ color: lead.attendantName.includes("Josi") ? "#f472b6" : "#60a5fa", fontWeight: 700 }}>
                          {lead.attendantName}
                        </span>
                        <span style={{ color: st === "compra_realizada" ? "#34d399" : st === "orcamento_enviado" ? "#c084fc" : st === "conversa_iniciada" ? "#38bdf8" : "#facc15", fontWeight: 700 }}>
                          {st === "compra_realizada"
                            ? "4. Compra"
                            : st === "orcamento_enviado"
                              ? "3. Orçamento"
                              : st === "conversa_iniciada"
                                ? "2. Conversa Real"
                                : "1. Só Clicou"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          ABA 1: LEADS & PALAVRAS-CHAVE
         ========================================================================= */}
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
                {attendantFilterOptions.map((attName) => (
                  <option key={attName} value={attName}>
                    Atendente: {attName}
                  </option>
                ))}
              </select>

              <select
                value={filterStage}
                onChange={(e) => setFilterStage(e.target.value)}
                className="gads-select-field"
              >
                <option value="all">Todas as Etapas</option>
                <option value="clique_anuncio">1. Clique no Anúncio (Sem msg)</option>
                <option value="conversa_iniciada">2. Conversa Iniciada</option>
                <option value="orcamento_enviado">3. Orçamento Enviado</option>
                <option value="compra_realizada">4. Compra Realizada</option>
              </select>

              <button
                onClick={() => fetchData(false)}
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

              {leadEvents.some((l) => isAttendantLead(l.leadPhone)) && (
                <button
                  type="button"
                  onClick={handleCleanAttendantLeads}
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.4)",
                    color: "#f87171",
                    borderRadius: "8px",
                    padding: "9px 12px",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  title="Remove registros com telefones dos próprios atendentes do cliente"
                >
                  <Trash2 size={13} /> Limpar Leads com Telefones dos Atendentes
                </button>
              )}
            </div>
          </div>

          {/* Filtro por Data na Aba de Leads (padrão Meta Ads) */}
          <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 700, color: "#cbd5e1", marginRight: "4px" }}>
                  <Calendar size={14} color="#38bdf8" /> Período:
                </span>
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
                  ] as Array<{ id: DatePreset; label: string }>
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleLeadsDatePresetChange(preset.id)}
                    className={`date-preset-btn ${leadsDatePreset === preset.id && (!leadsStartDate || preset.id !== "all") ? "active" : ""}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                <input
                  type="date"
                  value={leadsStartDate}
                  onChange={(e) => {
                    setLeadsDatePreset("all");
                    setLeadsStartDate(e.target.value);
                  }}
                  className="gads-select-field"
                  style={{ padding: "5px 8px", fontSize: "12px", width: "auto" }}
                  title="Data inicial"
                />
                <span style={{ color: "#64748b", fontSize: "12px" }}>até</span>
                <input
                  type="date"
                  value={leadsEndDate}
                  onChange={(e) => {
                    setLeadsDatePreset("all");
                    setLeadsEndDate(e.target.value);
                  }}
                  className="gads-select-field"
                  style={{ padding: "5px 8px", fontSize: "12px", width: "auto" }}
                  title="Data final"
                />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", fontSize: "12px", color: "#94a3b8" }}>
              <div>
                Exibindo <strong style={{ color: "#fff" }}>{filteredLeadsSummary.total}</strong> registro(s):{" "}
                <strong style={{ color: "#facc15" }}>{filteredLeadsSummary.clicksOnly}</strong> só clicou no WhatsApp •{" "}
                <strong style={{ color: "#38bdf8" }}>{filteredLeadsSummary.realChats}</strong> conversa(s) real(is)
              </div>
              {(leadsStartDate || leadsEndDate || filterKeyword || filterAttendant !== "all" || filterStage !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setLeadsDatePreset("all");
                    setLeadsStartDate("");
                    setLeadsEndDate("");
                    setFilterKeyword("");
                    setFilterAttendant("all");
                    setFilterStage("all");
                  }}
                  style={{ background: "transparent", border: "none", color: "#38bdf8", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {filteredEvents.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 16px", color: "#64748b" }}>
              <Users size={40} color="#334155" style={{ margin: "0 auto 10px", display: "block" }} />
              <strong style={{ display: "block", color: "#94a3b8", fontSize: "14px" }}>
                Nenhum lead encontrado com os filtros atuais
              </strong>
              <p style={{ maxWidth: "480px", margin: "6px auto 0", fontSize: "13px", lineHeight: "1.5" }}>
                Os cliques da Landing Page com anúncios do Google Ads e mensagens do WhatsApp entram aqui automaticamente em tempo real.
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
                    <th style={{ padding: "10px 12px", textAlign: "right" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => {
                    const stage = getEffectiveStage(event);
                    return (
                      <tr key={event.id} style={{ borderBottom: "1px solid #0f172a" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: "6px" }}>
                            {event.leadName || (stage === "clique_anuncio" ? "Clicou no Anúncio" : "Lead em Identificação")}
                            {event.leadPhone && !isAttendantLead(event.leadPhone) && !isWaitingWhatsApp(event.leadPhone) && (
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
                          <small style={{ color: stage === "clique_anuncio" ? "#eab308" : "#94a3b8" }}>
                            {stage === "clique_anuncio"
                              ? "Aguardando 1ª msg WhatsApp..."
                              : event.leadPhone}
                          </small>
                        </td>

                        <td style={{ padding: "10px 12px", color: "#38bdf8" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontWeight: 600 }}>
                            <KeyRound size={13} /> {event.keyword || "Pesquisa Direta"}
                          </span>
                          {(event.clickViewEnriched || event.matchType) && (
                            <div style={{ fontSize: "10px", color: "#34d399", marginTop: "2px", fontWeight: 600 }}>
                              {event.clickViewEnriched ? "click_view ✓" : ""}
                              {event.matchType ? ` • ${event.matchType}` : ""}
                            </div>
                          )}
                        </td>

                        <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>
                          <div><strong style={{ color: "#fff" }}>{event.campaignName || event.campaign || "Campanha Pesquisa"}</strong></div>
                          <div style={{ color: "#94a3b8", fontSize: "12px" }}>{event.adGroupName || event.adGroup || "Conjunto Geral"}</div>
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
                          {stage === "clique_anuncio" ? (
                            <span style={{ background: "rgba(234, 179, 8, 0.15)", color: "#facc15", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              1. Clique no Anúncio
                            </span>
                          ) : stage === "conversa_iniciada" ? (
                            <span style={{ background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              2. Conversa Iniciada
                            </span>
                          ) : stage === "orcamento_enviado" ? (
                            <span style={{ background: "rgba(168, 85, 247, 0.15)", color: "#c084fc", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              3. Orçamento Enviado
                            </span>
                          ) : stage === "compra_realizada" ? (
                            <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                              4. Compra: {event.value ? `R$ ${event.value.toLocaleString("pt-BR")}` : "Fechada"}
                            </span>
                          ) : null}
                        </td>

                        <td style={{ padding: "10px 12px" }}>
                          {event.status === "sent" ? (
                            <div>
                              <span
                                style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 700 }}
                                title={event.ociResult || "Enviado com sucesso ao Google Ads"}
                              >
                                <CheckCircle2 size={13} /> Enviado Google
                              </span>
                              {event.ociOrderId && (
                                <div style={{ color: "#64748b", fontSize: "10px", marginTop: "2px" }}>
                                  orderId: {event.ociOrderId.slice(0, 18)}…
                                </div>
                              )}
                            </div>
                          ) : event.status === "failed" ? (
                            <div>
                              <button
                                type="button"
                                onClick={() => handleTriggerOciRetry(event.id)}
                                disabled={isSyncingOci}
                                title={event.ociError || "Reenviar conversão com falha"}
                                style={{
                                  background: "rgba(239, 68, 68, 0.15)",
                                  border: "1px solid rgba(239, 68, 68, 0.35)",
                                  color: "#f87171",
                                  padding: "4px 9px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <RefreshCw size={11} /> Reenviar Falha
                              </button>
                              {event.ociError && (
                                <div style={{ color: "#fca5a5", fontSize: "10px", marginTop: "3px", maxWidth: "170px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {event.ociError}
                                </div>
                              )}
                            </div>
                          ) : !event.firstMessageAt || isWaitingWhatsApp(event.leadPhone) ? (
                            <span style={{ color: "#facc15", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600 }}>
                              <Clock size={12} /> Aguardando WhatsApp
                            </span>
                          ) : (
                            <span style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600 }}>
                              <Clock size={12} /> Fila Maturação (4h)
                            </span>
                          )}
                        </td>

                        <td style={{ padding: "10px 12px", color: "#94a3b8", whiteSpace: "nowrap" }} title={event.occurredAt}>
                          {formatBrDateTime(event.occurredAt)}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => handleDeleteLead(event.id)}
                            title="Excluir este lead"
                            style={{
                              background: "rgba(239, 68, 68, 0.1)",
                              border: "1px solid rgba(239, 68, 68, 0.2)",
                              color: "#f87171",
                              cursor: "pointer",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
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

      {/* =========================================================================
          ABA 2: FUNIL CRM COMPLETO (4 ETAPAS KANBAN)
         ========================================================================= */}
      {currentTab === "funil" && (
        <div>
          <div style={{ marginBottom: "16px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
              Funil de Clientes & Conversões Google Ads (4 Etapas)
            </h2>
            <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
              Separação real entre quem só clicou no anúncio, quem iniciou conversa no WhatsApp, orçamentos e compras fechadas.
            </p>
          </div>

          <div className="kanban-grid">
            {/* COLUNA 1: CLIQUE NO ANÚNCIO */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#facc15" }}>
                  <Clock size={15} /> 1. Clique no Anúncio
                </span>
                <span className="kanban-col-count">{apenasCliques}</span>
              </div>
              <div className="kanban-cards-wrap">
                {realLeadEvents
                  .filter((l) => getEffectiveStage(l) === "clique_anuncio")
                  .map((lead) => (
                    <div key={lead.id} className="kanban-card" style={{ borderColor: "rgba(250, 204, 21, 0.3)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <strong style={{ color: "#fff", fontSize: "13px" }}>
                          {lead.leadName || "Clicou no Anúncio"}
                        </strong>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>{lead.attendantName}</span>
                      </div>
                      <div style={{ color: "#eab308", fontSize: "11px", marginTop: "4px" }}>
                        Aguardando enviar 1ª mensagem no WhatsApp...
                      </div>
                      <div style={{ background: "#090f20", padding: "6px 8px", borderRadius: "6px", marginTop: "8px", fontSize: "11px", color: "#38bdf8" }}>
                        <KeyRound size={11} style={{ display: "inline", marginRight: "4px" }} />
                        {lead.keyword || "Pesquisa Google"}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                        <button
                          type="button"
                          onClick={() => updateLeadStage(lead.id, "conversa_iniciada")}
                          style={{
                            background: "#1e293b",
                            border: "1px solid #334155",
                            color: "#38bdf8",
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
                          Iniciar Conversa <ArrowRight size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* COLUNA 2: CONVERSA INICIADA */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#38bdf8" }}>
                  <MessageSquare size={15} /> 2. Conversa Iniciada
                </span>
                <span className="kanban-col-count">{conversasEmAberto}</span>
              </div>
              <div className="kanban-cards-wrap">
                {realLeadEvents
                  .filter((l) => getEffectiveStage(l) === "conversa_iniciada")
                  .map((lead) => (
                    <div key={lead.id} className="kanban-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <strong style={{ color: "#fff", fontSize: "13px" }}>
                          {lead.leadName || "Lead em Atendimento"}
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
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
                        <button
                          type="button"
                          onClick={() => updateLeadStage(lead.id, "clique_anuncio")}
                          style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "11px", cursor: "pointer" }}
                        >
                          <ArrowLeft size={11} /> Voltar
                        </button>
                        <button
                          type="button"
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

            {/* COLUNA 3: ORÇAMENTO ENVIADO */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#c084fc" }}>
                  <Award size={15} /> 3. Orçamento Enviado
                </span>
                <span className="kanban-col-count">{orcamentosEnviados}</span>
              </div>
              <div className="kanban-cards-wrap">
                {realLeadEvents
                  .filter((l) => getEffectiveStage(l) === "orcamento_enviado")
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
                        Proposta / Orçamento Enviado
                      </div>

                      {closingSaleLeadId === lead.id ? (
                        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "6px", background: "#090f20", padding: "8px", borderRadius: "6px", border: "1px solid rgba(16,185,129,0.4)" }}>
                          <label style={{ fontSize: "11px", color: "#cbd5e1", fontWeight: 600 }}>Valor da Venda (R$):</label>
                          <input
                            type="number"
                            step="0.01"
                            value={closingSaleValue}
                            onChange={(e) => setClosingSaleValue(e.target.value)}
                            className="gads-input-field"
                            style={{ padding: "5px 8px", fontSize: "12px" }}
                          />
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => setClosingSaleLeadId(null)}
                              style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "11px", cursor: "pointer" }}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const val = parseFloat(closingSaleValue.replace(",", "."));
                                updateLeadStage(lead.id, "compra_realizada", isNaN(val) ? 0 : val);
                                setClosingSaleLeadId(null);
                              }}
                              style={{
                                background: "#059669",
                                border: "none",
                                color: "#fff",
                                borderRadius: "5px",
                                padding: "4px 10px",
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Confirmar R$
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px" }}>
                          <button
                            type="button"
                            onClick={() => updateLeadStage(lead.id, "conversa_iniciada")}
                            style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "11px", cursor: "pointer" }}
                          >
                            <ArrowLeft size={11} /> Voltar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setClosingSaleLeadId(lead.id);
                              setClosingSaleValue(lead.value ? String(lead.value) : "1200");
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
                      )}
                    </div>
                  ))}
              </div>
            </div>

            {/* COLUNA 4: COMPRA REALIZADA */}
            <div className="kanban-col">
              <div className="kanban-col-header">
                <span className="kanban-col-title" style={{ color: "#34d399" }}>
                  <CheckCircle2 size={15} /> 4. Compra Realizada
                </span>
                <span className="kanban-col-count">{comprasRealizadas}</span>
              </div>
              <div className="kanban-cards-wrap">
                {realLeadEvents
                  .filter((l) => getEffectiveStage(l) === "compra_realizada")
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
                        Venda confirmada no funil Google Ads
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-start", marginTop: "8px" }}>
                        <button
                          type="button"
                          onClick={() => updateLeadStage(lead.id, "orcamento_enviado")}
                          style={{ background: "transparent", border: "none", color: "#64748b", fontSize: "11px", cursor: "pointer" }}
                        >
                          <ArrowLeft size={11} /> Voltar para Orçamento
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          ABA 3: RELATÓRIOS & ANALYTICS CUSTOMIZÁVEL (BI COMPLETO)
         ========================================================================= */}
      {currentTab === "relatorios" && (
        <div className="gads-panel">
          {/* Cabeçalho dos Relatórios */}
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

          {/* PAINEL DE FILTROS AVANÇADOS */}
          <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "16px", marginBottom: "24px" }}>
            {/* Presets Rápidos de Data (padrão Meta Ads) */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
              <button
                type="button"
                onClick={() => handleDatePresetChange("all")}
                className={`date-preset-btn ${reportDatePreset === "all" && !reportStartDate ? "active" : ""}`}
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
                onClick={() => handleDatePresetChange("day_before_yesterday")}
                className={`date-preset-btn ${reportDatePreset === "day_before_yesterday" ? "active" : ""}`}
              >
                Anteontem
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
                onClick={() => handleDatePresetChange("14d")}
                className={`date-preset-btn ${reportDatePreset === "14d" ? "active" : ""}`}
              >
                Últimos 14 dias
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

            {/* Linha com Seletores Personalizados */}
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
                    <option key={c.id} value={c.id}>
                      {c.name}
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
                    <option key={ad.id} value={ad.id}>
                      {ad.name}
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
                  {attendantFilterOptions.map((attName) => (
                    <option key={attName} value={attName}>
                      {attName}
                    </option>
                  ))}
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
                  <option value="clique_anuncio">1. Clique no Anúncio</option>
                  <option value="conversa_iniciada">2. Conversa Iniciada</option>
                  <option value="orcamento_enviado">3. Orçamento Enviado</option>
                  <option value="compra_realizada">4. Compra Realizada</option>
                </select>
              </div>
            </div>
          </div>

          {/* PLACAR CONSOLIDADO DE MÉTRICAS DO PERÍODO */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "28px" }}>
            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase" }}>Gasto Google Ads</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#ffffff", marginTop: "4px" }}>
                R$ {reportMetrics.totalCost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <small style={{ color: reportsData.apiConnected ? "#34d399" : "#64748b", fontSize: "11px" }}>
                {reportsData.apiConnected ? `Google Ads API (${reportsData.apiVersionUsed || "ativa"})` : "API Google Ads"}
              </small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid rgba(250, 204, 21, 0.35)", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#facc15", fontWeight: 700, textTransform: "uppercase" }}>Clicou no WhatsApp</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#facc15", marginTop: "4px" }}>
                {reportMetrics.totalClicksCount}
              </div>
              <small style={{ color: "#94a3b8", fontSize: "11px" }}>
                {reportMetrics.clickToChatRate}% iniciou conversa • {reportMetrics.clicksOnlyCount} sem msg
              </small>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px" }}>
              <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700, textTransform: "uppercase" }}>Conversas Reais</span>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#38bdf8", marginTop: "4px" }}>
                {reportMetrics.totalLeadsCount}
              </div>
              <small style={{ color: "#64748b", fontSize: "11px" }}>
                de {reportMetrics.totalClicksCount} cliques • CPL: R$ {reportMetrics.cpl.toFixed(2)}
              </small>
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

          {/* TABELA 1: DESEMPENHO POR CONJUNTO DE ANÚNCIOS NO PERÍODO */}
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
                    <th style={{ padding: "10px 12px" }}>Cliques / CTR</th>
                    <th style={{ padding: "10px 12px" }}>Leads (CPL)</th>
                    <th style={{ padding: "10px 12px" }}>Orçamentos</th>
                    <th style={{ padding: "10px 12px" }}>Vendas (Conv. / CAC)</th>
                    <th style={{ padding: "10px 12px" }}>Lucro Líquido</th>
                    <th style={{ padding: "10px 12px" }}>ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {reportsData.reports.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>
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
                        <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: "12px" }}>
                          <div><strong style={{ color: "#e2e8f0" }}>{item.clicks || 0}</strong> cl.</div>
                          <small>{item.ctr ?? 0}% CTR</small>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#fff", fontWeight: 700 }}>
                          <div>{item.whatsappLeads} conv.</div>
                          <small style={{ color: "#94a3b8", fontWeight: 500 }}>
                            {item.adButtonClicks || 0} clicou WPP{item.cpl > 0 ? ` • R$ ${item.cpl.toFixed(2)}/lead` : ""}
                          </small>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#c084fc" }}>{item.whatsappQuotes}</td>
                        <td style={{ padding: "10px 12px", color: "#34d399", fontWeight: 700 }}>
                          <div>R$ {item.whatsappRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                          <small style={{ color: "#94a3b8", fontWeight: 500 }}>
                            {item.whatsappSalesCount || 0}v ({item.conversionRate ?? 0}%)
                            {item.cac > 0 ? ` • CAC R$ ${item.cac.toFixed(0)}` : ""}
                          </small>
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

          {/* TABELA 2: LISTAGEM ANALÍTICA DOS LEADS FILTRADOS */}
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
                          <div>{l.campaignName || l.campaign}</div>
                          <small style={{ color: "#64748b" }}>{l.adGroupName || l.adGroup}</small>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ background: "#1e293b", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                            {l.attendantName}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {(() => {
                            const st = getEffectiveStage(l);
                            if (st === "compra_realizada") {
                              return <span style={{ color: "#34d399", fontWeight: 700 }}>4. Compra Realizada</span>;
                            }
                            if (st === "orcamento_enviado") {
                              return <span style={{ color: "#c084fc", fontWeight: 600 }}>3. Orçamento</span>;
                            }
                            if (st === "clique_anuncio") {
                              return <span style={{ color: "#facc15", fontWeight: 600 }}>1. Só Clicou</span>;
                            }
                            return <span style={{ color: "#60a5fa" }}>2. Conversa</span>;
                          })()}
                        </td>
                        <td style={{ padding: "10px 12px", color: l.value ? "#34d399" : "#64748b", fontWeight: l.value ? 700 : 400 }}>
                          {l.value ? `R$ ${l.value.toLocaleString("pt-BR")}` : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#94a3b8", whiteSpace: "nowrap" }} title={l.occurredAt}>
                          {formatBrDateTime(l.occurredAt)}
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

      {/* =========================================================================
          ABA 4: ROLETA DE ATENDENTES
         ========================================================================= */}
      {currentTab === "roleta" && (
        <div className="gads-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                {activeTenant?.routingMode === "single"
                  ? `Atendimento Único (1 WhatsApp) — ${activeTenant?.name || "Cliente"}`
                  : `Equilíbrio da Roleta & Desempenho — ${activeTenant?.name || "Cliente"}`}
              </h2>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                {activeTenant?.routingMode === "single"
                  ? "Este cliente opera com 1 único número de WhatsApp (100% dos cliques do link vão direto para este número, sem roleta)."
                  : "Divisão automática de cliques entre os atendentes ativos da equipe."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (activeTenant) startEditingTenant(activeTenant);
                setCurrentTab("clientes");
              }}
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#38bdf8",
                borderRadius: "8px",
                padding: "8px 14px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Alterar Modo / Números em Clientes
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px", marginBottom: "24px" }}>
            {overviewStats.attendantsPeriod.length === 0 ? (
              <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px", color: "#94a3b8", fontSize: "13px" }}>
                Nenhum lead registrado ainda para os atendentes deste cliente.
              </div>
            ) : (
              overviewStats.attendantsPeriod.map((att, idx) => {
                const attInfo = (activeTenant?.attendants || []).find(
                  (a) => a.name.toLowerCase() === att.name.toLowerCase()
                );
                const pct = totalLeads > 0 ? Math.round((att.clicks / totalLeads) * 100) : Math.round(100 / Math.max(1, overviewStats.attendantsPeriod.length));
                return (
                  <div key={att.name} style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#fff", margin: 0 }}>{att.name}</h3>
                        <span style={{ color: "#64748b", fontSize: "12px" }}>{attInfo?.phone || "WhatsApp conectado"}</span>
                      </div>
                      <span style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                        {activeTenant?.routingMode === "single" ? "WhatsApp Único" : "Ativo na Roleta"}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginTop: "16px", textAlign: "center" }}>
                      <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>Cliques</span>
                        <div style={{ fontSize: "20px", fontWeight: 800, color: "#fff" }}>{att.clicks}</div>
                        <small style={{ color: idx % 2 === 0 ? "#f472b6" : "#38bdf8", fontSize: "11px" }}>{pct}%</small>
                      </div>
                      <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>Orçamentos</span>
                        <div style={{ fontSize: "20px", fontWeight: 800, color: "#c084fc" }}>{att.quotes}</div>
                      </div>
                      <div style={{ background: "#0f172a", padding: "10px", borderRadius: "8px" }}>
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>Vendas</span>
                        <div style={{ fontSize: "20px", fontWeight: 800, color: "#34d399" }}>{att.sales}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>
              <strong style={{ color: "#fff" }}>Link oficial deste cliente:</strong>{" "}
              <code style={{ color: "#38bdf8" }}>
                {typeof window !== "undefined"
                  ? `${window.location.origin}/r/${activeTenantSlug}`
                  : `https://painel.anunciosalpha.com.br/r/${activeTenantSlug}`}
              </code>
            </div>
            <button
              type="button"
              onClick={() => {
                const url =
                  typeof window !== "undefined"
                    ? `${window.location.origin}/r/${activeTenantSlug}`
                    : `https://painel.anunciosalpha.com.br/r/${activeTenantSlug}`;
                navigator.clipboard?.writeText(url).catch(() => {});
                setCopiedHelperMsg(`Link /r/${activeTenantSlug} copiado!`);
                setTimeout(() => setCopiedHelperMsg(null), 2500);
              }}
              style={{
                background: "#2563eb",
                border: "none",
                color: "#fff",
                borderRadius: "8px",
                padding: "7px 12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <Copy size={12} /> {copiedHelperMsg || "Copiar Link de Rastreamento"}
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          ABA 5: CONFIGURAÇÃO DE REGRAS DINÂMICAS & AUDITORIA
         ========================================================================= */}
      {currentTab === "conversoes" && (
        <div className="gads-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px", marginBottom: "20px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#ffffff", margin: 0 }}>
                  Regras de Funil &amp; Conversões ({activeTenant?.name || "Cliente"})
                </h2>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "#fbbf24", background: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(245, 158, 11, 0.3)", padding: "2px 8px", borderRadius: "6px" }}>
                  Exclusivo do Gestor
                </span>
              </div>
              <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                Configure frases no WhatsApp e etiquetas do WhatsApp Business (Uazapi) para mover o funil e disparar o Google Ads automaticamente. O cliente não altera esta área.
              </p>
              {rulesErrorMsg && (
                <p style={{ color: "#f87171", fontSize: "12px", marginTop: "4px", fontWeight: 600 }}>
                  {rulesErrorMsg}
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleTestLiveUazapi}
                disabled={isTestingUazapi}
                style={{
                  background: "#1e293b",
                  color: "#38bdf8",
                  border: "1px solid #334155",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Tag size={14} /> {isTestingUazapi ? "Lendo WhatsApp..." : "Carregar Etiquetas do WhatsApp"}
              </button>

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
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "16px", marginBottom: "28px" }}>
            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#c084fc", fontWeight: 700, fontSize: "14px", marginBottom: "6px" }}>
                <Award size={16} /> Conversão: Orçamento Enviado
              </div>
              <small style={{ color: "#64748b", display: "block", marginBottom: "14px" }}>
                Ação Google Ads: <strong style={{ color: "#cbd5e1" }}>{rules.quote.actionName}</strong>
              </small>

              <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>
                1. Por Frase / Palavra-Chave na Mensagem:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px", minHeight: "46px" }}>
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

              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
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

              <div style={{ borderTop: "1px solid #1e293b", paddingTop: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px", display: "flex", alignItems: "center", gap: "5px" }}>
                  <Tag size={12} color="#c084fc" /> 2. Por Etiqueta do WhatsApp Business:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px", minHeight: "30px" }}>
                  {(rules.quote.labels || []).length === 0 ? (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Nenhuma etiqueta vinculada a Orçamento.</span>
                  ) : (
                    (rules.quote.labels || []).map((lbl) => (
                      <span
                        key={lbl}
                        className="phrase-pill"
                        style={{ background: "rgba(168, 85, 247, 0.2)", color: "#e9d5ff", border: "1px solid rgba(168, 85, 247, 0.4)" }}
                      >
                        <Tag size={11} /> {lbl}
                        <button onClick={() => handleRemoveLabelRule("quote", lbl)} className="phrase-remove-btn" title="Remover etiqueta">
                          <X size={12} />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="Nome exato da etiqueta (ex: Orçamento Enviado)"
                    value={newQuoteLabel}
                    onChange={(e) => setNewQuoteLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddLabelRule("quote", newQuoteLabel)}
                    className="gads-input-field"
                    style={{ padding: "8px 12px", fontSize: "12px" }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddLabelRule("quote", newQuoteLabel)}
                    style={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#e9d5ff",
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
                    <Plus size={13} /> Etiqueta
                  </button>
                </div>
                {availableWaLabels.length > 0 && (
                  <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>Do WhatsApp:</span>
                    {availableWaLabels.map((wl) => (
                      <button
                        key={`q_${wl.name}`}
                        type="button"
                        onClick={() => handleAddLabelRule("quote", wl.name)}
                        style={{
                          background: "#0f172a",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        + {wl.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "12px", padding: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#34d399", fontWeight: 700, fontSize: "14px", marginBottom: "6px" }}>
                <CheckCircle2 size={16} /> Conversão: Compra Realizada (com R$)
              </div>
              <small style={{ color: "#64748b", display: "block", marginBottom: "14px" }}>
                Ação Google Ads: <strong style={{ color: "#cbd5e1" }}>{rules.purchase.actionName}</strong>
              </small>

              <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>
                1. Por Frase / Palavra-Chave na Mensagem:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "12px", minHeight: "46px" }}>
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

              <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
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

              <div style={{ borderTop: "1px solid #1e293b", paddingTop: "12px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px", display: "flex", alignItems: "center", gap: "5px" }}>
                  <Tag size={12} color="#34d399" /> 2. Por Etiqueta do WhatsApp Business:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px", minHeight: "30px" }}>
                  {(rules.purchase.labels || []).length === 0 ? (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Nenhuma etiqueta vinculada a Venda Fechada.</span>
                  ) : (
                    (rules.purchase.labels || []).map((lbl) => (
                      <span
                        key={lbl}
                        className="phrase-pill"
                        style={{ background: "rgba(16, 185, 129, 0.2)", color: "#a7f3d0", border: "1px solid rgba(16, 185, 129, 0.4)" }}
                      >
                        <Tag size={11} /> {lbl}
                        <button onClick={() => handleRemoveLabelRule("purchase", lbl)} className="phrase-remove-btn" title="Remover etiqueta">
                          <X size={12} />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="Nome exato da etiqueta (ex: Venda Fechada)"
                    value={newPurchaseLabel}
                    onChange={(e) => setNewPurchaseLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddLabelRule("purchase", newPurchaseLabel)}
                    className="gads-input-field"
                    style={{ padding: "8px 12px", fontSize: "12px" }}
                  />
                  <button
                    type="button"
                    onClick={() => handleAddLabelRule("purchase", newPurchaseLabel)}
                    style={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#a7f3d0",
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
                    <Plus size={13} /> Etiqueta
                  </button>
                </div>
                {availableWaLabels.length > 0 && (
                  <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
                    <span style={{ fontSize: "10px", color: "#64748b" }}>Do WhatsApp:</span>
                    {availableWaLabels.map((wl) => (
                      <button
                        key={`p_${wl.name}`}
                        type="button"
                        onClick={() => handleAddLabelRule("purchase", wl.name)}
                        style={{
                          background: "#0f172a",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "11px",
                          cursor: "pointer",
                        }}
                      >
                        + {wl.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid #1e293b", paddingTop: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff", marginBottom: "4px" }}>
              Auditoria de Disparos de Conversão ({activeTenant?.name || "Cliente"})
            </h3>
            <p style={{ color: "#64748b", fontSize: "12px", marginBottom: "14px" }}>
              Registro automático quando frases ou etiquetas do WhatsApp Business movem o funil e acionam a conversão.
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
                          {item.statusOci === "sent" ? (
                            <span style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600 }}>
                              <CheckCircle2 size={12} /> Enviado Google
                            </span>
                          ) : item.statusOci === "failed" ? (
                            <span style={{ color: "#f87171", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600 }}>
                              <AlertTriangle size={12} /> Falha OCI
                            </span>
                          ) : (
                            <span style={{ color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px" }}>
                              <Clock size={12} /> Fila OCI Ativa
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#94a3b8", whiteSpace: "nowrap" }} title={item.timestamp}>
                          {formatBrDateTime(item.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* RECONCILIAÇÃO WHATSAPP (UAZAPI ANTI-PERDA) — COMPACTO QUANDO ATIVO */}
          <div style={{ marginTop: "22px", padding: "16px", background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h4 style={{ color: "#34d399", fontSize: "14px", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                  <RefreshCw size={15} /> Backup WhatsApp Anti-Perda (Uazapi)
                </h4>
                <p style={{ color: "#94a3b8", fontSize: "12px", margin: "3px 0 0" }}>
                  {entitiesStatus.uazapiStatus?.configured
                    ? `Ativo (${entitiesStatus.uazapiStatus.instancesCount || 1} instância(s) configurada(s)) — resgata leads e conversas caso algum webhook do WhatsApp falhe.`
                    : "Informe os dados da Uazapi para testar conexão e recuperar mensagens perdidas caso algum webhook falhe."}
                </p>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleTestLiveUazapi}
                  disabled={isTestingUazapi}
                  style={{
                    background: "#1e293b",
                    border: "1px solid #334155",
                    color: "#38bdf8",
                    borderRadius: "8px",
                    padding: "7px 12px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {isTestingUazapi ? "Testando..." : "Testar Conexão Uazapi"}
                </button>
                {entitiesStatus.uazapiStatus?.configured && (
                  <>
                    <button
                      type="button"
                      onClick={handleTriggerUazapiReconcile}
                      disabled={isSavingUazapi}
                      style={{
                        background: "#059669",
                        border: "none",
                        color: "#fff",
                        borderRadius: "8px",
                        padding: "7px 12px",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <RefreshCw size={13} /> {isSavingUazapi ? "Recuperando..." : "Sincronizar Agora (Recuperar)"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingUazapiTokens((v) => !v)}
                      style={{
                        background: "#1e293b",
                        border: "1px solid #334155",
                        color: "#cbd5e1",
                        borderRadius: "8px",
                        padding: "7px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {editingUazapiTokens ? "Fechar" : "Editar Tokens"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {uazapiTestResult?.instances && (
              <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {uazapiTestResult.instances.map((it: any) => (
                  <div
                    key={`live_${it.name}`}
                    style={{
                      background: "#0f172a",
                      border: `1px solid ${it.connected ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)"}`,
                      borderRadius: "8px",
                      padding: "6px 10px",
                      fontSize: "11px",
                      color: "#e2e8f0",
                    }}
                  >
                    <strong>{it.name}:</strong>{" "}
                    <span style={{ color: it.connected ? "#34d399" : "#f87171", fontWeight: 700 }}>
                      {it.connected ? `Conectado (${it.phone || "OK"}) • ${it.latencyMs}ms` : it.error || "Desconectado"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Status limpo por atendente (sem métricas técnicas na Aba 5) */}
            {entitiesStatus.uazapiStatus?.configured &&
              Array.isArray(entitiesStatus.uazapiStatus.instanceStatuses) &&
              entitiesStatus.uazapiStatus.instanceStatuses.length > 0 && (
                <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {entitiesStatus.uazapiStatus.instanceStatuses.map((inst) => (
                    <div
                      key={inst.name}
                      style={{
                        background: "#0f172a",
                        border: `1px solid ${
                          inst.connected === true && !inst.error
                            ? "rgba(16, 185, 129, 0.35)"
                            : inst.connected === false || inst.error
                              ? "rgba(239, 68, 68, 0.4)"
                              : "#334155"
                        }`,
                        borderRadius: "8px",
                        padding: "5px 10px",
                        fontSize: "11px",
                        color: "#e2e8f0",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          width: "7px",
                          height: "7px",
                          borderRadius: "50%",
                          background:
                            inst.connected === true && !inst.error
                              ? "#10b981"
                              : inst.connected === false || inst.error
                                ? "#ef4444"
                                : "#eab308",
                        }}
                      />
                      <strong>{inst.name}:</strong>
                      <span>{inst.error ? inst.error : inst.state}</span>
                    </div>
                  ))}
                </div>
              )}

            {(!entitiesStatus.uazapiStatus?.configured || editingUazapiTokens) && (
              <form
                onSubmit={async (e) => {
                  await handleSaveUazapiConfig(e);
                  setEditingUazapiTokens(false);
                }}
                style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px", alignItems: "end", marginTop: "14px" }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                    URL Base da Uazapi
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: https://anunciosalpha.uazapi.com"
                    value={uazapiBaseUrl}
                    onChange={(e) => setUazapiBaseUrl(e.target.value)}
                    className="gads-input-field"
                    style={{ padding: "8px 12px", fontSize: "12px" }}
                  />
                </div>

                {activeTenant?.routingMode === "single" ? (
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                      Token Instância WhatsApp
                    </label>
                    <input
                      type="text"
                      placeholder="Cole o token da instância Uazapi"
                      value={uazapiSingleToken}
                      onChange={(e) => setUazapiSingleToken(e.target.value)}
                      className="gads-input-field"
                      style={{ padding: "8px 12px", fontSize: "12px" }}
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                        Token Instância {activeTenant?.attendants?.[0]?.name || "Atendente 1"}
                      </label>
                      <input
                        type="text"
                        placeholder="Cole o token da instância"
                        value={uazapiJosiToken}
                        onChange={(e) => setUazapiJosiToken(e.target.value)}
                        className="gads-input-field"
                        style={{ padding: "8px 12px", fontSize: "12px" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                        Token Instância {activeTenant?.attendants?.[1]?.name || "Atendente 2"}
                      </label>
                      <input
                        type="text"
                        placeholder="Cole o token da instância"
                        value={uazapiSergioToken}
                        onChange={(e) => setUazapiSergioToken(e.target.value)}
                        className="gads-input-field"
                        style={{ padding: "8px 12px", fontSize: "12px" }}
                      />
                    </div>
                  </>
                )}

                <div>
                  <button
                    type="submit"
                    disabled={isSavingUazapi}
                    style={{
                      width: "100%",
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#38bdf8",
                      borderRadius: "8px",
                      padding: "9px 14px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {isSavingUazapi ? "Salvando..." : "Salvar & Testar"}
                  </button>
                </div>
              </form>
            )}

            {(uazapiFeedback || entitiesStatus.uazapiStatus?.lastError) && (
              <div style={{ marginTop: "8px", fontSize: "12px", color: entitiesStatus.uazapiStatus?.lastError ? "#fde047" : "#34d399" }}>
                {uazapiFeedback && <div style={{ fontWeight: 600 }}>{uazapiFeedback}</div>}
                {entitiesStatus.uazapiStatus?.lastError && (
                  <div style={{ marginTop: "3px" }}>Aviso Uazapi: {entitiesStatus.uazapiStatus.lastError}</div>
                )}
              </div>
            )}
          </div>

          {/* ACORDEÃO RECOLHIDO POR PADRÃO: CONFIGURAÇÕES TÉCNICAS & DIAGNÓSTICO DO SISTEMA */}
          {(() => {
            const ociFailedCount = Math.max(
              entitiesStatus.ociStats?.failed ?? 0,
              ociDiagnostics?.stats?.failedCount ?? 0,
              realLeadEvents.filter((l) => l.status === "failed").length
            );
            const clientSum = ociDiagnostics?.officialDiagnostics?.clientSummary?.[0];
            const officialRatePct = clientSum ? Math.round(Number(clientSum.successRate || 0) * 100) : null;
            const availableActions = Array.isArray(ociDiagnostics?.availableConversionActions)
              ? ociDiagnostics.availableConversionActions
              : [];
            const officialAlerts = [
              ...(Array.isArray(clientSum?.alerts) ? clientSum.alerts : []),
              ...((Array.isArray(ociDiagnostics?.officialDiagnostics?.actionSummaries)
                ? ociDiagnostics.officialDiagnostics.actionSummaries
                : []
              ).flatMap((a: any) => (Array.isArray(a.alerts) ? a.alerts : []))),
            ];

            return (
              <div style={{ marginTop: "16px", background: "#090f20", border: `1px solid ${ociFailedCount > 0 ? "rgba(239,68,68,0.45)" : "#1e293b"}`, borderRadius: "10px", overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setShowAdvancedTech((v) => !v)}
                  style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    padding: "13px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px",
                    cursor: "pointer",
                    color: "#cbd5e1",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 700 }}>
                    <Lock size={14} color={ociFailedCount > 0 ? "#f87171" : "#64748b"} />
                    <span>Configurações Técnicas, Vínculo Google OCI & Backup (Avançado)</span>
                    {ociFailedCount > 0 ? (
                      <span style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5", padding: "2px 8px", borderRadius: "6px", fontSize: "11px" }}>
                        {ociFailedCount} falha(s) pendente(s)
                      </span>
                    ) : (
                      <span style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", padding: "2px 8px", borderRadius: "6px", fontSize: "11px" }}>
                        Envio automático ativo
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#64748b" }}>
                    <span>{showAdvancedTech ? "Ocultar" : "Expandir"}</span>
                    {showAdvancedTech ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </div>
                </button>

                {showAdvancedTech && (
                  <div style={{ padding: "16px", borderTop: "1px solid #1e293b", background: "#0b1329" }}>
                    <div
                      style={{
                        background: "#0f172a",
                        border: "1px solid #1e293b",
                        borderRadius: "8px",
                        padding: "8px 10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "8px",
                        fontSize: "11px",
                        marginBottom: "14px",
                      }}
                    >
                      <div style={{ color: "#94a3b8" }}>
                        <strong style={{ color: "#cbd5e1" }}>URL do Webhook (Uazapi — {activeTenant?.name || activeTenantSlug}):</strong>{" "}
                        <code style={{ color: "#38bdf8", wordBreak: "break-all" }}>
                          {typeof window !== "undefined"
                            ? `${window.location.origin}/api/webhooks/google-whatsapp?client=${activeTenantSlug}`
                            : `https://painel.anunciosalpha.com.br/api/webhooks/google-whatsapp?client=${activeTenantSlug}`}
                        </code>
                        <div style={{ color: "#64748b", marginTop: "3px" }}>
                          Marque na Uazapi os eventos: <code>messages</code>, <code>chats</code>, <code>chat_labels</code>, <code>labels</code>.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const url =
                            typeof window !== "undefined"
                              ? `${window.location.origin}/api/webhooks/google-whatsapp?client=${activeTenantSlug}`
                              : `https://painel.anunciosalpha.com.br/api/webhooks/google-whatsapp?client=${activeTenantSlug}`;
                          navigator.clipboard?.writeText(url).catch(() => {});
                          setUazapiFeedback("URL do Webhook copiada!");
                        }}
                        style={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          color: "#38bdf8",
                          borderRadius: "6px",
                          padding: "4px 9px",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <Copy size={11} /> Copiar Webhook
                      </button>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
                      <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                        Envio automático blindado (SHA-256 + <code>orderId</code> anti-duplicidade) • Armazenamento:{" "}
                        <strong style={{ color: "#38bdf8" }}>{entitiesStatus.storageDir || "/data"}</strong>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={handleDownloadBackup}
                          style={{
                            background: "#1e293b",
                            border: "1px solid #334155",
                            color: "#fff",
                            borderRadius: "8px",
                            padding: "7px 12px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Download size={13} /> Baixar Backup JSON ({realLeadEvents.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => fetchOciDiagnostics(true)}
                          disabled={isRefreshingOciDiag}
                          style={{
                            background: "#1e293b",
                            border: "1px solid #334155",
                            color: "#cbd5e1",
                            borderRadius: "8px",
                            padding: "7px 12px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <RefreshCw size={13} /> {isRefreshingOciDiag ? "Consultando..." : "Atualizar Diagnóstico Google"}
                        </button>
                        {ociFailedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => handleTriggerOciRetry()}
                            disabled={isSyncingOci}
                            style={{
                              background: "#dc2626",
                              border: "none",
                              color: "#ffffff",
                              borderRadius: "8px",
                              padding: "7px 12px",
                              fontSize: "12px",
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <RefreshCw size={13} /> {isSyncingOci ? "Reenviando..." : `Reenviar ${ociFailedCount} Falha(s)`}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Resumo compacto da fila OCI */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", marginBottom: "14px" }}>
                      <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>Aceitação Google</div>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: clientSum ? "#34d399" : "#94a3b8", marginTop: "3px" }}>
                          {officialRatePct !== null ? `${officialRatePct}% Aceitação` : ociDiagnostics?.apiConnected ? "API Ativa" : "Verificando..."}
                        </div>
                      </div>
                      <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>Fila de Envio (4h)</div>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginTop: "3px" }}>
                          {ociDiagnostics?.stats?.totalSent ?? entitiesStatus.ociStats?.sent ?? 0} env •{" "}
                          {ociDiagnostics?.stats?.waitingMaturation ?? 0} mat •{" "}
                          {ociDiagnostics?.stats?.readyToUpload ?? 0} prontos
                        </div>
                      </div>
                      <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "8px", padding: "10px 12px" }}>
                        <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700 }}>Ações de Conversão</div>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#c084fc", marginTop: "3px" }}>
                          {availableActions.length} encontradas na conta
                        </div>
                      </div>
                    </div>

                    {officialAlerts.length > 0 && (
                      <div style={{ marginBottom: "12px", padding: "10px 12px", background: "rgba(234, 179, 8, 0.12)", border: "1px solid rgba(234, 179, 8, 0.35)", borderRadius: "8px", fontSize: "12px", color: "#fde047" }}>
                        <strong>Alertas Google Ads:</strong>{" "}
                        {officialAlerts.map((al: any) => `${al.errorCode || "ALERTA"} (${al.errorMessage || ""})`).join(" • ")}
                      </div>
                    )}

                    {/* Vínculo manual (caso precise alterar no futuro) */}
                    <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "8px", padding: "12px", marginBottom: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                        <strong style={{ fontSize: "12px", color: "#e2e8f0" }}>
                          Vínculo com Ações de Conversão (Conta {ociDiagnostics?.customerId || activeTenant?.googleCustomerId || "MCC"})
                        </strong>
                        <button
                          type="button"
                          onClick={handleSaveOciMapping}
                          disabled={isSavingOciMapping}
                          style={{
                            background: "#1e293b",
                            border: "1px solid #334155",
                            color: "#38bdf8",
                            borderRadius: "6px",
                            padding: "5px 10px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {isSavingOciMapping ? "Salvando..." : "Salvar Vínculo"}
                        </button>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
                        {(
                          [
                            { key: "conversa_iniciada", label: "Conversa Iniciada" },
                            { key: "orcamento_enviado", label: "Orçamento Enviado" },
                            { key: "compra_realizada", label: "Compra Realizada (R$)" },
                          ] as const
                        ).map((st) => {
                          const summaryItem = (ociDiagnostics?.stageMappingSummary || []).find((m: any) => m.stage === st.key);
                          return (
                            <div key={st.key}>
                              <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#cbd5e1", marginBottom: "4px" }}>
                                {st.label}
                              </label>
                              <select
                                value={ociActionMapDraft[st.key]}
                                onChange={(e) =>
                                  setOciActionMapDraft((prev) => ({ ...prev, [st.key]: e.target.value }))
                                }
                                className="gads-select-field"
                                style={{ width: "100%", fontSize: "12px", padding: "7px 10px" }}
                              >
                                <option value="">
                                  {summaryItem?.resolvedActionName
                                    ? `Auto: ${summaryItem.resolvedActionName} (ID ${summaryItem.resolvedActionId})`
                                    : "Auto-detectar"}
                                </option>
                                {availableActions.map((act: any) => (
                                  <option key={act.id} value={act.id}>
                                    {act.name} [{act.type}] (ID {act.id})
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>

                      {ociMappingFeedback && (
                        <div style={{ marginTop: "8px", fontSize: "12px", color: "#34d399", fontWeight: 600 }}>
                          {ociMappingFeedback}
                        </div>
                      )}
                    </div>

                    {ociSyncResult && (
                      <div style={{ padding: "8px 12px", background: "#090f20", border: "1px solid #334155", borderRadius: "8px", fontSize: "12px", color: "#cbd5e1", marginBottom: "12px" }}>
                        Último lote: {ociSyncResult.uploadedCount || 0} enviado(s) • {ociSyncResult.failedCount || 0} falha(s)
                        {ociSyncResult.error && <span style={{ color: "#fca5a5" }}> • {ociSyncResult.error}</span>}
                      </div>
                    )}

                    {Array.isArray(ociDiagnostics?.items) && ociDiagnostics.items.length > 0 && (
                      <div className="gads-table-scroll">
                        <table className="gads-table">
                          <thead>
                            <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                              <th style={{ padding: "8px 10px" }}>Lead</th>
                              <th style={{ padding: "8px 10px" }}>Etapa & Ação</th>
                              <th style={{ padding: "8px 10px" }}>Status OCI</th>
                              <th style={{ padding: "8px 10px" }}>Detalhe</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ociDiagnostics.items.slice(0, 10).map((it: any) => (
                              <tr key={`${it.id}_${it.stage}`} style={{ borderBottom: "1px solid #0f172a" }}>
                                <td style={{ padding: "8px 10px", fontSize: "12px", color: "#fff" }}>
                                  {it.leadName} <small style={{ color: "#64748b" }}>({it.leadPhone})</small>
                                </td>
                                <td style={{ padding: "8px 10px", fontSize: "12px", color: "#cbd5e1" }}>
                                  {it.stage} → <span style={{ color: "#c084fc" }}>{it.resolvedConversionAction?.name || "—"}</span>
                                </td>
                                <td style={{ padding: "8px 10px", fontSize: "11px", fontWeight: 700 }}>
                                  {it.status === "sent" ? (
                                    <span style={{ color: "#34d399" }}>✓ Enviado</span>
                                  ) : it.status === "failed" ? (
                                    <span style={{ color: "#f87171" }}>✕ Falha</span>
                                  ) : it.status === "waiting_whatsapp" ? (
                                    <span style={{ color: "#facc15" }}>Só Clicou</span>
                                  ) : it.isMatured ? (
                                    <span style={{ color: "#38bdf8" }}>Pronto p/ Envio</span>
                                  ) : (
                                    <span style={{ color: "#94a3b8" }}>Maturando ({it.hoursRemaining}h)</span>
                                  )}
                                </td>
                                <td style={{ padding: "8px 10px", fontSize: "11px", color: it.ociError ? "#fca5a5" : "#64748b" }}>
                                  {it.ociError || it.ociResult || "—"}
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
          })()}
        </div>
      )}

      {/* =========================================================================
          ABA 6: QUADRO INTELIGENTE DE DECISÃO & BI AVANÇADO (PASSO 4)
         ========================================================================= */}
      {currentTab === "bi" && (() => {
        const insights = reportsData.decisionInsights;
        const searchLower = biSearchQuery.trim().toLowerCase();
        const sortComparator = (a: any, b: any) => {
          const av = Number(a?.[biSortField] ?? 0);
          const bv = Number(b?.[biSortField] ?? 0);
          return biSortDir === "desc" ? bv - av : av - bv;
        };

        const filteredTerms = (reportsData.searchTerms || [])
          .filter((t: any) => {
            if (biTermFilter === "NEGATIVAR" && t.recommendation !== "NEGATIVAR") return false;
            if (biTermFilter === "ESCALAR" && t.recommendation !== "ESCALAR") return false;
            if (biTermFilter === "PMAX" && t.source !== "PMAX") return false;
            if (!searchLower) return true;
            return (
              String(t.searchTerm || "").toLowerCase().includes(searchLower) ||
              String(t.campaign || "").toLowerCase().includes(searchLower) ||
              String(t.adGroup || "").toLowerCase().includes(searchLower)
            );
          })
          .sort(sortComparator);

        const filteredKeywords = (reportsData.keywordPerformance || [])
          .filter((k: any) => {
            if (!searchLower) return true;
            return (
              String(k.keyword || "").toLowerCase().includes(searchLower) ||
              String(k.campaign || "").toLowerCase().includes(searchLower) ||
              String(k.adGroup || "").toLowerCase().includes(searchLower)
            );
          })
          .sort(sortComparator);

        const filteredAdGroups = (reportsData.reports || [])
          .filter((r: any) => {
            if (!searchLower) return true;
            return (
              String(r.campaign || "").toLowerCase().includes(searchLower) ||
              String(r.adGroup || "").toLowerCase().includes(searchLower)
            );
          })
          .sort(sortComparator);

        const filteredAds = (reportsData.adPerformance || [])
          .filter((ad: any) => {
            if (!searchLower) return true;
            return (
              String(ad.headlinePreview || "").toLowerCase().includes(searchLower) ||
              String(ad.campaign || "").toLowerCase().includes(searchLower) ||
              String(ad.adGroup || "").toLowerCase().includes(searchLower)
            );
          })
          .sort(sortComparator);

        const adjustableList = Array.isArray(ociDiagnostics?.adjustableConversions)
          ? ociDiagnostics.adjustableConversions
          : [];

        return (
          <div className="gads-panel">
            {/* Cabeçalho BI */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "20px" }}>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#ffffff", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                  <Target size={19} color="#34d399" /> Quadro Inteligente de Decisão & BI de Tráfego (Google Ads)
                </h2>
                <p style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
                  Descubra exatamente onde está o desperdício de verba (para negativar), quais termos/palavras-chave convertem mais e onde escalar orçamento (cache 20m protegendo cota Exploração).
                </p>
                {reportsData.biCacheFetchedAt && (
                  <small style={{ color: "#94a3b8", fontSize: "11px" }}>
                    Última leitura Google Ads API: {new Date(reportsData.biCacheFetchedAt).toLocaleString("pt-BR")} ({reportsData.biFromCache ? "Cache /data" : "Atualizado ao vivo"})
                  </small>
                )}
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleCopyNegativeTerms}
                  style={{
                    background: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.35)",
                    color: "#fca5a5",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Copy size={14} /> Copiar Termos p/ Negativar
                </button>

                <button
                  type="button"
                  onClick={() => fetchData(true)}
                  disabled={isRefreshingBi}
                  style={{
                    background: "#2563eb",
                    border: "none",
                    color: "#ffffff",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    opacity: isRefreshingBi ? 0.6 : 1,
                  }}
                >
                  <RefreshCw size={14} style={{ transform: isRefreshingBi ? "rotate(180deg)" : "none", transition: "transform 0.4s" }} />
                  {isRefreshingBi ? "Atualizando API..." : "Atualizar BI Google Ads Agora"}
                </button>
              </div>
            </div>

            {copiedNegativesFeedback && (
              <div style={{ marginBottom: "14px", padding: "10px 14px", borderRadius: "8px", background: "rgba(16, 185, 129, 0.14)", border: "1px solid rgba(16, 185, 129, 0.4)", color: "#34d399", fontSize: "12px", fontWeight: 600 }}>
                {copiedNegativesFeedback}
              </div>
            )}

            {/* Cards Executivos de Decisão */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginBottom: "20px" }}>
              <div style={{ background: "#090f20", border: "1px solid rgba(239, 68, 68, 0.35)", borderRadius: "10px", padding: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#f87171", textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                  <span>Desperdício p/ Negativar</span>
                  <AlertTriangle size={14} color="#f87171" />
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#fca5a5", marginTop: "4px" }}>
                  R$ {(insights?.wastedTermsCost || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                  {insights?.wastedTermsCount || 0} termo(s) sem leads/vendas no período
                </div>
              </div>

              <div style={{ background: "#090f20", border: "1px solid rgba(16, 185, 129, 0.35)", borderRadius: "10px", padding: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#34d399", textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                  <span>Melhor Conjunto (Lucro)</span>
                  <Award size={14} color="#34d399" />
                </div>
                <div style={{ fontSize: "15px", fontWeight: 800, color: "#ffffff", marginTop: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {insights?.bestAdGroup?.adGroup || "Aguardando conversões"}
                </div>
                <div style={{ fontSize: "11px", color: "#34d399", marginTop: "3px" }}>
                  {insights?.bestAdGroup
                    ? `ROAS ${insights.bestAdGroup.roas}x • Lucro R$ ${Number(insights.bestAdGroup.profit || 0).toFixed(2)}`
                    : "Atribua leads/vendas para ranquear"}
                </div>
              </div>

              <div style={{ background: "#090f20", border: "1px solid rgba(56, 189, 248, 0.35)", borderRadius: "10px", padding: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                  <span>Palavra-Chave Campeã</span>
                  <KeyRound size={14} color="#38bdf8" />
                </div>
                <div style={{ fontSize: "15px", fontWeight: 800, color: "#ffffff", marginTop: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {insights?.bestKeyword?.keyword || "Aguardando atribuição"}
                </div>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "3px" }}>
                  {insights?.bestKeyword
                    ? `${insights.bestKeyword.whatsappLeads} leads • ${insights.bestKeyword.whatsappSalesCount} vendas • ROAS ${insights.bestKeyword.roas}x`
                    : "Cruzamento automático com WhatsApp"}
                </div>
              </div>

              <div style={{ background: "#090f20", border: "1px solid rgba(192, 132, 252, 0.35)", borderRadius: "10px", padding: "14px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#c084fc", textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                  <span>Escala Travada (Orçamento)</span>
                  <Flame size={14} color="#c084fc" />
                </div>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#e9d5ff", marginTop: "4px" }}>
                  {insights?.budgetOpportunityCampaigns?.length || 0} Campanha(s)
                </div>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
                  {insights?.budgetOpportunityCampaigns?.[0]
                    ? `${insights.budgetOpportunityCampaigns[0].campaign} (-${insights.budgetOpportunityCampaigns[0].budgetLostSharePct}% impr.)`
                    : "Perdendo >= 15% por orçamento com retorno"}
                </div>
              </div>
            </div>

            {/* Filtros de Período + Busca + Ordenação */}
            <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px", marginBottom: "18px" }}>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                {(
                  [
                    { id: "all", label: "Últimos 30 dias / Todos" },
                    { id: "today", label: "Hoje" },
                    { id: "yesterday", label: "Ontem" },
                    { id: "7d", label: "Últimos 7 dias" },
                    { id: "30d", label: "Últimos 30 dias" },
                    { id: "this_month", label: "Este Mês" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleDatePresetChange(p.id)}
                    className={`date-preset-btn ${reportDatePreset === p.id ? "active" : ""}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))", gap: "10px" }}>
                <div className="gads-search-box" style={{ width: "100%" }}>
                  <Search size={14} color="#64748b" style={{ position: "absolute", left: "11px", top: "11px" }} />
                  <input
                    type="text"
                    placeholder="Filtrar termo, keyword, campanha..."
                    value={biSearchQuery}
                    onChange={(e) => setBiSearchQuery(e.target.value)}
                    className="gads-input-field"
                  />
                </div>

                <select
                  value={reportCampaign}
                  onChange={(e) => setReportCampaign(e.target.value)}
                  className="gads-select-field"
                >
                  <option value="all">Todas as Campanhas</option>
                  {uniqueCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                <select
                  value={reportAdGroup}
                  onChange={(e) => setReportAdGroup(e.target.value)}
                  className="gads-select-field"
                >
                  <option value="all">Todos os Conjuntos</option>
                  {uniqueAdGroups.map((ad) => (
                    <option key={ad.id} value={ad.id}>{ad.name}</option>
                  ))}
                </select>

                <select
                  value={biSortField}
                  onChange={(e) => setBiSortField(e.target.value as any)}
                  className="gads-select-field"
                >
                  <option value="cost">Ordenar por: Maior Gasto (R$)</option>
                  <option value="clicks">Ordenar por: Cliques</option>
                  <option value="impressions">Ordenar por: Impressões</option>
                  <option value="whatsappLeads">Ordenar por: Leads WhatsApp</option>
                  <option value="whatsappSalesCount">Ordenar por: Vendas</option>
                  <option value="profit">Ordenar por: Lucro Líquido</option>
                  <option value="roas">Ordenar por: ROAS Real</option>
                </select>

                <button
                  type="button"
                  onClick={() => setBiSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                  style={{
                    background: "#0f172a",
                    border: "1px solid #334155",
                    color: "#cbd5e1",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <ArrowUpDown size={13} /> {biSortDir === "desc" ? "Maior -> Menor" : "Menor -> Maior"}
                </button>
              </div>
            </div>

            {/* Sub-Abas do BI Avançado */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "18px" }}>
              {(
                [
                  { id: "termos", label: `1. Termos de Pesquisa (${(reportsData.searchTerms || []).length})` },
                  { id: "keywords", label: `2. Palavras-Chave (${(reportsData.keywordPerformance || []).length})` },
                  { id: "conjuntos", label: `3. Conjuntos & Saúde Campanhas (${(reportsData.campaignHealth || []).length})` },
                  { id: "anuncios", label: `4. Anúncios & Ajustes RESTATE/RETRACT (${(reportsData.adPerformance || []).length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBiSubTab(tab.id)}
                  style={{
                    background: biSubTab === tab.id ? "#1d4ed8" : "#0f172a",
                    border: `1px solid ${biSubTab === tab.id ? "#3b82f6" : "#1e293b"}`,
                    color: biSubTab === tab.id ? "#ffffff" : "#94a3b8",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* SUB-ABA 1: TERMOS DE PESQUISA (SEARCH + PMAX) */}
            {biSubTab === "termos" && (
              <div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
                  {(
                    [
                      { id: "all", label: "Todos os Termos" },
                      { id: "NEGATIVAR", label: "⚠️ Para Negativar (Gastou sem Lead)" },
                      { id: "ESCALAR", label: "🏆 Campeões de Venda / ROAS" },
                      { id: "PMAX", label: "⚡ Termos Performance Max (PMax)" },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setBiTermFilter(f.id)}
                      className={`date-preset-btn ${biTermFilter === f.id ? "active" : ""}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="gads-table-scroll">
                  <table className="gads-table">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                        <th style={{ padding: "10px 12px" }}>Termo Digitado no Google</th>
                        <th style={{ padding: "10px 12px" }}>Campanha / Conjunto</th>
                        <th style={{ padding: "10px 12px" }}>Impr. / Cliques / CTR</th>
                        <th style={{ padding: "10px 12px" }}>CPC / Gasto (R$)</th>
                        <th style={{ padding: "10px 12px" }}>Leads / Vendas</th>
                        <th style={{ padding: "10px 12px" }}>Decisão Recomendada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTerms.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center", padding: "28px", color: "#64748b" }}>
                            Nenhum termo de pesquisa encontrado neste filtro.
                          </td>
                        </tr>
                      ) : (
                        filteredTerms.slice(0, 120).map((t: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #0f172a" }}>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: "#ffffff", fontWeight: 700 }}>{t.searchTerm}</div>
                              <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>
                                {t.source} • {t.matchType} • Status: {t.status}
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", color: "#cbd5e1", fontSize: "12px" }}>
                              <div>{t.campaign}</div>
                              <small style={{ color: "#64748b" }}>{t.adGroup}</small>
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: "12px", color: "#94a3b8" }}>
                              <div><strong style={{ color: "#fff" }}>{t.clicks}</strong> cl. / {t.impressions} imp.</div>
                              <small>{t.ctr}% CTR</small>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: t.cost >= 30 && t.whatsappLeads === 0 ? "#fca5a5" : "#ffffff", fontWeight: 700 }}>
                                R$ {t.cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </div>
                              <small style={{ color: "#64748b" }}>CPC R$ {t.cpc.toFixed(2)}</small>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: t.whatsappLeads > 0 ? "#38bdf8" : "#64748b", fontWeight: 700 }}>
                                {t.whatsappLeads} lead(s)
                              </div>
                              <small style={{ color: t.whatsappSalesCount > 0 ? "#34d399" : "#64748b" }}>
                                {t.whatsappSalesCount} venda(s) {t.roas > 0 ? `• ${t.roas}x ROAS` : ""}
                              </small>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              {t.recommendation === "NEGATIVAR" ? (
                                <span style={{ background: "rgba(239, 68, 68, 0.16)", color: "#f87171", border: "1px solid rgba(239, 68, 68, 0.35)", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                                  ⚠️ NEGATIVAR
                                </span>
                              ) : t.recommendation === "ESCALAR" ? (
                                <span style={{ background: "rgba(16, 185, 129, 0.16)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.35)", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 700 }}>
                                  🏆 ESCALAR
                                </span>
                              ) : (
                                <span style={{ color: "#94a3b8", fontSize: "11px", fontWeight: 600 }}>Manter</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* SUB-ABA 2: PALAVRAS-CHAVE (keyword_view) */}
            {biSubTab === "keywords" && (
              <div className="gads-table-scroll">
                <table className="gads-table">
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                      <th style={{ padding: "10px 12px" }}>Palavra-Chave (Match)</th>
                      <th style={{ padding: "10px 12px" }}>Conjunto / Campanha</th>
                      <th style={{ padding: "10px 12px" }}>Cliques / Impr. / CTR</th>
                      <th style={{ padding: "10px 12px" }}>Gasto / CPC</th>
                      <th style={{ padding: "10px 12px" }}>Leads / CPL</th>
                      <th style={{ padding: "10px 12px" }}>Vendas / CAC / ROAS</th>
                      <th style={{ padding: "10px 12px" }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKeywords.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "28px", color: "#64748b" }}>
                          Nenhuma palavra-chave encontrada no filtro atual.
                        </td>
                      </tr>
                    ) : (
                      filteredKeywords.slice(0, 120).map((k: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #0f172a" }}>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ color: "#38bdf8", fontWeight: 700 }}>{k.keyword}</div>
                            <small style={{ color: "#94a3b8" }}>{k.matchType} • {k.status}</small>
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: "12px", color: "#cbd5e1" }}>
                            <div>{k.adGroup}</div>
                            <small style={{ color: "#64748b" }}>{k.campaign}</small>
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: "12px", color: "#94a3b8" }}>
                            <div><strong style={{ color: "#fff" }}>{k.clicks}</strong> / {k.impressions}</div>
                            <small>{k.ctr}% CTR</small>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ color: "#fff", fontWeight: 700 }}>R$ {k.cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                            <small style={{ color: "#64748b" }}>CPC R$ {k.cpc.toFixed(2)}</small>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ color: "#fff", fontWeight: 700 }}>{k.whatsappLeads} ({k.whatsappQuotes} orç.)</div>
                            <small style={{ color: "#94a3b8" }}>{k.cpl > 0 ? `CPL R$ ${k.cpl.toFixed(2)}` : "—"}</small>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <div style={{ color: "#34d399", fontWeight: 700 }}>
                              {k.whatsappSalesCount}v • R$ {Number(k.whatsappRevenue || 0).toLocaleString("pt-BR")}
                            </div>
                            <small style={{ color: "#94a3b8" }}>
                              {k.roas}x ROAS {k.cac > 0 ? `• CAC R$ ${k.cac.toFixed(0)}` : ""}
                            </small>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <span
                              style={{
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: 700,
                                background:
                                  k.decisionTag === "ESCALAR"
                                    ? "rgba(16, 185, 129, 0.16)"
                                    : k.decisionTag === "DESPERDÍCIO"
                                      ? "rgba(239, 68, 68, 0.16)"
                                      : "rgba(59, 130, 246, 0.15)",
                                color:
                                  k.decisionTag === "ESCALAR"
                                    ? "#34d399"
                                    : k.decisionTag === "DESPERDÍCIO"
                                      ? "#f87171"
                                      : "#60a5fa",
                              }}
                            >
                              {k.decisionTag}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* SUB-ABA 3: CONJUNTOS & SAÚDE DAS CAMPANHAS (IMPRESSION SHARE LOST) */}
            {biSubTab === "conjuntos" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff", marginBottom: "8px" }}>
                    Saúde das Campanhas & Oportunidade de Escala (Parcela de Impressão Perdida)
                  </h3>
                  <div className="gads-table-scroll">
                    <table className="gads-table">
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                          <th style={{ padding: "10px 12px" }}>Campanha (Canal)</th>
                          <th style={{ padding: "10px 12px" }}>Gasto / Cliques</th>
                          <th style={{ padding: "10px 12px" }}>Impr. Share Atual</th>
                          <th style={{ padding: "10px 12px" }}>Perdida Orçamento</th>
                          <th style={{ padding: "10px 12px" }}>Perdida Rank</th>
                          <th style={{ padding: "10px 12px" }}>Leads / Vendas / ROAS</th>
                          <th style={{ padding: "10px 12px" }}>Decisão</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(reportsData.campaignHealth || []).map((c: any) => (
                          <tr key={c.campaignId} style={{ borderBottom: "1px solid #0f172a" }}>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: "#fff", fontWeight: 700 }}>{c.campaign}</div>
                              <small style={{ color: "#64748b" }}>{c.channelType} • {c.status}</small>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: "#fff", fontWeight: 700 }}>R$ {c.cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                              <small style={{ color: "#94a3b8" }}>{c.clicks} cl. ({c.ctr}% CTR)</small>
                            </td>
                            <td style={{ padding: "10px 12px", color: "#38bdf8", fontWeight: 700 }}>
                              {c.searchImpressionSharePct !== null ? `${c.searchImpressionSharePct}%` : "N/A"}
                            </td>
                            <td style={{ padding: "10px 12px", color: (c.budgetLostSharePct || 0) >= 15 ? "#facc15" : "#94a3b8", fontWeight: 700 }}>
                              {c.budgetLostSharePct !== null ? `${c.budgetLostSharePct}%` : "N/A"}
                            </td>
                            <td style={{ padding: "10px 12px", color: (c.rankLostSharePct || 0) >= 35 ? "#f87171" : "#94a3b8", fontWeight: 700 }}>
                              {c.rankLostSharePct !== null ? `${c.rankLostSharePct}%` : "N/A"}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: "#34d399", fontWeight: 700 }}>
                                {c.whatsappLeads}L / {c.whatsappSalesCount}V • {c.roas}x
                              </div>
                              <small style={{ color: "#94a3b8" }}>Lucro R$ {Number(c.profit || 0).toFixed(2)}</small>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <span
                                style={{
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  background:
                                    c.decisionTag === "ESCALAR ORÇAMENTO"
                                      ? "rgba(16, 185, 129, 0.16)"
                                      : c.decisionTag === "REVISAR / PAUSAR"
                                        ? "rgba(239, 68, 68, 0.16)"
                                        : "rgba(59, 130, 246, 0.15)",
                                  color:
                                    c.decisionTag === "ESCALAR ORÇAMENTO"
                                      ? "#34d399"
                                      : c.decisionTag === "REVISAR / PAUSAR"
                                        ? "#f87171"
                                        : "#60a5fa",
                                }}
                              >
                                {c.decisionTag}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff", marginBottom: "8px" }}>
                    Ranking Completo de Conjuntos de Anúncios
                  </h3>
                  <div className="gads-table-scroll">
                    <table className="gads-table">
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                          <th style={{ padding: "10px 12px" }}>Conjunto / Campanha</th>
                          <th style={{ padding: "10px 12px" }}>Gasto (R$)</th>
                          <th style={{ padding: "10px 12px" }}>Leads / CPL</th>
                          <th style={{ padding: "10px 12px" }}>Vendas / Taxa / CAC</th>
                          <th style={{ padding: "10px 12px" }}>Lucro Líquido</th>
                          <th style={{ padding: "10px 12px" }}>ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAdGroups.map((r: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: "1px solid #0f172a" }}>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: "#38bdf8", fontWeight: 700 }}>{r.adGroup}</div>
                              <small style={{ color: "#64748b" }}>{r.campaign}</small>
                            </td>
                            <td style={{ padding: "10px 12px", color: "#fff", fontWeight: 600 }}>
                              R$ {Number(r.cost || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: "#fff", fontWeight: 700 }}>{r.whatsappLeads} ({r.whatsappQuotes} orç.)</div>
                              <small style={{ color: "#94a3b8" }}>{r.cpl > 0 ? `CPL R$ ${r.cpl.toFixed(2)}` : "—"}</small>
                            </td>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ color: "#34d399", fontWeight: 700 }}>
                                {r.whatsappSalesCount}v • R$ {Number(r.whatsappRevenue || 0).toLocaleString("pt-BR")}
                              </div>
                              <small style={{ color: "#94a3b8" }}>
                                {r.conversionRate || 0}% conv. {r.cac > 0 ? `• CAC R$ ${r.cac.toFixed(0)}` : ""}
                              </small>
                            </td>
                            <td style={{ padding: "10px 12px", color: r.profit >= 0 ? "#34d399" : "#f87171", fontWeight: 700 }}>
                              R$ {Number(r.profit || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: "10px 12px", fontWeight: 800, color: r.roas >= 4 ? "#34d399" : "#60a5fa" }}>
                              {r.roas}x
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* SUB-ABA 4: ANÚNCIOS (ad_group_ad) + AJUSTES DE CONVERSÃO RESTATE / RETRACT */}
            {biSubTab === "anuncios" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#ffffff", marginBottom: "8px" }}>
                    Desempenho por Anúncio (Cruzado via click_view)
                  </h3>
                  <div className="gads-table-scroll">
                    <table className="gads-table">
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                          <th style={{ padding: "10px 12px" }}>Anúncio (Títulos Principais)</th>
                          <th style={{ padding: "10px 12px" }}>Conjunto / Campanha</th>
                          <th style={{ padding: "10px 12px" }}>Cliques / Impr. / CTR</th>
                          <th style={{ padding: "10px 12px" }}>Gasto / CPC</th>
                          <th style={{ padding: "10px 12px" }}>Leads / Vendas</th>
                          <th style={{ padding: "10px 12px" }}>ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAds.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: "center", padding: "24px", color: "#64748b" }}>
                              Nenhum anúncio com impressões neste período.
                            </td>
                          </tr>
                        ) : (
                          filteredAds.map((ad: any) => (
                            <tr key={`${ad.adGroupId}_${ad.adId}`} style={{ borderBottom: "1px solid #0f172a" }}>
                              <td style={{ padding: "10px 12px" }}>
                                <div style={{ color: "#fff", fontWeight: 700 }}>{ad.headlinePreview}</div>
                                <small style={{ color: "#64748b" }}>ID {ad.adId} • {ad.adType}</small>
                              </td>
                              <td style={{ padding: "10px 12px", fontSize: "12px", color: "#cbd5e1" }}>
                                <div>{ad.adGroup}</div>
                                <small style={{ color: "#64748b" }}>{ad.campaign}</small>
                              </td>
                              <td style={{ padding: "10px 12px", fontSize: "12px", color: "#94a3b8" }}>
                                <div><strong style={{ color: "#fff" }}>{ad.clicks}</strong> / {ad.impressions}</div>
                                <small>{ad.ctr}% CTR</small>
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                <div style={{ color: "#fff", fontWeight: 700 }}>R$ {ad.cost.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                                <small style={{ color: "#64748b" }}>CPC R$ {ad.cpc.toFixed(2)}</small>
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                <div style={{ color: "#38bdf8", fontWeight: 700 }}>{ad.whatsappLeads} lead(s)</div>
                                <small style={{ color: "#34d399" }}>{ad.whatsappSalesCount} venda(s)</small>
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 800, color: ad.roas >= 3 ? "#34d399" : "#60a5fa" }}>
                                {ad.roas}x
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Painel de Ajustes de Conversão RESTATEMENT / RETRACTION */}
                <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "16px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#38bdf8", margin: "0 0 6px" }}>
                    Ajustes de Conversões Enviadas (ConversionAdjustment — RESTATE / RETRACT via orderId)
                  </h3>
                  <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 12px" }}>
                    Se uma venda já enviada ao Google Ads teve alteração de valor ou foi cancelada/estornada no WhatsApp, envie o ajuste exato vinculado ao mesmo <code>orderId</code> para manter o Smart Bidding calibrado.
                  </p>

                  {adjustmentFeedback && (
                    <div style={{ marginBottom: "12px", padding: "9px 12px", borderRadius: "8px", background: "rgba(56, 189, 248, 0.14)", border: "1px solid rgba(56, 189, 248, 0.35)", color: "#bae6fd", fontSize: "12px", fontWeight: 600 }}>
                      {adjustmentFeedback}
                    </div>
                  )}

                  {adjustableList.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "#64748b", padding: "16px", background: "#060b18", borderRadius: "8px", textAlign: "center" }}>
                      Nenhuma venda enviada ao Google Ads (com <code>orderId</code> de compra) disponível para ajuste ainda.
                    </div>
                  ) : (
                    <div className="gads-table-scroll">
                      <table className="gads-table">
                        <thead>
                          <tr style={{ borderBottom: "1px solid #1e293b", textAlign: "left", color: "#64748b" }}>
                            <th style={{ padding: "8px 10px" }}>Cliente</th>
                            <th style={{ padding: "8px 10px" }}>orderId Google</th>
                            <th style={{ padding: "8px 10px" }}>Valor Enviado</th>
                            <th style={{ padding: "8px 10px" }}>Ajustes</th>
                            <th style={{ padding: "8px 10px", textAlign: "right" }}>Ações RESTATE / RETRACT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adjustableList.map((adj: any) => (
                            <tr key={adj.id} style={{ borderBottom: "1px solid #0f172a" }}>
                              <td style={{ padding: "8px 10px" }}>
                                <div style={{ color: "#fff", fontWeight: 600 }}>{adj.leadName}</div>
                                <small style={{ color: "#64748b" }}>{adj.leadPhone}</small>
                              </td>
                              <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: "11px", color: "#94a3b8" }}>
                                {adj.orderId}
                              </td>
                              <td style={{ padding: "8px 10px", color: "#34d399", fontWeight: 700 }}>
                                R$ {Number(adj.sentValue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </td>
                              <td style={{ padding: "8px 10px", fontSize: "11px", color: "#cbd5e1" }}>
                                {adj.conversionAdjustments?.length || 0} ajuste(s)
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right" }}>
                                {editingAdjustmentLeadId === adj.id ? (
                                  <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={adjustmentValueDraft}
                                      onChange={(e) => setAdjustmentValueDraft(e.target.value)}
                                      placeholder="Novo R$"
                                      className="gads-input-field"
                                      style={{ width: "110px", padding: "5px 8px", fontSize: "12px" }}
                                    />
                                    <button
                                      type="button"
                                      disabled={isSendingAdjustment}
                                      onClick={() =>
                                        handleSendConversionAdjustment(
                                          adj.id,
                                          "RESTATEMENT",
                                          parseFloat(adjustmentValueDraft || "0")
                                        )
                                      }
                                      style={{ background: "#059669", color: "#fff", border: "none", borderRadius: "6px", padding: "6px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
                                    >
                                      Confirmar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingAdjustmentLeadId(null)}
                                      style={{ background: "#1e293b", color: "#94a3b8", border: "none", borderRadius: "6px", padding: "6px 8px", fontSize: "11px", cursor: "pointer" }}
                                    >
                                      Cancelar
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ display: "inline-flex", gap: "6px" }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingAdjustmentLeadId(adj.id);
                                        setAdjustmentValueDraft(String(adj.value || adj.sentValue || 0));
                                      }}
                                      style={{ background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.35)", color: "#38bdf8", borderRadius: "6px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
                                    >
                                      Ajustar Valor (RESTATE)
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isSendingAdjustment}
                                      onClick={() => handleSendConversionAdjustment(adj.id, "RETRACTION")}
                                      style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.35)", color: "#f87171", borderRadius: "6px", padding: "5px 10px", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}
                                    >
                                      Estornar (RETRACT)
                                    </button>
                                  </div>
                                )}
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
      })()}

      {/* =========================================================================
          ABA 7: CLIENTES & ACESSOS (EXCLUSIVA DO GESTOR — PASSO M3)
         ========================================================================= */}
      {currentTab === "clientes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div className="gads-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
              <div>
                <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#fff", margin: 0 }}>
                  Clientes Google Ads Cadastrados ({tenantsList.length})
                </h2>
                <p style={{ color: "#94a3b8", fontSize: "13px", margin: "4px 0 0" }}>
                  Cada cliente possui dados, funil, regras de conversão e Uazapi 100% isolados em <code>/data/tenants/&lt;slug&gt;/</code>.
                </p>
              </div>
              {copiedHelperMsg && (
                <span style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.4)", color: "#6ee7b7", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700 }}>
                  {copiedHelperMsg}
                </span>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(310px, 1fr))", gap: "14px" }}>
              {tenantsList.map((t) => {
                const isSelected = t.slug === activeTenantSlug;
                const originUrl =
                  typeof window !== "undefined" ? window.location.origin : "https://painel.anunciosalpha.com.br";
                const trackLink = `${originUrl}/r/${t.slug}`;
                const webhookUrl = `${originUrl}/api/webhooks/google-whatsapp?client=${t.slug}`;
                const lpSnippet = `<script src="${originUrl}/alpha-track.js"></script>\n<!-- Link do botão WhatsApp na LP: ${trackLink} -->`;

                return (
                  <div
                    key={t.slug}
                    style={{
                      background: "#090f20",
                      border: `1px solid ${isSelected ? "#3b82f6" : "#1e293b"}`,
                      borderRadius: "12px",
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                      <div>
                        <div style={{ fontSize: "15px", fontWeight: 700, color: "#fff" }}>{t.name}</div>
                        <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                          /r/<strong>{t.slug}</strong> · Conta Ads:{" "}
                          <strong style={{ color: "#cbd5e1", fontVariantNumeric: "tabular-nums" }}>
                            {t.googleCustomerId || "Sem ID"}
                          </strong>
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: t.routingMode === "single" ? "#38bdf8" : "#c084fc",
                        }}
                      >
                        {t.routingMode === "single" ? "1 WhatsApp" : `Roleta (${t.attendants.length})`}
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", color: "#cbd5e1", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      <span>
                        Uazapi:{" "}
                        <strong style={{ color: t.uazapi?.configured ? "#34d399" : "#fbbf24" }}>
                          {t.uazapi?.configured ? "Configurada" : "Pendente"}
                        </strong>
                      </span>
                      <span>·</span>
                      <span>
                        Portal Cliente:{" "}
                        <strong style={{ color: t.clientAccess?.enabled ? "#34d399" : "#94a3b8" }}>
                          {t.clientAccess?.enabled
                            ? `Ativo (${t.clientAccess.users.length} usuário)`
                            : "Desativado"}
                        </strong>
                      </span>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                      <button
                        type="button"
                        onClick={() => {
                          handleSelectTenant(t.slug);
                          setCurrentTab("overview");
                        }}
                        style={{
                          background: isSelected ? "#2563eb" : "#1e293b",
                          border: "1px solid #334155",
                          color: "#fff",
                          borderRadius: "7px",
                          padding: "6px 10px",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {isSelected ? "Painel Aberto" : "Abrir Painel"}
                      </button>

                      <button
                        type="button"
                        onClick={() => startEditingTenant(t)}
                        style={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          borderRadius: "7px",
                          padding: "6px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(trackLink).catch(() => {});
                          setCopiedHelperMsg(`Link ${trackLink} copiado!`);
                          setTimeout(() => setCopiedHelperMsg(null), 2500);
                        }}
                        style={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          color: "#38bdf8",
                          borderRadius: "7px",
                          padding: "6px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Copiar /r/{t.slug}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(webhookUrl).catch(() => {});
                          setCopiedHelperMsg(`Webhook de ${t.name} copiado!`);
                          setTimeout(() => setCopiedHelperMsg(null), 2500);
                        }}
                        style={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          color: "#34d399",
                          borderRadius: "7px",
                          padding: "6px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Copiar Webhook
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(lpSnippet).catch(() => {});
                          setCopiedHelperMsg(`Script da LP (${t.name}) copiado!`);
                          setTimeout(() => setCopiedHelperMsg(null), 2500);
                        }}
                        style={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          color: "#e2e8f0",
                          borderRadius: "7px",
                          padding: "6px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Copiar Script LP
                      </button>

                      {t.slug !== "cnac" && (
                        <button
                          type="button"
                          onClick={() => handleDeleteTenant(t.slug, t.name)}
                          style={{
                            background: "rgba(239,68,68,0.14)",
                            border: "1px solid rgba(239,68,68,0.35)",
                            color: "#fca5a5",
                            borderRadius: "7px",
                            padding: "6px 9px",
                            fontSize: "11px",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: "20px" }}>
            {/* FORMULÁRIO CADASTRO / EDIÇÃO DE CLIENTE + INTEGRACAO UAZAPI */}
            <form onSubmit={handleSaveTenantSubmit} className="gads-panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#fff", margin: 0 }}>
                  {editingTenantSlug ? `Editar Cliente: ${tenantFormName}` : "Cadastrar Novo Cliente Google Ads"}
                </h3>
                {editingTenantSlug && (
                  <button
                    type="button"
                    onClick={resetTenantForm}
                    style={{ background: "#1e293b", border: "1px solid #334155", color: "#cbd5e1", borderRadius: "6px", padding: "5px 10px", fontSize: "11px", cursor: "pointer" }}
                  >
                    + Novo Cadastro
                  </button>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
                    Nome da Empresa *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Clínica Sorriso"
                    value={tenantFormName}
                    onChange={(e) => {
                      setTenantFormName(e.target.value);
                      if (!editingTenantSlug) {
                        setTenantFormSlug(slugifyClientName(e.target.value));
                      }
                    }}
                    className="gads-input-field"
                    style={{ padding: "9px 12px" }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
                    Slug do Link (/r/slug) *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingTenantSlug)}
                    placeholder="ex: clinica-sorriso"
                    value={tenantFormSlug}
                    onChange={(e) => setTenantFormSlug(slugifyClientName(e.target.value))}
                    className="gads-input-field"
                    style={{ padding: "9px 12px", opacity: editingTenantSlug ? 0.65 : 1 }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
                    Customer ID Google Ads (MCC)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 123-456-7890"
                    value={tenantFormCustomerId}
                    onChange={(e) => setTenantFormCustomerId(e.target.value)}
                    className="gads-input-field"
                    style={{ padding: "9px 12px" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "6px" }}>
                  Modo de Atendimento no WhatsApp
                </label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setTenantFormRoutingMode("single")}
                    style={{
                      flex: 1,
                      minWidth: "180px",
                      padding: "9px 12px",
                      borderRadius: "8px",
                      border: `1px solid ${tenantFormRoutingMode === "single" ? "#3b82f6" : "#334155"}`,
                      background: tenantFormRoutingMode === "single" ? "rgba(37,99,235,0.2)" : "#0f172a",
                      color: tenantFormRoutingMode === "single" ? "#fff" : "#94a3b8",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    1 Único WhatsApp (Padrão)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTenantFormRoutingMode("roulette")}
                    style={{
                      flex: 1,
                      minWidth: "180px",
                      padding: "9px 12px",
                      borderRadius: "8px",
                      border: `1px solid ${tenantFormRoutingMode === "roulette" ? "#a855f7" : "#334155"}`,
                      background: tenantFormRoutingMode === "roulette" ? "rgba(168,85,247,0.2)" : "#0f172a",
                      color: tenantFormRoutingMode === "roulette" ? "#fff" : "#94a3b8",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    Roleta Multi-Atendentes (Opcional)
                  </button>
                </div>
              </div>

              {tenantFormRoutingMode === "single" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
                      Nome do Atendimento
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Comercial"
                      value={tenantFormAttendantName}
                      onChange={(e) => setTenantFormAttendantName(e.target.value)}
                      className="gads-input-field"
                      style={{ padding: "9px 12px" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
                      WhatsApp com DDI 55 + DDD *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="5521999998888"
                      value={tenantFormAttendantPhone}
                      onChange={(e) => setTenantFormAttendantPhone(e.target.value)}
                      className="gads-input-field"
                      style={{ padding: "9px 12px" }}
                    />
                    {tenantFormAttendantPhone.replace(/\D/g, "").length > 4 &&
                      !isBrazilianPhoneDdiValid(tenantFormAttendantPhone) && (
                        <small style={{ color: "#fbbf24", fontSize: "11px", display: "block", marginTop: "3px" }}>
                          Inclua DDI 55 + DDD + 8/9 dígitos (ex: 5511999998888).
                        </small>
                      )}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "#cbd5e1" }}>Atendentes da Roleta</span>
                    <button
                      type="button"
                      onClick={() =>
                        setTenantFormRouletteAttendants((prev) => [
                          ...prev,
                          { name: `Atendente ${prev.length + 1}`, phone: "55", uazapiToken: "" },
                        ])
                      }
                      style={{ background: "#1e293b", border: "1px solid #334155", color: "#38bdf8", borderRadius: "6px", padding: "4px 8px", fontSize: "11px", cursor: "pointer" }}
                    >
                      + Adicionar Atendente
                    </button>
                  </div>
                  {tenantFormRouletteAttendants.map((att, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "6px", alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Nome"
                        value={att.name}
                        onChange={(e) =>
                          setTenantFormRouletteAttendants((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, name: e.target.value } : row))
                          )
                        }
                        className="gads-input-field"
                        style={{ padding: "7px 10px", fontSize: "12px" }}
                      />
                      <input
                        type="text"
                        placeholder="55219..."
                        value={att.phone}
                        onChange={(e) =>
                          setTenantFormRouletteAttendants((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, phone: e.target.value } : row))
                          )
                        }
                        className="gads-input-field"
                        style={{ padding: "7px 10px", fontSize: "12px" }}
                      />
                      <input
                        type="text"
                        placeholder="Token Uazapi"
                        value={att.uazapiToken}
                        onChange={(e) =>
                          setTenantFormRouletteAttendants((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, uazapiToken: e.target.value } : row))
                          )
                        }
                        className="gads-input-field"
                        style={{ padding: "7px 10px", fontSize: "12px" }}
                      />
                      {tenantFormRouletteAttendants.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setTenantFormRouletteAttendants((prev) => prev.filter((_, i) => i !== idx))
                          }
                          style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer" }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
                  Mensagem Inicial Automática do Botão WhatsApp
                </label>
                <input
                  type="text"
                  value={tenantFormInitialMsg}
                  onChange={(e) => setTenantFormInitialMsg(e.target.value)}
                  placeholder="Olá! Vim pelo site e gostaria de um orçamento."
                  className="gads-input-field"
                  style={{ padding: "9px 12px" }}
                />
              </div>

              {/* INTEGRADOR UAZAPI NO CADASTRO */}
              <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#34d399" }}>
                    Integração Uazapi do Cliente (Zero Código)
                  </span>
                  <button
                    type="button"
                    onClick={handleTestTenantFormUazapi}
                    disabled={isTestingTenantFormUazapi}
                    style={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      color: "#38bdf8",
                      borderRadius: "6px",
                      padding: "5px 10px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {isTestingTenantFormUazapi ? "Testando..." : "Testar Conexão Uazapi"}
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: tenantFormRoutingMode === "single" ? "1fr 1fr" : "1fr", gap: "8px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginBottom: "3px" }}>
                      URL Base da Uazapi
                    </label>
                    <input
                      type="text"
                      placeholder="https://suaempresa.uazapi.com"
                      value={tenantFormUazapiBase}
                      onChange={(e) => setTenantFormUazapiBase(e.target.value)}
                      className="gads-input-field"
                      style={{ padding: "8px 10px", fontSize: "12px" }}
                    />
                  </div>
                  {tenantFormRoutingMode === "single" && (
                    <div>
                      <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginBottom: "3px" }}>
                        Token da Instância WhatsApp
                      </label>
                      <input
                        type="text"
                        placeholder="Cole o token da instância"
                        value={tenantFormUazapiToken}
                        onChange={(e) => setTenantFormUazapiToken(e.target.value)}
                        className="gads-input-field"
                        style={{ padding: "8px 10px", fontSize: "12px" }}
                      />
                    </div>
                  )}
                </div>

                {tenantFormTestResult && (
                  <div
                    style={{
                      fontSize: "11px",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: "#0f172a",
                      border: `1px solid ${tenantFormTestResult.anyConnected ? "rgba(16,185,129,0.4)" : "rgba(245,158,11,0.4)"}`,
                      color: tenantFormTestResult.anyConnected ? "#6ee7b7" : "#fde68a",
                    }}
                  >
                    {tenantFormTestResult.anyConnected ? (
                      <div>
                        <strong>Uazapi Conectada!</strong>{" "}
                        {tenantFormTestResult.instances?.[0]?.phone
                          ? `Número: ${tenantFormTestResult.instances[0].phone} · `
                          : ""}
                        {tenantFormTestResult.instances?.[0]?.latencyMs}ms ·{" "}
                        {tenantFormTestResult.availableLabels?.length || 0} etiqueta(s) encontrada(s).
                      </div>
                    ) : (
                      <div>
                        {tenantFormTestResult.instances?.[0]?.error ||
                          tenantFormTestResult.error ||
                          "Instância desconectada ou token não validado."}
                      </div>
                    )}
                    {tenantFormTestResult.webhookUrl && (
                      <div style={{ color: "#94a3b8", marginTop: "4px", wordBreak: "break-all" }}>
                        Webhook: <code style={{ color: "#38bdf8" }}>{tenantFormTestResult.webhookUrl}</code>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {tenantFormFeedback && (
                <div
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "9px 12px",
                    borderRadius: "8px",
                    background: tenantFormFeedback.ok ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                    color: tenantFormFeedback.ok ? "#6ee7b7" : "#fca5a5",
                    border: `1px solid ${tenantFormFeedback.ok ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)"}`,
                  }}
                >
                  {tenantFormFeedback.msg}
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingTenant}
                style={{
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "11px 18px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                <Save size={15} />
                {isSavingTenant
                  ? "Salvando..."
                  : editingTenantSlug
                    ? "Salvar Alterações do Cliente"
                    : "Criar Cliente & Gerar Link /r/<slug>"}
              </button>
            </form>

            {/* GERENCIADOR DE ACESSOS DO PORTAL DO CLIENTE */}
            <div className="gads-panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#fff", margin: 0 }}>
                  Acessos do Portal do Cliente (/google-ads/acesso)
                </h3>
                <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>
                  Crie o login do seu cliente para acompanhar apenas{" "}
                  <strong style={{ color: "#cbd5e1" }}>Visão Geral Comercial, Leads e Funil Kanban</strong>{" "}
                  — sem palavras-chave, custos, ROAS, prejuízo ou edição de regras.
                </p>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", marginBottom: "4px" }}>
                  Cliente Selecionado para Acesso
                </label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={accessTargetSlug}
                    onChange={(e) => setAccessTargetSlug(e.target.value)}
                    className="gads-select-field"
                    style={{ flex: 1, padding: "9px 12px" }}
                  >
                    {tenantsList.map((t) => (
                      <option key={`acc_${t.slug}`} value={t.slug}>
                        {t.name} (/r/{t.slug})
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const target = tenantsList.find((t) => t.slug === accessTargetSlug);
                    if (!target) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => handleToggleClientPortal(target.slug, !target.clientAccess?.enabled)}
                        style={{
                          background: target.clientAccess?.enabled ? "rgba(16,185,129,0.16)" : "rgba(239,68,68,0.14)",
                          border: `1px solid ${target.clientAccess?.enabled ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.35)"}`,
                          color: target.clientAccess?.enabled ? "#6ee7b7" : "#fca5a5",
                          borderRadius: "8px",
                          padding: "8px 12px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {target.clientAccess?.enabled ? "Portal Ativo" : "Portal Desativado"}
                      </button>
                    );
                  })()}
                </div>
              </div>

              <form onSubmit={handleSaveClientUserSubmit} style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#cbd5e1" }}>
                  Criar / Atualizar Login do Cliente
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
                  <input
                    type="text"
                    required
                    placeholder="Login ou e-mail"
                    value={clientUserUsername}
                    onChange={(e) => setClientUserUsername(e.target.value)}
                    className="gads-input-field"
                    style={{ padding: "8px 10px", fontSize: "12px" }}
                  />
                  <input
                    type="text"
                    placeholder="Nome exibido"
                    value={clientUserDisplayName}
                    onChange={(e) => setClientUserDisplayName(e.target.value)}
                    className="gads-input-field"
                    style={{ padding: "8px 10px", fontSize: "12px" }}
                  />
                  <input
                    type="password"
                    required
                    placeholder="Senha (mín. 4 dígitos)"
                    value={clientUserPassword}
                    onChange={(e) => setClientUserPassword(e.target.value)}
                    className="gads-input-field"
                    style={{ padding: "8px 10px", fontSize: "12px" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingClientUser}
                  style={{
                    background: "#7c3aed",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "9px 14px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <KeyRound size={14} /> {isSavingClientUser ? "Salvando..." : "Salvar Acesso do Cliente"}
                </button>
                {clientUserFeedback && (
                  <div style={{ fontSize: "12px", color: clientUserFeedback.ok ? "#6ee7b7" : "#fca5a5", fontWeight: 600 }}>
                    {clientUserFeedback.msg}
                  </div>
                )}
              </form>

              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#94a3b8", marginBottom: "8px" }}>
                  Usuários Cadastrados Neste Cliente:
                </div>
                {(() => {
                  const target = tenantsList.find((t) => t.slug === accessTargetSlug);
                  const users = target?.clientAccess?.users || [];
                  if (users.length === 0) {
                    return (
                      <div style={{ background: "#090f20", border: "1px solid #1e293b", borderRadius: "10px", padding: "16px", fontSize: "12px", color: "#64748b", textAlign: "center" }}>
                        Nenhum usuário criado para {target?.name || accessTargetSlug} ainda.
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {users.map((u) => (
                        <div
                          key={u.id}
                          style={{
                            background: "#090f20",
                            border: "1px solid #1e293b",
                            borderRadius: "8px",
                            padding: "10px 12px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <div>
                            <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>{u.displayName}</div>
                            <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                              Login: <strong>{u.username}</strong>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteClientUser(accessTargetSlug, u.id)}
                            style={{ background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", borderRadius: "6px", padding: "5px 9px", fontSize: "11px", cursor: "pointer" }}
                          >
                            Excluir
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
