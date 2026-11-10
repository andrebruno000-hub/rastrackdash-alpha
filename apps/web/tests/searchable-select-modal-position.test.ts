// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { fixedContainingBlockShift } from "../src/components/searchable-select";

/**
 * The glass modals (backdrop-filter) capture position: fixed descendants:
 * the menu must be placed in the modal's coordinates, not the viewport's.
 */
describe("searchable select menu inside a glass modal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  function dialog(style: Partial<CSSStyleDeclaration>) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 120,
      top: 40,
      right: 1160,
      bottom: 760,
      width: 1040,
      height: 720,
      x: 120,
      y: 40,
      toJSON: () => ({}),
    });
    Object.defineProperty(element, "clientLeft", { value: 1 });
    Object.defineProperty(element, "clientTop", { value: 1 });
    Object.defineProperty(element, "clientHeight", { value: 718 });
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((target) =>
      target === element
        ? ({
            ...real(target),
            transform: "none",
            filter: "none",
            backdropFilter: "none",
            perspective: "none",
            contain: "none",
            willChange: "auto",
            getPropertyValue: () => "",
            ...style,
          } as CSSStyleDeclaration)
        : real(target),
    );
    return element;
  }

  it("shifts by the modal's padding box when it has a backdrop filter", () => {
    const element = dialog({ backdropFilter: "blur(32px) saturate(140%)" });
    expect(fixedContainingBlockShift(element, 900)).toEqual({
      left: 121,
      top: 41,
      bottom: 900 - (41 + 718),
    });
  });

  it("does not shift for a plain dialog or outside any dialog", () => {
    expect(fixedContainingBlockShift(dialog({}), 900)).toEqual({
      left: 0,
      top: 0,
      bottom: 0,
    });
    expect(fixedContainingBlockShift(null, 900)).toEqual({
      left: 0,
      top: 0,
      bottom: 0,
    });
  });
});
