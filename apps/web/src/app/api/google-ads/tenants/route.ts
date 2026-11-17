import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  DEFAULT_TENANT_RULES,
  getTenant,
  getTenantFilePath,
  hashClientPassword,
  hasValidBrazilianDdi,
  listTenants,
  normalizeBrazilianPhone,
  normalizeUazapiBaseUrl,
  sanitizeTenantSlug,
  saveTenantsRegistry,
  upsertTenant,
  writeJsonAtomic,
  type GoogleTenantConfig,
  type TenantAttendant,
  type TenantClientUser,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M3: API DE GERENCIAMENTO DE CLIENTES & ACESSOS (EXCLUSIVA DO GESTOR)
 * Caminho no GitHub: apps/web/src/app/api/google-ads/tenants/route.ts
 *
 * - Lista, cria, edita e desativa clientes Google Ads (sem "cnac" nas pastas de novos clientes)
 * - Configura atendimento único ("single", padrão) ou roleta ("roulette") + Uazapi por cliente
 * - Cria e gerencia usuários do Portal do Cliente (/google-ads/acesso - Passo M4) com senha scrypt
 * - Garante usernames únicos para login direto do cliente sem precisar digitar slug
 */

function maskSecret(token?: string): string {
  const clean = String(token || "").trim();
  if (!clean) return "";
  if (clean.length <= 6) return "••••";
  return `••••${clean.slice(-4)}`;
}

function serializeTenantForManager(t: GoogleTenantConfig) {
  const isSingle = t.routingMode !== "roulette";
  const singleTok = t.uazapi?.singleToken || t.attendants?.[0]?.uazapiToken || "";
  const josiTok = t.uazapi?.josiToken || t.attendants?.[0]?.uazapiToken || "";
  const sergioTok = t.uazapi?.sergioToken || t.attendants?.[1]?.uazapiToken || "";
  const hasAnyToken = isSingle
    ? Boolean(singleTok)
    : Boolean(josiTok || sergioTok || t.attendants?.some((a) => Boolean(a.uazapiToken)));

  return {
    slug: t.slug,
    name: t.name,
    active: t.active !== false,
    googleCustomerId: t.googleCustomerId,
    routingMode: t.routingMode,
    initialMessage: t.initialMessage,
    attendants: (t.attendants || []).map((a) => ({
      id: a.id,
      name: a.name,
      phone: a.phone,
      active: a.active !== false,
      hasToken: Boolean(a.uazapiToken),
      tokenMasked: maskSecret(a.uazapiToken),
      validDdi55: hasValidBrazilianDdi(a.phone),
    })),
    uazapi: {
      baseUrl: t.uazapi?.baseUrl || "",
      configured: Boolean(t.uazapi?.baseUrl && hasAnyToken),
      hasSingleToken: Boolean(singleTok),
      hasJosiToken: Boolean(josiTok),
      hasSergioToken: Boolean(sergioTok),
      singleTokenMasked: maskSecret(singleTok),
      josiTokenMasked: maskSecret(josiTok),
      sergioTokenMasked: maskSecret(sergioTok),
      updatedAt: t.uazapi?.updatedAt || t.updatedAt,
    },
    clientAccess: {
      enabled: Boolean(t.clientAccess?.enabled),
      users: (t.clientAccess?.users || []).map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        active: u.active !== false,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null,
      })),
    },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function resolveUpdatedToken(incoming: unknown, existing?: string, clearFlag?: boolean): string | undefined {
  if (clearFlag === true) return undefined;
  const str = String(incoming || "").trim();
  if (!str) return existing || undefined;
  if (str.includes("••••")) return existing || undefined;
  return str;
}

export async function GET() {
  try {
    const tenants = listTenants();
    return NextResponse.json({
      success: true,
      tenants: tenants.map(serializeTenantForManager),
      defaultSlug: "cnac",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao listar clientes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "").trim();

    if (action === "create_tenant" || action === "update_tenant") {
      const rawName = String(body.name || "").trim();
      const rawSlug = String(body.slug || rawName).trim();
      const safeSlug = sanitizeTenantSlug(rawSlug);

      if (!rawName) {
        return NextResponse.json({ error: "Informe o nome do cliente." }, { status: 400 });
      }
      if (!safeSlug) {
        return NextResponse.json({ error: "Slug do cliente inválido." }, { status: 400 });
      }

      const existing = getTenant(safeSlug);
      if (action === "create_tenant" && existing) {
        return NextResponse.json(
          { error: `Já existe um cliente cadastrado com o identificador "${safeSlug}".` },
          { status: 409 }
        );
      }
      if (action === "update_tenant" && !existing) {
        return NextResponse.json(
          { error: `Cliente "${safeSlug}" não encontrado para atualização.` },
          { status: 404 }
        );
      }

      const routingMode = body.routingMode === "roulette" ? "roulette" : "single";
      const cleanCustomerId = String(body.googleCustomerId || existing?.googleCustomerId || "").replace(/\D/g, "");
      const initialMessage =
        String(body.initialMessage || existing?.initialMessage || "").trim() ||
        `Olá! Vim pelo site da ${rawName} e gostaria de um orçamento.`;

      const baseUrl = normalizeUazapiBaseUrl(
        String(body.uazapiBaseUrl ?? body.uazapi?.baseUrl ?? existing?.uazapi?.baseUrl ?? "")
      );

      let attendants: TenantAttendant[] = [];
      let nextSingleToken: string | undefined;
      let nextJosiToken: string | undefined;
      let nextSergioToken: string | undefined;

      if (routingMode === "single") {
        const primaryInput = Array.isArray(body.attendants) && body.attendants[0] ? body.attendants[0] : null;
        const attName = String(body.attendantName || primaryInput?.name || existing?.attendants?.[0]?.name || rawName).trim();
        const attPhone = normalizeBrazilianPhone(
          String(body.attendantPhone || primaryInput?.phone || existing?.attendants?.[0]?.phone || "")
        );

        if (!attPhone) {
          return NextResponse.json(
            { error: "Informe o número do WhatsApp de atendimento do cliente." },
            { status: 400 }
          );
        }

        nextSingleToken = resolveUpdatedToken(
          body.singleToken ?? body.uazapi?.singleToken ?? primaryInput?.uazapiToken,
          existing?.uazapi?.singleToken || existing?.attendants?.[0]?.uazapiToken,
          body.clearSingleToken === true
        );

        attendants = [
          {
            id: existing?.attendants?.[0]?.id || `att_${Date.now()}`,
            name: attName,
            phone: attPhone,
            uazapiToken: nextSingleToken,
            active: true,
          },
        ];
      } else {
        const rawList = Array.isArray(body.attendants)
          ? body.attendants
          : existing?.attendants || [];

        attendants = rawList
          .map((item: any, idx: number): TenantAttendant | null => {
            const name = String(item?.name || "").trim();
            const phone = normalizeBrazilianPhone(String(item?.phone || ""));
            if (!name || !phone) return null;
            const prevAtt = existing?.attendants?.[idx];
            const token = resolveUpdatedToken(
              item?.uazapiToken ?? (idx === 0 ? body.josiToken : idx === 1 ? body.sergioToken : undefined),
              prevAtt?.uazapiToken
            );
            return {
              id: String(item?.id || prevAtt?.id || `att_${idx + 1}_${Date.now()}`),
              name,
              phone,
              uazapiToken: token,
              active: item?.active !== false,
            };
          })
          .filter(Boolean) as TenantAttendant[];

        if (attendants.length === 0) {
          return NextResponse.json(
            { error: "No modo Roleta, informe ao menos 1 atendente com nome e WhatsApp válidos." },
            { status: 400 }
          );
        }

        nextJosiToken = resolveUpdatedToken(
          body.josiToken ?? body.uazapi?.josiToken ?? attendants[0]?.uazapiToken,
          existing?.uazapi?.josiToken
        );
        nextSergioToken = resolveUpdatedToken(
          body.sergioToken ?? body.uazapi?.sergioToken ?? attendants[1]?.uazapiToken,
          existing?.uazapi?.sergioToken
        );
        if (nextJosiToken && attendants[0]) attendants[0].uazapiToken = nextJosiToken;
        if (nextSergioToken && attendants[1]) attendants[1].uazapiToken = nextSergioToken;
      }

      const phoneWarnings = attendants
        .filter((a) => !hasValidBrazilianDdi(a.phone))
        .map((a) => `${a.name} (${a.phone}): verifique se o número possui DDI 55 + DDD + número.`);

      const now = new Date().toISOString();
      const savedTenant = upsertTenant({
        slug: safeSlug,
        name: rawName,
        active: body.active !== undefined ? Boolean(body.active) : existing?.active !== false,
        googleCustomerId: cleanCustomerId,
        routingMode,
        initialMessage,
        attendants,
        uazapi: {
          baseUrl,
          singleToken: nextSingleToken,
          josiToken: nextJosiToken,
          sergioToken: nextSergioToken,
          updatedAt: now,
        },
        clientAccess: existing?.clientAccess || {
          enabled: false,
          users: [],
        },
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });

      // Espelha uazapi_config.json dentro da pasta isolada do cliente
      writeJsonAtomic(getTenantFilePath(savedTenant.slug, "uazapi_config"), {
        baseUrl,
        singleToken: nextSingleToken,
        josiToken: nextJosiToken,
        sergioToken: nextSergioToken,
        updatedAt: now,
      });

      // Garante rules.json inicializado ao criar cliente novo
      const rulesFile = getTenantFilePath(savedTenant.slug, "rules");
      if (!fs.existsSync(rulesFile)) {
        writeJsonAtomic(rulesFile, DEFAULT_TENANT_RULES);
      }

      return NextResponse.json({
        success: true,
        tenant: serializeTenantForManager(savedTenant),
        phoneWarnings,
        message:
          action === "create_tenant"
            ? `Cliente "${savedTenant.name}" criado com sucesso! Link: /r/${savedTenant.slug}`
            : `Configurações de "${savedTenant.name}" atualizadas!`,
      });
    }

    if (action === "toggle_client_access") {
      const safeSlug = sanitizeTenantSlug(String(body.tenantSlug || body.slug || ""));
      const tenant = getTenant(safeSlug);
      if (!tenant) {
        return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      }
      const updated = upsertTenant({
        ...tenant,
        clientAccess: {
          enabled: Boolean(body.enabled),
          users: tenant.clientAccess?.users || [],
        },
      });
      return NextResponse.json({
        success: true,
        tenant: serializeTenantForManager(updated),
      });
    }

    if (action === "save_client_user") {
      const safeSlug = sanitizeTenantSlug(String(body.tenantSlug || body.slug || ""));
      const tenant = getTenant(safeSlug);
      if (!tenant) {
        return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      }

      const username = String(body.username || "").trim().toLowerCase();
      const displayName = String(body.displayName || username).trim();
      const rawPassword = String(body.password || "");
      const editingUserId = String(body.userId || "").trim();

      if (!username || username.length < 3) {
        return NextResponse.json(
          { error: "Informe um usuário/e-mail com pelo menos 3 caracteres." },
          { status: 400 }
        );
      }

      // Garante username único entre todos os tenants para login direto sem precisar informar slug
      const allTenants = listTenants();
      for (const other of allTenants) {
        const collision = (other.clientAccess?.users || []).find(
          (u) =>
            u.username.toLowerCase() === username &&
            !(other.slug === tenant.slug && editingUserId && u.id === editingUserId)
        );
        if (collision) {
          return NextResponse.json(
            { error: `O usuário "${username}" já está em uso no cliente "${other.name}". Escolha outro login.` },
            { status: 409 }
          );
        }
      }

      const currentUsers = [...(tenant.clientAccess?.users || [])];
      const existingIdx = editingUserId
        ? currentUsers.findIndex((u) => u.id === editingUserId)
        : currentUsers.findIndex((u) => u.username.toLowerCase() === username);

      if (existingIdx === -1 && rawPassword.length < 4) {
        return NextResponse.json(
          { error: "Informe uma senha inicial de pelo menos 4 caracteres para o novo acesso." },
          { status: 400 }
        );
      }

      if (rawPassword && rawPassword.length < 4) {
        return NextResponse.json(
          { error: "A nova senha deve ter pelo menos 4 caracteres." },
          { status: 400 }
        );
      }

      const now = new Date().toISOString();
      if (existingIdx !== -1) {
        const prev = currentUsers[existingIdx];
        currentUsers[existingIdx] = {
          ...prev,
          username,
          displayName,
          active: body.active !== undefined ? Boolean(body.active) : prev.active,
          passwordHash: rawPassword ? hashClientPassword(rawPassword) : prev.passwordHash,
        };
      } else {
        const newUser: TenantClientUser = {
          id: `cu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          username,
          displayName,
          passwordHash: hashClientPassword(rawPassword),
          active: body.active !== false,
          createdAt: now,
        };
        currentUsers.push(newUser);
      }

      const updated = upsertTenant({
        ...tenant,
        clientAccess: {
          enabled: body.enablePortal !== undefined ? Boolean(body.enablePortal) : true,
          users: currentUsers,
        },
      });

      return NextResponse.json({
        success: true,
        tenant: serializeTenantForManager(updated),
        message: `Acesso de "${displayName}" salvo para ${tenant.name}!`,
      });
    }

    if (action === "delete_client_user") {
      const safeSlug = sanitizeTenantSlug(String(body.tenantSlug || body.slug || ""));
      const tenant = getTenant(safeSlug);
      if (!tenant) {
        return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      }
      const userId = String(body.userId || "").trim();
      const nextUsers = (tenant.clientAccess?.users || []).filter((u) => u.id !== userId);
      const updated = upsertTenant({
        ...tenant,
        clientAccess: {
          enabled: tenant.clientAccess?.enabled ?? false,
          users: nextUsers,
        },
      });
      return NextResponse.json({
        success: true,
        tenant: serializeTenantForManager(updated),
      });
    }

    return NextResponse.json({ error: "Ação não reconhecida." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao gerenciar cliente" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const safeSlug = sanitizeTenantSlug(String(searchParams.get("slug") || ""));
    if (!safeSlug) {
      return NextResponse.json({ error: "Slug inválido." }, { status: 400 });
    }
    if (safeSlug === "cnac") {
      return NextResponse.json(
        { error: "O cliente principal CNAC não pode ser excluído." },
        { status: 400 }
      );
    }

    const tenants = listTenants();
    const target = tenants.find((t) => t.slug === safeSlug);
    if (!target) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    const nextTenants = tenants.filter((t) => t.slug !== safeSlug);
    saveTenantsRegistry(nextTenants);

    return NextResponse.json({
      success: true,
      message: `Cliente "${target.name}" removido do painel.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao remover cliente" },
      { status: 500 }
    );
  }
}
