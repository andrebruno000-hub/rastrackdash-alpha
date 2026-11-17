import { NextRequest, NextResponse } from "next/server";
import {
  getTenant,
  listTenants,
  signClientSessionToken,
  upsertTenant,
  verifyClientPassword,
  verifyClientSessionToken,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M4: AUTENTICAÇÃO ISOLADA DO PORTAL DO CLIENTE (/google-ads/acesso)
 * Caminho no GitHub: apps/web/src/app/api/google-ads/client-auth/route.ts
 *
 * - 100% independente da Meta Ads / Prisma / JWT da agência
 * - Verifica login (username) + senha scrypt dentro do cadastro multi-cliente
 * - Emite cookie HttpOnly assinado com HMAC-SHA256 travado no tenantSlug do cliente
 */

const CLIENT_PORTAL_COOKIE = "alpha_google_client_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function buildPublicSession(tenantSlug: string, userId: string, username: string, displayName: string) {
  const tenant = getTenant(tenantSlug);
  if (!tenant || tenant.active === false || !tenant.clientAccess?.enabled) return null;
  const user = (tenant.clientAccess.users || []).find((u) => u.id === userId && u.active !== false);
  if (!user) return null;

  return {
    tenantSlug: tenant.slug,
    clientName: tenant.name,
    routingMode: tenant.routingMode,
    userId: user.id,
    username: user.username,
    displayName: user.displayName || displayName || user.username,
  };
}

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(CLIENT_PORTAL_COOKIE)?.value || "";
    if (!token) {
      return NextResponse.json({ authenticated: false });
    }
    const payload = verifyClientSessionToken(token);
    if (!payload) {
      return NextResponse.json({ authenticated: false });
    }

    const session = buildPublicSession(
      payload.tenantSlug,
      payload.userId,
      payload.username,
      payload.displayName
    );
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      session,
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawUsername = String(body.username || "").trim().toLowerCase();
    const rawPassword = String(body.password || "");

    if (!rawUsername || !rawPassword) {
      return NextResponse.json(
        { error: "Informe seu login e senha de acesso." },
        { status: 400 }
      );
    }

    const tenants = listTenants();
    let matchedTenant = null as ReturnType<typeof getTenant>;
    let matchedUser: any = null;

    for (const t of tenants) {
      if (t.active === false) continue;
      const users = t.clientAccess?.users || [];
      const found = users.find((u) => u.username.toLowerCase() === rawUsername);
      if (found) {
        matchedTenant = t;
        matchedUser = found;
        break;
      }
    }

    if (!matchedTenant || !matchedUser) {
      return NextResponse.json(
        { error: "Login ou senha inválidos." },
        { status: 401 }
      );
    }

    if (!matchedTenant.clientAccess?.enabled) {
      return NextResponse.json(
        { error: "O acesso ao portal está temporariamente desativado para esta empresa." },
        { status: 403 }
      );
    }

    if (matchedUser.active === false) {
      return NextResponse.json(
        { error: "Este usuário está desativado. Fale com seu gestor." },
        { status: 403 }
      );
    }

    const passwordOk = verifyClientPassword(rawPassword, matchedUser.passwordHash);
    if (!passwordOk) {
      return NextResponse.json(
        { error: "Login ou senha inválidos." },
        { status: 401 }
      );
    }

    const now = new Date().toISOString();
    const updatedUsers = (matchedTenant.clientAccess?.users || []).map((u) =>
      u.id === matchedUser.id ? { ...u, lastLoginAt: now } : u
    );
    upsertTenant({
      ...matchedTenant,
      clientAccess: {
        enabled: true,
        users: updatedUsers,
      },
    });

    const token = signClientSessionToken({
      tenantSlug: matchedTenant.slug,
      userId: matchedUser.id,
      username: matchedUser.username,
      displayName: matchedUser.displayName || matchedUser.username,
      exp: Date.now() + SESSION_TTL_MS,
    });

    const res = NextResponse.json({
      success: true,
      authenticated: true,
      session: {
        tenantSlug: matchedTenant.slug,
        clientName: matchedTenant.name,
        routingMode: matchedTenant.routingMode,
        userId: matchedUser.id,
        username: matchedUser.username,
        displayName: matchedUser.displayName || matchedUser.username,
      },
    });

    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      request.url.startsWith("https://");

    res.cookies.set(CLIENT_PORTAL_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

    return res;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao autenticar acesso do cliente." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ success: true, authenticated: false });
  res.cookies.set(CLIENT_PORTAL_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
