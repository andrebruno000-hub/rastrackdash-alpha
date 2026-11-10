"use client";

import type { CSSProperties } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { normalizeSearchText } from "../lib/search-text";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  /** Shown but not selectable; `disabledReason` says why. */
  disabled?: boolean;
  disabledReason?: string;
};

type SearchableSelectProps = {
  name: string;
  value: string;
  options: SearchableSelectOption[];
  onValueChange: (value: string) => void | Promise<void>;
  ariaLabel: string;
  placeholder: string;
  emptyMessage?: string;
  disabled?: boolean;
  sensitive?: boolean;
  presentationPlaceholder?: string;
  /**
   * At most this many options are rendered at once (hundreds of Pages or
   * Pixels stay fast); the rest is reached by typing.
   */
  maxRenderedOptions?: number;
  id?: string;
};

/** Default cap of rendered options (search narrows the rest). */
export const SEARCHABLE_SELECT_RENDER_LIMIT = 100;

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 320;
const MENU_MIN_HEIGHT = 220;

export function filterSearchableOptions(
  options: SearchableSelectOption[],
  query: string,
  selectedLabel = "",
) {
  const normalizedQuery = normalizeSearchText(query);

  if (
    !normalizedQuery ||
    normalizedQuery === normalizeSearchText(selectedLabel)
  ) {
    return options;
  }

  return options.filter((option) =>
    normalizeSearchText(`${option.label} ${option.description ?? ""}`).includes(
      normalizedQuery,
    ),
  );
}

/** Next selectable index from `start` going by `step` (wraps around). */
export function nextEnabledIndex(
  options: SearchableSelectOption[],
  start: number,
  step: 1 | -1,
): number {
  const total = options.length;
  if (total === 0) return -1;
  for (let offset = 1; offset <= total; offset += 1) {
    const index = (((start + step * offset) % total) + total) % total;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

/**
 * Fixed position of the menu under (or, without room, above) the input,
 * limited to the viewport. Pure, so it is tested without a browser.
 */
export function searchableMenuPosition(
  rect: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
): {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
} {
  const below = viewport.height - rect.bottom - MENU_GAP - 8;
  const above = rect.top - MENU_GAP - 8;
  const width = Math.min(Math.max(rect.width, 220), viewport.width - 16);
  const left = Math.max(8, Math.min(rect.left, viewport.width - width - 8));
  if (below >= Math.min(MENU_MAX_HEIGHT, MENU_MIN_HEIGHT) || below >= above) {
    return {
      top: rect.bottom + MENU_GAP,
      left,
      width,
      maxHeight: Math.max(80, Math.min(MENU_MAX_HEIGHT, below)),
    };
  }
  return {
    bottom: viewport.height - rect.top + MENU_GAP,
    left,
    width,
    maxHeight: Math.max(80, Math.min(MENU_MAX_HEIGHT, above)),
  };
}

/**
 * A fixed menu inside an element with a transform, filter or backdrop-filter
 * (the glass modals) is positioned against that element, not the viewport.
 * Returns the shift that turns viewport coordinates into its coordinates
 * (zero when the element does not capture fixed descendants).
 */
export function fixedContainingBlockShift(
  container: Element | null,
  viewportHeight: number,
): { left: number; top: number; bottom: number } {
  const none = { left: 0, top: 0, bottom: 0 };
  if (!container || typeof window === "undefined") return none;
  const style = window.getComputedStyle(container);
  const webkitBackdrop = style.getPropertyValue("-webkit-backdrop-filter");
  const captures =
    (style.transform && style.transform !== "none") ||
    (style.filter && style.filter !== "none") ||
    (style.backdropFilter && style.backdropFilter !== "none") ||
    (webkitBackdrop && webkitBackdrop !== "none") ||
    (style.perspective && style.perspective !== "none") ||
    /(paint|layout|strict|content)/u.test(style.contain ?? "") ||
    /(transform|filter|backdrop-filter)/u.test(style.willChange ?? "");
  if (!captures) return none;
  const box = container.getBoundingClientRect();
  const html = container as HTMLElement;
  const left = box.left + (html.clientLeft ?? 0);
  const top = box.top + (html.clientTop ?? 0);
  const paddingBottom = top + (html.clientHeight ?? box.height);
  return { left, top, bottom: viewportHeight - paddingBottom };
}

export function SearchableSelect({
  name,
  value,
  options,
  onValueChange,
  ariaLabel,
  placeholder,
  emptyMessage = "Nenhum ativo encontrado",
  disabled = false,
  sensitive = false,
  presentationPlaceholder = "Dado oculto",
  maxRenderedOptions = SEARCHABLE_SELECT_RENDER_LIMIT,
  id,
}: SearchableSelectProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);
  const [query, setQuery] = useState(selectedOption?.label ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const filteredOptions = useMemo(
    () => filterSearchableOptions(options, query, selectedOption?.label),
    [options, query, selectedOption?.label],
  );
  const renderedOptions = useMemo(
    () => filteredOptions.slice(0, Math.max(1, maxRenderedOptions)),
    [filteredOptions, maxRenderedOptions],
  );
  const hiddenCount = filteredOptions.length - renderedOptions.length;
  const menuOpen = isOpen && !disabled;

  useEffect(() => {
    if (!isOpen) {
      setQuery(selectedOption?.label ?? "");
    }
  }, [isOpen, selectedOption?.label]);

  useEffect(() => {
    if (!isOpen || renderedOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((current) => {
      if (
        current >= 0 &&
        current < renderedOptions.length &&
        !renderedOptions[current]?.disabled
      ) {
        return current;
      }

      const selectedIndex = renderedOptions.findIndex(
        (option) => option.value === value && !option.disabled,
      );

      return selectedIndex >= 0
        ? selectedIndex
        : nextEnabledIndex(renderedOptions, -1, 1);
    });
  }, [renderedOptions, isOpen, value]);

  // The menu lives in a portal with a fixed position: no modal body or card
  // with overflow hidden can clip it.
  const updatePosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    // Same element the menu is portaled into (see the layout effect below).
    const container = input.closest<HTMLElement>(
      'dialog[open], [role="dialog"][aria-modal="true"]',
    );
    const shift = fixedContainingBlockShift(container, window.innerHeight);
    // A glass dialog that captures the menu also clips it: place and size
    // the menu inside the dialog's box instead of the viewport.
    const captured =
      container !== null &&
      (shift.left !== 0 || shift.top !== 0 || shift.bottom !== 0);
    const frame = captured
      ? {
          width: container.clientWidth,
          height: window.innerHeight - shift.top - shift.bottom,
        }
      : { width: window.innerWidth, height: window.innerHeight };
    const position = searchableMenuPosition(
      {
        top: rect.top - shift.top,
        bottom: rect.bottom - shift.top,
        left: rect.left - shift.left,
        width: rect.width,
      },
      frame,
    );
    setMenuStyle({
      position: "fixed",
      zIndex: 1000,
      right: "auto",
      top: position.top !== undefined ? position.top : "auto",
      bottom: position.bottom !== undefined ? position.bottom : "auto",
      left: position.left,
      width: position.width,
      maxHeight: position.maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const input = inputRef.current;
    // Inside the open dialog (native <dialog> top layer, or the in-place
    // aria-modal Modal) so assistive tech keeps it inside the dialog.
    setPortalTarget(
      (input?.closest(
        'dialog[open], [role="dialog"][aria-modal="true"]',
      ) as HTMLElement | null) ?? document.body,
    );
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuOpen, updatePosition]);

  useEffect(() => {
    if (!menuOpen || activeIndex < 0) return;
    const element = menuRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, menuOpen]);

  function close(resetQuery: boolean) {
    setIsOpen(false);
    setActiveIndex(-1);
    if (resetQuery) setQuery(selectedOption?.label ?? "");
  }

  function selectOption(option: SearchableSelectOption) {
    if (option.disabled) return;
    setQuery(option.label);
    close(false);
    void onValueChange(option.value);
  }

  function handleInputChange(nextQuery: string) {
    setQuery(nextQuery);
    setIsOpen(true);
    setActiveIndex(-1);

    if (value && nextQuery !== selectedOption?.label) {
      void onValueChange("");
    }
  }

  const menu = (
    <div
      className="searchable-select-menu"
      data-presentation-sensitive={sensitive ? "true" : undefined}
      id={listboxId}
      ref={menuRef}
      role="listbox"
      aria-label={ariaLabel}
      hidden={!menuOpen}
      style={menuOpen && menuStyle ? menuStyle : undefined}
      onMouseDown={(event) => event.preventDefault()}
    >
      {renderedOptions.length > 0 ? (
        renderedOptions.map((option, index) => (
          <button
            className={`searchable-select-option${
              index === activeIndex ? " active" : ""
            }${option.disabled ? " disabled" : ""}`}
            data-index={index}
            id={`${listboxId}-option-${index}`}
            key={option.value}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={option.value === value}
            aria-disabled={option.disabled ? "true" : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => {
              if (!option.disabled) setActiveIndex(index);
            }}
            onClick={() => selectOption(option)}
          >
            <strong>{option.label}</strong>
            {option.disabled && option.disabledReason ? (
              <span className="searchable-select-reason">
                {option.disabledReason}
              </span>
            ) : option.description ? (
              <span>{option.description}</span>
            ) : null}
          </button>
        ))
      ) : (
        <span className="searchable-select-empty">{emptyMessage}</span>
      )}
      {hiddenCount > 0 ? (
        <span className="searchable-select-empty" role="note">
          Mostrando {renderedOptions.length} de {filteredOptions.length}. Digite
          para encontrar as outras.
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      className="searchable-select"
      data-presentation-sensitive={sensitive ? "true" : undefined}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (
          !event.currentTarget.contains(next) &&
          !menuRef.current?.contains(next)
        ) {
          close(true);
        }
      }}
    >
      <input type="hidden" name={name} value={value} />
      <input
        className="filter-control searchable-select-input"
        id={id}
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => handleInputChange(event.currentTarget.value)}
        onClick={() => {
          if (!disabled) setIsOpen(true);
        }}
        onFocus={() => {
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) =>
              nextEnabledIndex(renderedOptions, current, 1),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) =>
              nextEnabledIndex(
                renderedOptions,
                current < 0 ? renderedOptions.length : current,
                -1,
              ),
            );
          } else if (
            event.key === "Enter" &&
            isOpen &&
            activeIndex >= 0 &&
            renderedOptions[activeIndex]
          ) {
            event.preventDefault();
            selectOption(renderedOptions[activeIndex]);
          } else if (event.key === "Escape" && isOpen) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          } else if (event.key === "Tab") {
            close(true);
          }
        }}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={menuOpen}
        aria-activedescendant={
          menuOpen && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        data-presentation-sensitive-field={sensitive ? "true" : undefined}
      />
      {sensitive ? (
        <span
          aria-hidden="true"
          className="searchable-select-presentation-placeholder"
        >
          {presentationPlaceholder}
        </span>
      ) : null}
      {portalTarget && menuOpen ? createPortal(menu, portalTarget) : menu}
    </div>
  );
}
