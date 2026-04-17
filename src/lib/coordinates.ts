import { PDFViewer } from "pdfjs-dist/types/web/pdf_viewer";
import type { LTWHP, ViewportPosition, Scaled, ScaledPosition } from "../types";
import { PageViewport } from "pdfjs-dist";

interface WIDTH_HEIGHT {
  width: number;
  height: number;
  rotation?: number;
}

type RECT_COORDS = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

const normalizeRotation = (rotation: number = 0): number => {
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const rotateToViewport = (
  rect: RECT_COORDS,
  width: number,
  height: number,
  rotation: number,
): RECT_COORDS => {
  switch (normalizeRotation(rotation)) {
    case 0:
      return rect;
    case 90:
      return {
        x1: rect.y1,
        y1: width - rect.x2,
        x2: rect.y2,
        y2: width - rect.x1,
      };
    case 180:
      return {
        x1: width - rect.x2,
        y1: height - rect.y2,
        x2: width - rect.x1,
        y2: height - rect.y1,
      };
    case 270:
      return {
        x1: height - rect.y2,
        y1: rect.x1,
        x2: height - rect.y1,
        y2: rect.x2,
      };
    default:
      return rect;
  }
};

const viewportToCanonical = (
  rect: RECT_COORDS,
  width: number,
  height: number,
  rotation: number,
): RECT_COORDS => {
  switch (normalizeRotation(rotation)) {
    case 0:
      return rect;
    case 90:
      return {
        x1: width - rect.y2,
        y1: rect.x1,
        x2: width - rect.y1,
        y2: rect.x2,
      };
    case 180:
      return {
        x1: width - rect.x2,
        y1: height - rect.y2,
        x2: width - rect.x1,
        y2: height - rect.y1,
      };
    case 270:
      return {
        x1: rect.y1,
        y1: height - rect.x2,
        x2: rect.y2,
        y2: height - rect.x1,
      };
    default:
      return rect;
  }
};

/** @category Utilities */
export const viewportToScaled = (
  rect: LTWHP,
  { width, height, rotation = 0 }: WIDTH_HEIGHT,
): Scaled => {
  const canonicalRect = viewportToCanonical(
    {
      x1: rect.left,
      y1: rect.top,
      x2: rect.left + rect.width,
      y2: rect.top + rect.height,
    },
    width,
    height,
    rotation,
  );

  return {
    x1: canonicalRect.x1,
    y1: canonicalRect.y1,

    x2: canonicalRect.x2,
    y2: canonicalRect.y2,

    width,
    height,

    pageNumber: rect.pageNumber,
  };
};

/** @category Utilities */
export const viewportPositionToScaled = (
  { boundingRect, rects }: ViewportPosition,
  viewer: PDFViewer,
  usePdfCoordinates: boolean = false,
): ScaledPosition => {
  const pageNumber = boundingRect.pageNumber;
  const viewport = viewer.getPageView(pageNumber - 1).viewport; // Account for 1 indexing of PDF documents
  const scale = (obj: LTWHP) => {
    if (!usePdfCoordinates) {
      return viewportToScaled(obj, viewport);
    }

    const [x1, y1] = viewport.convertToPdfPoint(obj.left, obj.top);
    const [x2, y2] = viewport.convertToPdfPoint(
      obj.left + obj.width,
      obj.top + obj.height,
    );

    return {
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
      width: viewport.width,
      height: viewport.height,
      pageNumber: obj.pageNumber,
    };
  };

  return {
    boundingRect: scale(boundingRect),
    rects: (rects || []).map(scale),
    usePdfCoordinates,
  };
};

const pdfToViewport = (pdf: Scaled, viewport: PageViewport): LTWHP => {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
    pdf.x1,
    pdf.y1,
    pdf.x2,
    pdf.y2,
  ]);

  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),

    width: Math.abs(x2 - x1),
    height: Math.abs(y1 - y2),

    pageNumber: pdf.pageNumber,
  };
};

/** @category Utilities */
export const scaledToViewport = (
  scaled: Scaled,
  viewport: PageViewport,
  usePdfCoordinates: boolean = false,
): LTWHP => {
  const { width, height } = viewport;

  if (usePdfCoordinates) {
    return pdfToViewport(scaled, viewport);
  }

  if (scaled.x1 === undefined) {
    throw new Error("You are using old position format, please update");
  }

  const x1 = (width * scaled.x1) / scaled.width;
  const y1 = (height * scaled.y1) / scaled.height;

  const x2 = (width * scaled.x2) / scaled.width;
  const y2 = (height * scaled.y2) / scaled.height;

  const rotatedRect = rotateToViewport(
    { x1, y1, x2, y2 },
    width,
    height,
    viewport.rotation,
  );

  return {
    left: Math.min(rotatedRect.x1, rotatedRect.x2),
    top: Math.min(rotatedRect.y1, rotatedRect.y2),
    width: Math.abs(rotatedRect.x2 - rotatedRect.x1),
    height: Math.abs(rotatedRect.y2 - rotatedRect.y1),
    pageNumber: scaled.pageNumber,
  };
};

/** @category Utilities */
export const scaledPositionToViewport = (
  { boundingRect, rects, usePdfCoordinates }: ScaledPosition,
  viewer: PDFViewer,
): ViewportPosition => {
  const pageNumber = boundingRect.pageNumber;
  const viewport = viewer.getPageView(pageNumber - 1).viewport; // Account for 1 indexing of PDF documents
  const scale = (obj: Scaled) =>
    scaledToViewport(obj, viewport, usePdfCoordinates);

  return {
    boundingRect: scale(boundingRect),
    rects: (rects || []).map(scale),
  };
};
