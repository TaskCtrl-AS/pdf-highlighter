import { PDFViewer } from "pdfjs-dist/types/web/pdf_viewer";
import type { LTWHP, ViewportPosition, Scaled, ScaledPosition } from "../types";
import { PageViewport } from "pdfjs-dist";

/*
 * Pin coordinate system — pdfrx on Flutter is the source of truth.
 *
 * Flutter's tap-to-store math is pure linear scaling of the click position
 * within the rendered page rect, multiplied by the page's native-unrotated
 * dimensions:
 *
 *   pdfX = tapPos.dx / pageRect.width  * page.width
 *   pdfY = tapPos.dy / pageRect.height * page.height
 *
 * When the PDF has a `/Rotate` entry, pdfrx renders the page in the rotated
 * orientation (so `pageRect` reflects the rotated aspect) while `page.width`
 * / `page.height` stay native unrotated. Those aspects do NOT match for 90°
 * or 270° rotations, so the stored `x1` is not a true PDF user-space
 * coordinate — it's `(fraction of rendered width) * native width`. This
 * convention is consistent as long as every client uses it; we match it.
 *
 * To stay compatible, web must let pdf.js apply `/Rotate` when rendering
 * (the default `PDFViewer` behavior) so `viewport.width` / `viewport.height`
 * share the same rotated aspect as Flutter's `pageRect`. The denominators
 * in our math are `viewport.width` / `viewport.height`; the multipliers and
 * the persisted `width` / `height` are native-unrotated dims from
 * `viewport.viewBox`.
 */

const getNativeDimensions = (
  viewport: PageViewport,
): { width: number; height: number } => {
  const [x1, y1, x2, y2] = viewport.viewBox;
  return { width: x2 - x1, height: y2 - y1 };
};

/** @category Utilities */
export const viewportToScaled = (
  rect: LTWHP,
  viewport: PageViewport,
): Scaled => {
  const { width: nativeWidth, height: nativeHeight } =
    getNativeDimensions(viewport);
  const scaleX = nativeWidth / viewport.width;
  const scaleY = nativeHeight / viewport.height;

  return {
    x1: rect.left * scaleX,
    y1: rect.top * scaleY,
    x2: (rect.left + rect.width) * scaleX,
    y2: (rect.top + rect.height) * scaleY,
    width: nativeWidth,
    height: nativeHeight,
    pageNumber: rect.pageNumber,
  };
};

/** @category Utilities */
export const viewportPositionToScaled = (
  { boundingRect, rects }: ViewportPosition,
  viewer: PDFViewer,
): ScaledPosition => {
  const pageNumber = boundingRect.pageNumber;
  const viewport = viewer.getPageView(pageNumber - 1).viewport;
  const scale = (obj: LTWHP) => viewportToScaled(obj, viewport);
  return {
    boundingRect: scale(boundingRect),
    rects: (rects || []).map(scale),
  };
};

/** @category Utilities */
export const scaledToViewport = (
  scaled: Scaled,
  viewport: PageViewport,
): LTWHP => {
  if (scaled.x1 === undefined) {
    throw new Error("You are using old position format, please update");
  }
  const scaleX = viewport.width / scaled.width;
  const scaleY = viewport.height / scaled.height;

  return {
    left: scaled.x1 * scaleX,
    top: scaled.y1 * scaleY,
    width: (scaled.x2 - scaled.x1) * scaleX,
    height: (scaled.y2 - scaled.y1) * scaleY,
    pageNumber: scaled.pageNumber,
  };
};

/** @category Utilities */
export const scaledPositionToViewport = (
  { boundingRect, rects }: ScaledPosition,
  viewer: PDFViewer,
): ViewportPosition => {
  const pageNumber = boundingRect.pageNumber;
  const viewport = viewer.getPageView(pageNumber - 1).viewport;
  const scale = (obj: Scaled) => scaledToViewport(obj, viewport);
  return {
    boundingRect: scale(boundingRect),
    rects: (rects || []).map(scale),
  };
};
