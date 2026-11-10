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
          aria-label={`${brand.name} - ir para a Visão geral`}
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
          aria-label={mobileMenuOpen ? "Fechar menu de navegação" : "Abrir menu de navegação"}
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
            aria-label={`${brand.name} - ir para a Visão geral`}
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
                <div className="workspace-selector-trigger-copy">
                  <p className="sidebar-workspace-kicker">Workspace</p>
                  <strong className="sidebar-workspace-title">
                    <PresentationMask fallback="Workspace">
                      {workspace?.title ?? "Selecione o workspace"}
                    </PresentationMask>
                  </strong>
                  <small className="sidebar-workspace-role">
                    <PresentationMask fallback="Acesso ativo">
                      {workspace
                        ? `${workspace.slug} - ${workspaceAccessLabel(workspace)}`
                        : "Nenhum workspace ativo"}
                    </PresentationMask>
                  </small>
                </div>
                <ChevronsUpDown
                  className="workspace-selector-caret"
                  size={16}
                  strokeWidth={2.2}
                  aria-hidden="true"
                />
              </button>

              {workspaceMenuOpen ? (
                <div
                  className="workspace-dropdown-panel"
                  role="listbox"
                  aria-label="Workspaces disponíveis"
                >
                  <p className="workspace-dropdown-header">Workspaces</p>
                  <div className="workspace-dropdown-list">
                    {workspaces.map((entry) => {
                      const isSelected = entry.id === workspace?.id;

                      return (
                        <button
                          className={`workspace-dropdown-item${isSelected ? " selected" : ""}`}
                          key={entry.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={isWorkspaceSwitchPending}
                          onClick={() => selectWorkspace(entry.id)}
                        >
                          <Building2
                            className="workspace-item-icon"
                            size={16}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <div className="workspace-item-copy">
                            <strong className="workspace-item-title">
                              <PresentationMask fallback="Workspace">
                                {entry.title}
                              </PresentationMask>
                            </strong>
                            <small className="workspace-item-meta">
                              <PresentationMask fallback="slug - papel">
                                {`${entry.slug} - ${workspaceRoleLabel(entry.role).toLowerCase()}`}
                              </PresentationMask>
                            </small>
                          </div>
                          {isSelected ? (
                            <Check
                              className="workspace-item-check"
                              size={15}
                              strokeWidth={2.4}
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {workspaceSwitchError ? (
                    <p className="workspace-switch-error" role="alert">
                      Não foi possível alternar de workspace. Tente novamente.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="sidebar-workspace-kicker">Workspace</p>
              <strong className="sidebar-workspace-title">
                <PresentationMask fallback="Workspace">
                  {workspace?.title ?? "Workspace ativo"}
                </PresentationMask>
              </strong>
              <small className="sidebar-workspace-role">
                <PresentationMask fallback="Acesso ativo">
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
              {group.label === "Gestão" ? (
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

        <section className="sidebar-account-controls" aria-label="Controles da conta">
          {workspace?.accessMode === "platform_support" ? (
            <span className="support-access-badge">
              <span className="support-access-dot" aria-hidden="true" />
              <button
                className="support-access-exit-link"
                type="button"
                onClick={handleExitPlatformSupport}
                disabled={isExitSupportPending}
              >
                {isExitSupportPending ? "Encerrando..." : "Encerrar acesso"}
              </button>
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
        onClick={closeMobileMenu}
      />

      <main className="shell-content">
        {workspace?.accessMode === "platform_support" ? (
          <aside
            className="support-access-banner"
            role="status"
            aria-live="polite"
          >
            <div className="support-access-banner-copy">
              <span className="support-access-dot" aria-hidden="true" />
              <strong>Acesso de suporte ativo:</strong> você está visualizando o
              workspace <code>{workspace.slug}</code> em modo suporte.
            </div>
            <button
              className="button button-ghost button-small support-access-exit-button"
              type="button"
              onClick={handleExitPlatformSupport}
              disabled={isExitSupportPending}
            >
              {isExitSupportPending ? "Encerrando acesso..." : "Encerrar acesso"}
            </button>
          </aside>
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
