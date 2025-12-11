import type { LTWHP, Page } from "../types";

import optimizeClientRects from "./optimize-client-rects";

const isClientRectInsidePageRect = (clientRect: DOMRect, pageRect: DOMRect) => {
  if (clientRect.top < pageRect.top) {
    return false;
  }
  if (clientRect.bottom > pageRect.bottom) {
    return false;
  }
  if (clientRect.right > pageRect.right) {
    return false;
  }
  if (clientRect.left < pageRect.left) {
    return false;
  }

  return true;
};

const getClientRects = (
  range: Range,
  pages: Page[],
  shouldOptimize: boolean = true
): Array<LTWHP> => {
  const clientRects = Array.from(range.getClientRects());

  const rects: LTWHP[] = [];

  for (const clientRect of clientRects) {
    for (const page of pages) {
      const pageRect = page.node.getBoundingClientRect();

      if (
        isClientRectInsidePageRect(clientRect, pageRect) &&
        clientRect.width > 0 &&
        clientRect.height > 0 &&
        clientRect.width < pageRect.width &&
        clientRect.left > pageRect.left &&
        clientRect.height < pageRect.height
      ) {
        const highlightedRect = {
          top: clientRect.top + page.node.scrollTop - pageRect.top,
          left: clientRect.left + page.node.scrollLeft - pageRect.left,
          width: clientRect.width,
          height: clientRect.height,
          pageNumber: page.number,
        } as LTWHP;

        rects.push(highlightedRect);
      }
    }
  }

  return shouldOptimize ? optimizeClientRects(rects) : rects;
};

/**
 * Calculates a 0x0 rect (point) relative to the page for a click event.
 * Useful for "pin" or "comment" insertions on click.
 */
export const getClientRectsForPoint = (
  event: { clientX: number; clientY: number; target: EventTarget | null },
  pages: Page[]
): Array<LTWHP> => {
  const targetNode = event.target as Node;
  const page = pages.find((p) => p.node.contains(targetNode));

  if (!page) {
    return [];
  }

  const pageRect = page.node.getBoundingClientRect();
  const relativeLeft = event.clientX + page.node.scrollLeft - pageRect.left;
  const relativeTop = event.clientY + page.node.scrollTop - pageRect.top;

  // 3. Construct the single LTWHP point
  const pointRect: LTWHP = {
    left: relativeLeft,
    top: relativeTop,
    width: 0,
    height: 0,
    pageNumber: page.number,
  };

  return [pointRect];
};

export default getClientRects;
