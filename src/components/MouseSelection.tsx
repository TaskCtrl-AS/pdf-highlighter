import React, { CSSProperties, useEffect, useRef, useState } from "react";

import { asElement, getPageFromElement, isHTMLElement } from "../lib/pdfjs-dom";
import "../style/MouseSelection.css";

import { PDFViewer } from "pdfjs-dist/types/web/pdf_viewer";
import {
  scaledPositionToViewport,
  viewportPositionToScaled,
} from "../lib/coordinates";
import screenshot from "../lib/screenshot";
import type { LTWH, LTWHP, ScaledPosition, ViewportPosition } from "../types";

type Coords = {
  x: number;
  y: number;
};

type DebugOverlay = {
  /** Raw selection rect (canvas-relative) – rendered green */
  rawRect: LTWHP;
  /** Round-tripped rect: raw → PDF coords → back to viewport – rendered blue */
  roundTrippedRect: LTWHP;
  /** Page div offsets within PdfHighlighter scroll content */
  pageOffsetLeft: number;
  pageOffsetTop: number;
};

const getBoundingRect = (start: Coords, end: Coords): LTWH => {
  return {
    left: Math.min(end.x, start.x),
    top: Math.min(end.y, start.y),

    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
};

const getContainerCoords = (
  container: HTMLElement,
  clientX: number,
  clientY: number,
) => {
  const containerBoundingRect = container.getBoundingClientRect();
  return {
    x: clientX - containerBoundingRect.left + container.scrollLeft,
    y: clientY - containerBoundingRect.top + container.scrollTop,
  };
};

/**
 * The props type for {@link MouseSelection}.
 *
 * @category Component Properties
 * @internal
 */
export interface MouseSelectionProps {
  /**
   * The PDFViewer instance containing this MouseSelection.
   */
  viewer: PDFViewer;

  /**
   * Callback triggered whenever the user stops dragging their mouse and a valid
   * mouse selection is made. In general, this will only be called if a mouse
   * selection is rendered.
   *
   * @param viewportPosition - viewport position of the mouse selection.
   * @param scaledPosition - scaled position of the mouse selection.
   * @param image - PNG screenshot of the mouse selection.
   * @param resetSelection - Callback to reset the current selection.
   * @param event - Mouse event associated with ending the selection.
   */
  onSelection?(
    viewportPosition: ViewportPosition,
    scaledPosition: ScaledPosition,
    image: string,
    resetSelection: () => void,
    event: MouseEvent,
  ): void;

  /**
   * Callback triggered whenever the current mouse selection is reset.
   * This includes when dragging ends but the selection is invalid.
   */
  onReset?(): void;

  /**
   * Callback triggered whenever a new valid mouse selection begins.
   *
   * @param event - mouse event associated with the new selection.
   */
  onDragStart?(event: MouseEvent): void;

  /**
   * Condition to check before any mouse selection starts.
   *
   * @param event - mouse event associated with the new selection.
   * @returns - `True` if mouse selection should start.
   */
  enableAreaSelection(event: MouseEvent): boolean;

  /**
   * Callback whenever the mouse selection area changes.
   *
   * @param isVisible - Whether the mouse selection is rendered (i.e., non-zero area)
   */
  onChange?(isVisible: boolean): void;

  /**
   * Optional style props for the mouse selection rectangle.
   */
  style?: CSSProperties;

  /**
   * When true, renders two debug overlay boxes after each selection:
   *  - GREEN  = raw pageBoundingRect (what the selection measured)
   *  - BLUE   = round-tripped rect  (raw → PDF coords → back to viewport)
   * If the two boxes don't coincide, the coordinate conversion is still wrong.
   * If they coincide but the rendered highlight is elsewhere, the highlight
   * layer anchoring is the remaining bug.
   * Also logs all three values to the console.
   */
  debugCoords?: boolean;
}

/**
 * A component that enables the creation of rectangular and interactive mouse
 * selections within a given container. NOTE: This does not disable selection in
 * whatever container the component is placed in. That must be handled through
 * the component's events.
 *
 * @category Component
 * @internal
 */
export const MouseSelection = ({
  viewer,
  onSelection,
  onReset,
  onDragStart,
  enableAreaSelection,
  onChange,
  style,
  debugCoords = false,
}: MouseSelectionProps) => {
  const [start, setStart] = useState<Coords | null>(null);
  const [end, setEnd] = useState<Coords | null>(null);
  const [locked, setLocked] = useState(false);
  const [debugOverlay, setDebugOverlay] = useState<DebugOverlay | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<HTMLDivElement | null>(null);

  // Needed in order to grab the page info of a mouse selection
  const startTargetRef = useRef<HTMLElement | null>(null);

  const reset = () => {
    onReset && onReset();
    setStart(null);
    setEnd(null);
    setLocked(false);
    if (debugCoords) setDebugOverlay(null);
  };

  // Register event listeners onChange
  useEffect(() => {
    onChange?.(Boolean(start && end));
    if (!rootRef.current) return;

    // Should be the PdfHighlighter
    const container = asElement(rootRef.current.parentElement);

    const handleMouseUp = (event: MouseEvent) => {
      if (!start || !end || !startTargetRef.current || !selectionRef.current) {
        return;
      }

      const boundingRect = getBoundingRect(start, end);

      const shouldEnd = boundingRect.width >= 1 && boundingRect.height >= 1;

      if (!container.contains(asElement(event.target)) || !shouldEnd) {
        reset();
        return;
      }

      setLocked(true);

      const page = getPageFromElement(startTargetRef.current);
      if (!page) return;
      const selectionRect = selectionRef.current.getBoundingClientRect();
      const pageView = viewer.getPageView(page.number - 1);
      const pageCanvasRect = pageView.canvas?.getBoundingClientRect();
      const pageRect = pageCanvasRect ?? page.node.getBoundingClientRect();

      const pageBoundingRect: LTWHP = {
        left: selectionRect.left - pageRect.left,
        top: selectionRect.top - pageRect.top,
        width: selectionRect.width,
        height: selectionRect.height,
        pageNumber: page.number,
      };

      const viewportPosition: ViewportPosition = {
        boundingRect: pageBoundingRect,
        rects: [],
      };
      if (!viewportPosition.boundingRect) return;
      const scaledPosition = viewportPositionToScaled(
        viewportPosition,
        viewer,
        true,
      );

      // --- Coordinate debug instrumentation ---
      // Diagnostic plan (from issue tracker):
      //   1. rawRect      = what we measured from the DOM (this should match the drag visual)
      //   2. pdfCoords    = intermediate PDF user-space coordinates
      //   3. roundTripped = pdfCoords converted back to viewport space
      // If GREEN box ≠ BLUE box → conversion math is still wrong for this rotation.
      // If GREEN = BLUE but rendered highlight is elsewhere → highlight layer anchoring is wrong.
      if (debugCoords) {
        const roundTrippedViewport = scaledPositionToViewport(
          scaledPosition,
          viewer,
        );
        const roundTrippedRect = roundTrippedViewport.boundingRect;
        setDebugOverlay({
          rawRect: pageBoundingRect,
          roundTrippedRect: { ...roundTrippedRect, pageNumber: page.number },
          pageOffsetLeft: page.node.offsetLeft,
          pageOffsetTop: page.node.offsetTop,
        });
      }
      // --- end debug instrumentation ---

      const image = screenshot(
        pageBoundingRect,
        pageBoundingRect.pageNumber,
        viewer,
      );

      onSelection?.(viewportPosition, scaledPosition, image, reset, event);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!rootRef.current || !start || locked) return;
      setEnd(getContainerCoords(container, event.clientX, event.clientY));
    };

    const handleMouseDown = (event: MouseEvent) => {
      const shouldStart = (event: MouseEvent) =>
        enableAreaSelection(event) &&
        isHTMLElement(event.target) &&
        Boolean(asElement(event.target).closest(".page"));

      // If the user clicks anywhere outside a tip, reset the selection
      const shouldReset = (event: MouseEvent) =>
        start &&
        !asElement(event.target).closest(".PdfHighlighter__tip-container");

      if (!shouldStart(event)) {
        if (shouldReset(event)) reset();
        return;
      }

      startTargetRef.current = asElement(event.target);
      onDragStart && onDragStart(event);
      setStart(getContainerCoords(container, event.clientX, event.clientY));
      setEnd(null);
      setLocked(false);
    };

    /**
     * Although we register the event listeners on the PdfHighlighter component, we encapsulate
     * them in this separate component to enhance maintainability and prevent unnecessary
     * rerenders of the PdfHighlighter itself. While synthetic events on PdfHighlighter would
     * be preferable, we need to register "mouseup" on the entire document anyway. Therefore,
     * we can't avoid using useEffect. We must re-register all events on state changes, as
     * custom event listeners may otherwise receive stale state.
     */
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mousedown", handleMouseDown);

    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [start, end]);

  return (
    <div className="MouseSelection-container" ref={rootRef}>
      {start && end && (
        <div
          className="MouseSelection"
          style={{ ...getBoundingRect(start, end), ...style }}
          ref={selectionRef}
        />
      )}
      {debugCoords && debugOverlay && (
        <>
          {/* GREEN = raw selection rect measured from canvas */}
          <div
            style={{
              position: "absolute",
              pointerEvents: "none",
              border: "2px solid lime",
              background: "rgba(0,255,0,0.12)",
              left: debugOverlay.pageOffsetLeft + debugOverlay.rawRect.left,
              top: debugOverlay.pageOffsetTop + debugOverlay.rawRect.top,
              width: debugOverlay.rawRect.width,
              height: debugOverlay.rawRect.height,
              zIndex: 100,
              boxSizing: "border-box",
            }}
          />
          {/* BLUE = round-tripped rect (raw → PDF → viewport) */}
          <div
            style={{
              position: "absolute",
              pointerEvents: "none",
              border: "2px solid blue",
              background: "rgba(0,0,255,0.12)",
              left:
                debugOverlay.pageOffsetLeft +
                debugOverlay.roundTrippedRect.left,
              top:
                debugOverlay.pageOffsetTop + debugOverlay.roundTrippedRect.top,
              width: debugOverlay.roundTrippedRect.width,
              height: debugOverlay.roundTrippedRect.height,
              zIndex: 101,
              boxSizing: "border-box",
            }}
          />
          {/* Label */}
          <div
            style={{
              position: "absolute",
              pointerEvents: "none",
              left: debugOverlay.pageOffsetLeft + debugOverlay.rawRect.left,
              top: debugOverlay.pageOffsetTop + debugOverlay.rawRect.top - 20,
              fontSize: 10,
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              padding: "1px 4px",
              zIndex: 102,
              whiteSpace: "nowrap",
            }}
          >
            🟢 raw &nbsp;🔵 round-trip
          </div>
        </>
      )}
    </div>
  );
};
