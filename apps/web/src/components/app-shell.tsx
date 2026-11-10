"use client";

import { clientNavigation, clientNavVisibleForPermissions } from "@wpptrack/shared";
import type {
  CurrentWorkspaceDto,
  WhatsappDataSourceDto,
  WorkspaceListEntryDto,
} from "@wpptrack/shared";
import {
  BarChart3,
  Building2,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Route,
  Send,
  Settings2,
  ShieldCheck,
  SquareKanban,
  Target,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { LogoutButton } from "./logout-button";
import { BrandFooter } from "./brand-footer";
import { DataAutoRefresh } from "./data-auto-refresh";
import { PresentationMask } from "./presentation-mask";
import {
  PresentationModeToggle,
  usePresentationMode,
} from "./presentation-mode-toggle";
import { exitPlatformSupportAccess } from "../app/actions/platform-support";
import { switchActiveWorkspace } from "../app/actions/workspaces";
import { defaultBrandConfig, type BrandConfig } from "../lib/brand";

const sidebarStorageKey = "wpptrack-sidebar-collapsed";

type ClientNavigationId = (typeof clientNavigation)[number]["id"];

const navigationIconById: Record<ClientNavigationId, LucideIcon> = {
  overview: LayoutDashboard,
  leads: UsersRound,
  crm: SquareKanban,
  reports: BarChart3,
  events: Send,
  integrations: Plug,
  conversions: Route,
  settings: Settings2,
};

const navigationGroupDefinitions = [
  {
    label: "Operação",
    ids: ["overview", "leads", "crm", "reports", "events"],
  },
  {
    label: "Gestão",
    ids: ["integrations", "conversions", "settings"],
  },
] as const;

function visibleNavigationGroups(
  permissions: CurrentWorkspaceDto["permissions"] | null | undefined,
) {
  return navigationGroupDefinitions
    .map((group) => ({
      label: group.label,
      items: clientNavigation.filter(
        (item) =>
          (group.ids as readonly ClientNavigationId[]).includes(item.id) &&
          clientNavVisibleForPermissions(item.id, permissions),
      ),
    }))
    .filter((group) => group.items.length > 0);
}

function workspaceAccessLabel(workspace: CurrentWorkspaceDto): string {
  if (workspace.accessMode === "platform_support") {
    return "acesso de suporte";
  }
  return workspaceRoleLabel(workspace.role).toLowerCase();
}

function workspaceRoleLabel(role: WorkspaceListEntryDto["role"]): string {
  if (role === "owner") {
    return "responsável da conta";
  }
  return role === "admin" ? "administrador" : "analista";
}

export function AppShell({
  children,
  dataSource,
  workspace,
  workspaces = [],
  brand = defaultBrandConfig,
}: {
  children: ReactNode;
  dataSource?: WhatsappDataSourceDto | null;
  workspace?: CurrentWorkspaceDto | null;
  workspaces?: WorkspaceListEntryDto[];
  brand?: BrandConfig;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState(false);
  const [isWorkspaceSwitchPending, startWorkspaceSwitch] = useTransition();
  const presentationMode = usePresentationMode();
  const workspaceSelectorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedPreference = window.localStorage.getItem(sidebarStorageKey);
    if (savedPreference === "true") {
      setSidebarCollapsed(true);
    }
  }, []);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (
        workspaceSelectorRef.current &&
        !workspaceSelectorRef.current.contains(event.target as Node)
      ) {
        setWorkspaceMenuOpen(false);
      }
    }

    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  function toggleSidebarCollapse() {
    setSidebarCollapsed((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(sidebarStorageKey, String(next));
      }
      return next;
    });
  }

  function openWorkspaceMenu() {
    setWorkspaceMenuOpen((current) => !current);
    setWorkspaceSwitchError(false);
  }

  function selectWorkspace(workspaceId: string) {
    if (workspaceId === workspace?.id) {
      setWorkspaceMenuOpen(false);
      return;
    }

    setWorkspaceSwitchError(false);
    startWorkspaceSwitch(async () => {
      const result = await switchActiveWorkspace(workspaceId);
      if (!result.ok) {
        setWorkspaceSwitchError(true);
        return;
      }

      setWorkspaceMenuOpen(false);
      router.refresh();
    });
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  const navigationGroups = visibleNavigationGroups(workspace?.permissions);
  const canSelectWorkspace = workspaces.length > 1;

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileMenuOpen ? " mobile-menu-open" : ""}`}
    >
      <header className="mobile-header">
        <div className="mobile-header-brand">
          <Link
            className="brand-link"
            href="/overview"
            title={brand.name}
            onClick={closeMobileMenu}
          >
            {brand.logoSvg ? (
              <span
                className="brand-logo"
                dangerouslySetInnerHTML={{ __html: brand.logoSvg }}
              />
            ) : null}
            <span className="brand-copy">
              <strong>{brand.name}</strong>
            </span>
          </Link>
        </div>
        <button
          className="mobile-menu-toggle"
          type="button"
          aria-label={mobileMenuOpen ? "Fechar navegação" : "Abrir navegação"}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? (
            <X aria-hidden="true" size={20} strokeWidth={2.2} />
          ) : (
            <Menu aria-hidden="true" size={20} strokeWidth={2.2} />
          )}
        </button>
      </header>

      <aside className="sidebar">
        <div className="sidebar-header">
          <Link
            className="brand-link"
            href="/overview"
            title={brand.name}
            onClick={closeMobileMenu}
          >
            {brand.logoSvg ? (
              <span
                className="brand-logo"
                dangerouslySetInnerHTML={{ __html: brand.logoSvg }}
              />
            ) : null}
            <span className="brand-copy">
              <strong>{brand.name}</strong>
              <small>Operação WhatsApp</small>
            </span>
          </Link>
          <button
            className="sidebar-collapse-toggle"
            type="button"
            aria-label={
              sidebarCollapsed
                ? "Expandir barra lateral"
                : "Recolher barra lateral"
            }
            title={
              sidebarCollapsed
                ? "Expandir barra lateral"
                : "Recolher barra lateral"
            }
            onClick={toggleSidebarCollapse}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={2.2} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={18} strokeWidth={2.2} />
            )}
          </button>
          <button
            className="sidebar-mobile-close"
            type="button"
            aria-label="Fechar menu"
            onClick={closeMobileMenu}
          >
            <X aria-hidden="true" size={20} strokeWidth={2.2} />
          </button>
        </div>

        <section
          ref={workspaceSelectorRef}
          className={`workspace-strip${canSelectWorkspace ? " workspace-selector" : ""}`}
          aria-label="Workspace atual"
        >
          {canSelectWorkspace ? (
            <>
              <button
                className="workspace-selector-trigger"
                type="button"
                aria-label={
                  presentationMode
                    ? "Selecionar workspace demonstrativo"
                    : `Selecionar empresa. Atual: ${workspace?.name ?? "nenhuma"}`
                }
                aria-controls="workspace-selector-menu"
                aria-expanded={workspaceMenuOpen}
                onClick={openWorkspaceMenu}
                title="Selecionar empresa"
              >
                <span className="workspace-selector-icon" aria-hidden="true">
                  <Building2 size={18} strokeWidth={2.1} />
                </span>
                <span className="workspace-selector-copy">
                  <span>Workspace</span>
                  <strong>
                    <PresentationMask placeholder="Workspace demonstrativo">
                      {workspace?.name ?? "Selecionar empresa"}
                    </PresentationMask>
                  </strong>
                  <small>
                    <PresentationMask placeholder="acesso demonstrativo">
                      {workspace
                        ? `${workspace.slug} - ${workspaceAccessLabel(workspace)}`
                        : `${workspaces.length} ${workspaces.length === 1 ? "empresa disponível" : "empresas disponíveis"}`}
                    </PresentationMask>
                  </small>
                </span>
                <ChevronsUpDown
                  className="workspace-selector-chevron"
                  aria-hidden="true"
                  size={17}
                  strokeWidth={2.1}
                />
              </button>

              <div
                id="workspace-selector-menu"
                className="workspace-selector-menu"
                role="menu"
                aria-label="Empresas autorizadas"
                hidden={!workspaceMenuOpen}
              >
                {workspaces.map((availableWorkspace, index) => {
                  const selected = availableWorkspace.id === workspace?.id;
                  return (
                    <button
                      key={availableWorkspace.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={selected || isWorkspaceSwitchPending}
                      onClick={() => selectWorkspace(availableWorkspace.id)}
                    >
                      <span>
                        <strong>
                          <PresentationMask
                            placeholder={`Workspace ${index + 1}`}
                          >
                            {availableWorkspace.name}
                          </PresentationMask>
                        </strong>
                        <small>
                          {workspaceRoleLabel(availableWorkspace.role)}
                        </small>
                      </span>
                      {selected ? (
                        <Check aria-hidden="true" size={17} strokeWidth={2.2} />
                      ) : null}
                    </button>
                  );
                })}
                {workspaceSwitchError ? (
                  <p className="workspace-selector-error" role="alert">
                    Não foi possível abrir esta empresa.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <span>Workspace</span>
              <strong>
                <PresentationMask placeholder="Workspace demonstrativo">
                  {workspace?.name ?? "Workspace indisponível"}
                </PresentationMask>
              </strong>
              <small>
                <PresentationMask placeholder="acesso demonstrativo">
                  {workspace
                    ? `${workspace.slug} - ${workspaceAccessLabel(workspace)}`
                    : "Sessão autenticada"}
                </PresentationMask>
              </small>
            </>
          )}
        </section>

        <div className="sidebar-navigation">
          {navigationGroups.map((group) => (
            <nav
              className="sidebar-nav"
              aria-label={group.label}
              key={group.label}
            >
              <p className="nav-label">{group.label}</p>
              {group.items.map((item) => {
                const href = `/${item.id}`;
                const active =
                  pathname === href || pathname.startsWith(`${href}/`);
                const Icon = navigationIconById[item.id];
                return (
                  <Link
                    className={active ? "active" : undefined}
                    key={item.id}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    title={item.label}
                    onClick={closeMobileMenu}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      <Icon size={17} strokeWidth={2.1} />
                    </span>
                    <span className="nav-text">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          ))}

          {/* Módulo Oficial Google Ads - Anúncios Alpha */}
          <nav className="sidebar-nav" aria-label="Google Ads">
            <p className="nav-label">Google Ads</p>
            <Link
              className={pathname === "/google-ads" || pathname.startsWith("/google-ads/") ? "active" : undefined}
              href="/google-ads"
              title="Google Ads & Roleta"
              onClick={closeMobileMenu}
            >
              <span className="nav-icon" aria-hidden="true">
                <Target size={17} strokeWidth={2.1} />
              </span>
              <span className="nav-text">Google Ads</span>
            </Link>
          </nav>
        </div>

        {workspace?.platformRole ? (
          <nav
            className="sidebar-nav platform-sidebar-nav"
            aria-label="Administração da plataforma"
          >
            <p className="nav-label">Plataforma</p>
            <Link
              className={
                pathname.startsWith("/backoffice") ? "active" : undefined
              }
              href="/backoffice/clients"
              aria-current={
                pathname.startsWith("/backoffice") ? "page" : undefined
              }
              title="Backoffice"
              onClick={closeMobileMenu}
            >
              <span className="nav-icon" aria-hidden="true">
                <ShieldCheck size={17} strokeWidth={2.1} />
              </span>
              <span className="nav-text">Backoffice</span>
            </Link>
          </nav>
        ) : null}

        <section className="health-panel" aria-label="Conta">
          <p className="nav-label">Conta</p>
          {workspace ? (
            <span
              className={`status-chip${workspace.operationalStatus === "blocked" ? " warn" : ""}`}
            >
              {workspace.operationalStatus === "blocked"
                ? "bloqueado"
                : "ativo"}
            </span>
          ) : null}
          <PresentationModeToggle />
          <LogoutButton />
        </section>

        <BrandFooter brand={brand} className="sidebar-footer" />
      </aside>

      <button
        className="mobile-sidebar-backdrop"
        type="button"
        aria-label="Fechar menu"
        tabIndex={mobileMenuOpen ? 0 : -1}
        onClick={closeMobileMenu}
      />

      <main className="content">
        {workspace?.accessMode === "platform_support" ? (
          <div className="support-context-bar" role="status">
            <div>
              <span>Acesso de suporte</span>
              <strong>
                <PresentationMask placeholder="Workspace demonstrativo">
                  {workspace.name}
                </PresentationMask>
              </strong>
            </div>
            <form action={exitPlatformSupportAccess}>
              <button className="button ghost" type="submit">
                Encerrar acesso
              </button>
            </form>
          </div>
        ) : null}

        {workspace && !pathname.startsWith("/crm") ? (
          <DataAutoRefresh source={dataSource ?? null} />
        ) : null}

        {children}

        <BrandFooter brand={brand} className="content-footer" />
      </main>
    </div>
  );
}
