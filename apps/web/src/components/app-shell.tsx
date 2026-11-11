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
  Send,
  Settings2,
  ShieldCheck,
  SquareKanban,
  Target,
  UsersRound,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { BrandMark, BrandName } from "./brand";
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
  conversions: Zap,
  settings: Settings2,
};

const navigationGroupDefinitions = [
  {
    label: "OperaÃ§Ã£o",
    ids: ["overview", "leads", "crm", "reports", "events"],
  },
  {
    label: "GestÃ£o",
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
    return "responsÃ¡vel da conta";
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
  const router = useRouter();
  const pathname = usePathname();
  const presentationMode = usePresentationMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [isWorkspaceSwitchPending, startWorkspaceTransition] = useTransition();
  const [isExitSupportPending, startExitSupportTransition] = useTransition();
  const [workspaceSwitchError, setWorkspaceSwitchError] = useState(false);
  const workspaceSelectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const persisted = window.localStorage.getItem(sidebarStorageKey);
      if (persisted !== null) {
        setSidebarCollapsed(persisted === "true");
      }
    } catch {
      // LocalStorage access can fail in restricted environments; default to expanded.
    }
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(sidebarStorageKey, String(next));
      } catch {
        // Ignored.
      }
      return next;
    });
  };

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 840;

  useEffect(() => {
    if (!isMobile || !mobileMenuOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobile, mobileMenuOpen]);

  useEffect(() => {
    if (!workspaceMenuOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!workspaceSelectorRef.current?.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkspaceMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [workspaceMenuOpen]);

  const closeMobileMenu = () => setMobileMenuOpen(false);
  const navigationGroups = visibleNavigationGroups(workspace?.permissions);
  const canSelectWorkspace =
    workspace?.accessMode !== "platform_support" &&
    workspaces.length > 0 &&
    (workspaces.length > 1 || !workspace);

  const openWorkspaceMenu = () => {
    setWorkspaceSwitchError(false);

    if (sidebarCollapsed && !isMobile) {
      setSidebarCollapsed(false);
    }

    setWorkspaceMenuOpen((current) => !current);
  };

  const selectWorkspace = (workspaceId: string) => {
    if (workspaceId === workspace?.id || isWorkspaceSwitchPending) {
      setWorkspaceMenuOpen(false);
      return;
    }

    setWorkspaceSwitchError(false);

    startWorkspaceTransition(async () => {
      const result = await switchActiveWorkspace(workspaceId);

      if (!result.ok) {
        setWorkspaceSwitchError(true);
        return;
      }

      setWorkspaceMenuOpen(false);
      router.refresh();
    });
  };

  const handleExitPlatformSupport = () => {
    startExitSupportTransition(async () => {
      const result = await exitPlatformSupportAccess();

      if (result.ok) {
        router.push(result.redirectUrl);
        router.refresh();
      }
    });
  };

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileMenuOpen ? " mobile-menu-open" : ""}`}
      data-sidebar-state={sidebarCollapsed ? "collapsed" : "expanded"}
    >
      <header className="mobile-shell-header">
        <Link
          className="brand"
          href="/overview"
          aria-label={`${brand.name} - ir para a VisÃ£o geral`}
          onClick={closeMobileMenu}
        >
          <BrandMark brand={brand} gradientId="rastrackdash-r-mobile" />
          <span className="brand-copy">
            <BrandName brand={brand} />
          </span>
        </Link>
        <button
          className="mobile-menu-toggle"
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? "Fechar menu de navegaÃ§Ã£o" : "Abrir menu de navegaÃ§Ã£o"}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? (
            <X size={20} strokeWidth={2.2} />
          ) : (
            <Menu size={20} strokeWidth={2.2} />
          )}
        </button>
      </header>

      <aside
        className={`app-sidebar${sidebarCollapsed ? " collapsed" : ""}${mobileMenuOpen ? " open" : ""}`}
        aria-hidden={isMobile && !mobileMenuOpen}
        inert={isMobile && !mobileMenuOpen}
      >
        <div className="sidebar-topline">
          <Link
            className="brand"
            href="/overview"
            aria-label={`${brand.name} - ir para a VisÃ£o geral`}
            onClick={closeMobileMenu}
          >
            <BrandMark brand={brand} gradientId="rastrackdash-r-sidebar" />
            <span className="brand-copy">
              <BrandName brand={brand} />
            </span>
          </Link>
          <button
            className="sidebar-toggle desktop-sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Recolher barra lateral"}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={18} strokeWidth={2.1} />
            ) : (
              <PanelLeftClose size={18} strokeWidth={2.1} />
            )}
          </button>
        </div>

        <section
          className={`sidebar-workspace-card${canSelectWorkspace ? " selectable" : ""}${workspaceMenuOpen ? " menu-open" : ""}`}
          ref={workspaceSelectorRef}
        >
          {canSelectWorkspace ? (
            <>
              <button
                className="workspace-selector-trigger"
                type="button"
                aria-expanded={workspaceMenuOpen}
                aria-haspopup="listbox"
                aria-label="Selecionar workspace"
                disabled={isWorkspaceSwitchPending}
                onClick={openWorkspaceMenu}
              >
                <span>Workspace</span>
                <strong>
                  <PresentationMask placeholder="Workspace demonstrativo">
                    {workspace?.name ?? "Workspace indisponÃ­vel"}
                  </PresentationMask>
                </strong>
                <small>
                  <PresentationMask placeholder="acesso demonstrativo">
                    {workspace
                      ? `${workspace.slug} - ${workspaceAccessLabel(workspace)}`
                      : "SessÃ£o autenticada"}
                  </PresentationMask>
                </small>
                <ChevronsUpDown aria-hidden="true" size={16} strokeWidth={2.2} />
              </button>

              <div
                className="workspace-selector-menu"
                hidden={!workspaceMenuOpen}
                role="listbox"
                aria-label="Workspaces disponÃ­veis"
              >
                {workspaces.map((availableWorkspace) => {
                  const selected = availableWorkspace.id === workspace?.id;

                  return (
                    <button
                      className={`workspace-selector-option${selected ? " selected" : ""}`}
                      key={availableWorkspace.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={isWorkspaceSwitchPending}
                      onClick={() => selectWorkspace(availableWorkspace.id)}
                    >
                      <Building2 aria-hidden="true" size={17} strokeWidth={2.1} />
                      <span className="workspace-selector-option-copy">
                        <strong>
                          <PresentationMask placeholder="Workspace demonstrativo">
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
                    NÃ£o foi possÃ­vel abrir esta empresa.
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <span>Workspace</span>
              <strong>
                <PresentationMask placeholder="Workspace demonstrativo">
                  {workspace?.name ?? "Workspace indisponÃ­vel"}
                </PresentationMask>
              </strong>
              <small>
                <PresentationMask placeholder="acesso demonstrativo">
                  {workspace
                    ? `${workspace.slug} - ${workspaceAccessLabel(workspace)}`
                    : "SessÃ£o autenticada"}
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
              {group.label === "GestÃ£o" ? (
                <Link
                  className={
                    pathname === "/google-ads" || pathname.startsWith("/google-ads/")
                      ? "active"
                      : undefined
                  }
                  href="/google-ads"
                  aria-current={
                    pathname === "/google-ads" || pathname.startsWith("/google-ads/")
                      ? "page"
                      : undefined
                  }
                  title="Google Ads & Roleta"
                  onClick={closeMobileMenu}
                >
                  <span className="nav-icon" aria-hidden="true">
                    <Target size={17} strokeWidth={2.1} />
                  </span>
                  <span className="nav-text">Google Ads</span>
                </Link>
              ) : null}
            </nav>
          ))}
        </div>

        {workspace?.platformRole ? (
          <nav
            className="sidebar-nav platform-sidebar-nav"
            aria-label="AdministraÃ§Ã£o da plataforma"
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

        {/* The CRM board refreshes itself (counts + first pages only). */}
        {workspace && !pathname.startsWith("/crm") ? (
          <DataAutoRefresh source={dataSource ?? null} />
        ) : null}

        {children}

        <BrandFooter brand={brand} className="content-footer" />
      </main>
    </div>
  );
}
